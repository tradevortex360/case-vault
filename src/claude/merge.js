// Merge Claude "result files" into the vault. Every key is deterministic, so
// merging the same result twice (or on two devices) produces identical ops.
import { parseDate, sortKey } from '../search/dates.js';

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
const normDate = d => { if (!d) return null; const p = parseDate(d); return p ? (p.precision === 'day' ? p.from : String(d).trim()) : String(d).trim(); };
const sim = (a, b) => { const A = new Set(slugWords(a)), B = new Set(slugWords(b)); if (!A.size || !B.size) return 0; let n = 0; A.forEach(w => B.has(w) && n++); return n / Math.min(A.size, B.size); };
const slugWords = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3);

/**
 * extract result:
 * { type:'extract', fileId, fileName, caseId?, document:{title, short, date, filedBy, language, summary, proceeding:{number,title,court}},
 *   paragraphs:[{ref,page,text,translation?}], events:[{date,title,desc,account,page,ref}],
 *   allegations:[{existingId?, title, brief, group, paraRefs:[...]}], verifications:[{title,kind,variants:[{value,ref,page}]}] }
 */
export function extractToChanges(v, r) {
  const ch = []; const put = (coll, key, data) => ch.push({ coll, key, kind: 'put', data: { ...data, id: key } });
  const patch = (coll, key, data) => ch.push({ coll, key, kind: 'patch', data });
  const caseId = r.caseId || v.list('cases')[0]?.id;
  if (!caseId) throw new Error('No case to file this document into');
  const docId = 'd-' + slug(r.fileId || r.fileName);
  if (v.get('documents', docId)) return { changes: [], docId, skipped: true };
  const D = r.document || {};
  // proceeding: match by number, else create
  let procId = null;
  if (D.proceeding?.number) {
    const want = slug(D.proceeding.number);
    const found = v.list('proceedings', p => p.caseId === caseId && slug(p.number) === want)[0];
    procId = found?.id || 'pr-' + want;
    if (!found) put('proceedings', procId, { caseId, number: D.proceeding.number, title: D.proceeding.title || '', court: D.proceeding.court || '', status: 'Pending', filedBy: D.filedBy === 'me' ? 'me' : 'opponent' });
  }
  put('documents', docId, { caseId, proceedingId: procId, title: D.title || r.fileName, short: D.short || '', date: normDate(D.date), filedBy: D.filedBy || 'other', language: D.language || 'en', summary: D.summary || '', fileId: r.fileId || null, fileName: r.fileName || null, source: 'claude', createdAt: r.at || Date.now() });
  const refToPara = {};
  (r.paragraphs || []).forEach((p, i) => {
    const pid = docId + '-p' + i; refToPara[norm(p.ref)] = pid;
    put('paragraphs', pid, { docId, order: i, ref: p.ref, page: p.page || null, text: p.text, translation: p.translation || null, lang: p.lang || D.language || 'en', allegationIds: [] });
  });
  // allegations: reuse existing ones Claude matched, or create
  const paraAl = {};
  const existing = v.list('allegations', a => a.caseId === caseId);
  let nextN = Math.max(0, ...existing.map(a => a.n || 0)) + 1;
  (r.allegations || []).forEach((a, i) => {
    let aid = a.existingId && v.get('allegations', a.existingId) ? a.existingId : null;
    if (!aid) { const m = existing.find(e => sim(e.title, a.title) >= 0.8); aid = m?.id || null; }
    const pids = (a.paraRefs || []).map(x => refToPara[norm(x)]).filter(Boolean);
    if (aid) { const cur = v.get('allegations', aid); patch('allegations', aid, { paraIds: [...new Set([...(cur.paraIds || []), ...pids])] }); }
    else { aid = 'al-' + docId.slice(2) + '-' + i; put('allegations', aid, { caseId, n: nextN++, title: a.title, brief: a.brief || '', group: a.group || '', paraIds: pids }); }
    pids.forEach(pid => (paraAl[pid] ||= []).push(aid));
  });
  for (const [pid, aids] of Object.entries(paraAl)) patch('paragraphs', pid, { allegationIds: [...new Set(aids)] });
  // events: attach to an existing event when it is clearly the same, otherwise add; date clashes go to verification
  const evs = v.list('events', e => e.caseId === caseId && !e.mergedInto);
  (r.events || []).forEach((e, i) => {
    const date = normDate(e.date); const src = { docId, page: e.page || null, ref: e.ref || null, claim: e.account === 'theirs' ? 'as alleged in this document' : '' };
    const same = evs.find(x => sim(x.title + ' ' + (x.desc || ''), e.title + ' ' + (e.desc || '')) >= 0.75);
    if (same && sortKey(same.date) === sortKey(date)) {
      patch('events', same.id, { sources: [...(same.sources || []), src], account: same.account !== e.account ? 'both' : same.account });
    } else {
      const eid = 'e-' + docId.slice(2) + '-' + i;
      put('events', eid, { caseId, date, title: e.title, desc: e.desc || '', account: e.account || 'record', kind: e.kind || 'incident', proceedingId: procId, sources: [src], createdAt: Date.now() });
      if (same && date && same.date) put('verifications', 'vf-' + eid, { caseId, title: `Date of: ${same.title}`, kind: 'date', status: 'open', eventId: same.id,
        variants: [{ value: fmt(same.date), sources: same.sources || [] }, { value: fmt(date), sources: [src] }] });
    }
  });
  (r.verifications || []).forEach((x, i) => put('verifications', 'vf-' + docId.slice(2) + '-' + i, { caseId, title: x.title, kind: x.kind || 'fact', status: 'open', variants: (x.variants || []).map(vr => ({ value: vr.value, sources: [{ docId, ref: vr.ref || null, page: vr.page || null, label: vr.label || null }] })) }));
  // court directions found in an order
  (r.directions || []).forEach((x, i) => put('directions', 'dir-' + docId.slice(2) + '-' + i, { caseId, proceedingId: procId, orderDate: normDate(D.date), text: x.text, status: 'to comply' }));
  if (r.nextDate && procId) put('hearings', 'h-' + docId.slice(2), { caseId, proceedingId: procId, date: normDate(D.date), purpose: 'Order', outcome: D.summary || '', nextDate: normDate(r.nextDate), nextPurpose: r.nextPurpose || '' });
  return { changes: ch, docId };
}
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9()]+/g, '');
const fmt = d => { const p = parseDate(d); if (!p) return String(d); const [y, m, dd] = p.from.split('-'); return p.precision === 'day' ? `${dd}.${m}.${y}` : String(d); };

