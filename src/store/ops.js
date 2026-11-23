// Event-sourced vault store.
// Every change is an "op". Ops from all devices (and Claude) are merged
// deterministically: per-field last-writer-wins by hybrid timestamp, with
// concurrent edits to long text fields kept side-by-side as a conflict.

export const COLLECTIONS = [
  'cases', 'proceedings', 'documents', 'paragraphs', 'events', 'verifications',
  'allegations', 'replies', 'consolidated', 'evidence', 'hearings', 'deadlines',
  'directions', 'expenses', 'contacts', 'commlog', 'qa', 'stories', 'jobs', 'notes'
];

// Fields where two concurrent edits must not silently overwrite each other.
export const TEXT_FIELDS = new Set(['text', 'orig', 'note', 'notes', 'summary', 'desc', 'outcome', 'complianceNotes', 'brief', 'title']);

let lastMs = 0, counter = 0;
export function hlc(device, now = Date.now()) {
  if (now <= lastMs) { counter++; now = lastMs; } else { lastMs = now; counter = 0; }
  return now.toString(36).padStart(9, '0') + '.' + counter.toString(36).padStart(3, '0') + '.' + device;
}
export function observeTs(ts) { // keep local clock ahead of anything seen
  const ms = parseInt(ts.split('.')[0], 36);
  if (ms > lastMs) { lastMs = ms; counter = 0; }
}
export const tsDevice = ts => ts.split('.').slice(2).join('.');

export function uid(prefix = '') {
  const r = crypto.getRandomValues(new Uint8Array(8));
  return prefix + Array.from(r, b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

export function emptyState() {
  const s = { _fts: {}, _applied: new Set() };
  for (const c of COLLECTIONS) s[c] = {};
  return s;
}

// field timestamp bookkeeping: s._fts[coll][key][field] = ts
function ftsOf(s, coll, key) {
  s._fts[coll] ||= {}; return (s._fts[coll][key] ||= {});
}

/**
 * op = { id, ts, device, coll, key, kind: 'put'|'patch'|'del', data?, base? }
 * base: { field: tsSeenWhenEditing } — lets us detect concurrent text edits.
 */
export function applyOp(s, op) {
  if (s._applied.has(op.id)) return false;
  s._applied.add(op.id);
  observeTs(op.ts);
  const { coll, key } = op;
  if (!COLLECTIONS.includes(coll)) return false;
  const col = s[coll];
  const fts = ftsOf(s, coll, key);
  if (op.kind === 'del') {
    if ((fts.__del || '') < op.ts) {
      fts.__del = op.ts;
      // same rule as for edits (below), so the result never depends on arrival order:
      // a record is deleted only if the delete is newer than its creation and every field edit
      if (col[key] && fts.__del > (fts.__put || '') && fts.__del > maxFieldTs(fts)) col[key] = { ...col[key], _deleted: true };
    }
    return true;
  }
  const rec = col[key] ? { ...col[key] } : { id: key };
  if (op.kind === 'put') fts.__put = fts.__put && fts.__put > op.ts ? fts.__put : op.ts;
  if ((fts.__del || '') > op.ts && op.kind === 'put') { /* deleted later; keep deleted */ }
  for (const [f, v] of Object.entries(op.data || {})) {
    const cur = fts[f];
    const baseSeen = op.base ? op.base[f] : undefined;
    const concurrent = TEXT_FIELDS.has(f) && cur && baseSeen !== undefined && baseSeen !== cur &&
      tsDevice(cur) !== op.device && rec[f] !== v;
    if (concurrent) {
      // both versions survive; newest shown, conflict recorded for the user to resolve
      const winnerIsOp = op.ts > cur;
      const loser = winnerIsOp ? { v: rec[f], ts: cur } : { v, ts: op.ts };
      if (winnerIsOp) { rec[f] = v; fts[f] = op.ts; }
      rec._conflicts = [...(rec._conflicts || []).filter(c => !(c.field === f && c.ts === loser.ts)),
        { field: f, value: loser.v, ts: loser.ts, device: tsDevice(loser.ts) }];
    } else if (!cur || op.ts > cur) {
      rec[f] = v; fts[f] = op.ts;
    }
  }
  if ((fts.__del || '') > (fts.__put || '') && (fts.__del || '') > maxFieldTs(fts)) rec._deleted = true;
  else delete rec._deleted;
  col[key] = rec;
  return true;
}
function maxFieldTs(fts) { let m = ''; for (const [k, v] of Object.entries(fts)) if (!k.startsWith('__') && v > m) m = v; return m; }

export function applyAll(s, ops) {
  const sorted = [...ops].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  let n = 0; for (const op of sorted) if (applyOp(s, op)) n++;
  return n;
}

// Build state from scratch (used for verification and restore)
export function fold(ops) { const s = emptyState(); applyAll(s, ops); return s; }

// Visible records (not deleted)
export function list(s, coll, pred = () => true) {
  return Object.values(s[coll] || {}).filter(r => !r._deleted && pred(r));
}
export function get(s, coll, key) { const r = s[coll]?.[key]; return r && !r._deleted ? r : null; }

// Plain-JSON export of the visible state (for snapshots / README / Claude)
export function toJSON(s) {
  const out = {};
  for (const c of COLLECTIONS) out[c] = Object.fromEntries(Object.entries(s[c]).filter(([, r]) => !r._deleted));
  return out;
}

// Diff two plain states into ops that turn `from` into `to` (used for restore-from-backup)
export function diffToOps(from, to, device) {
  const ops = [];
  for (const c of COLLECTIONS) {
    const a = from[c] || {}, b = to[c] || {};
    for (const k of Object.keys(a)) if (!b[k]) ops.push({ id: uid('op'), ts: hlc(device), device, coll: c, key: k, kind: 'del' });
    for (const [k, rec] of Object.entries(b)) {
      const old = a[k];
      const data = {};
      for (const [f, v] of Object.entries(rec)) if (!f.startsWith('_') && JSON.stringify(old?.[f]) !== JSON.stringify(v)) data[f] = v;
      if (old) for (const f of Object.keys(old)) if (!f.startsWith('_') && !(f in rec)) data[f] = null;
      if (Object.keys(data).length) ops.push({ id: uid('op'), ts: hlc(device), device, coll: c, key: k, kind: old ? 'patch' : 'put', data });
    }
  }
  return ops;
}