export function resultToChanges(v, r) {
  switch (r.type) {
    case 'extract': return extractToChanges(v, r).changes;
    case 'suggest': return (r.suggestions || []).filter(s => v.get('paragraphs', s.paraId) && !v.list('replies', x => x.paraId === s.paraId && x.status === 'accepted').length).map(s => ({
      coll: 'replies', key: 'sg-' + s.paraId, kind: 'put', data: { id: 'sg-' + s.paraId, caseId: r.caseId, allegationId: (v.get('paragraphs', s.paraId).allegationIds || [])[0] || null, paraId: s.paraId, text: s.text, status: 'suggested', origin: 'claude', sources: s.sources || [], createdAt: r.at || Date.now(), updatedAt: r.at || Date.now() } }));
    case 'polish': return v.get('replies', r.replyId) ? [{ coll: 'replies', key: r.replyId, kind: 'patch', data: { text: r.text, toPolish: false, updatedAt: r.at || Date.now() } }] : [];
    case 'consolidate': return [{ coll: 'consolidated', key: r.allegationId, kind: 'put', data: { id: r.allegationId, caseId: r.caseId, text: r.text, at: r.at || Date.now(), from: r.from || [] } }];
    case 'story': return [{ coll: 'stories', key: r.caseId + '-' + r.length, kind: 'put', data: { id: r.caseId + '-' + r.length, caseId: r.caseId, length: r.length, text: r.text, at: r.at || Date.now() } }];
    case 'summary': return v.get('documents', r.docId) ? [{ coll: 'documents', key: r.docId, kind: 'patch', data: { summary: r.text } }] : [];
    case 'import': { // full records with fixed ids (migration / restore from file); never overwrites existing records
      const ch = [];
      for (const [coll, recs] of Object.entries(r.records || {})) for (const [key, data] of Object.entries(recs)) if (!v.get(coll, key)) ch.push({ coll, key, kind: 'put', data: { ...data, id: key } });
      return ch;
    }
    default: return [];
  }
}

export async function applyResult(v, r) {
  const ch = resultToChanges(v, r);
  if (r.jobId && v.get('jobs', r.jobId)) ch.push({ coll: 'jobs', key: r.jobId, kind: 'patch', data: { status: 'done', doneAt: Date.now() } });
  if (ch.length) await v.commit(ch);
  return ch.length;
}
