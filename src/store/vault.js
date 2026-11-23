// Local-first vault: everything is stored on the device (IndexedDB) and works offline.
// Sync exchanges append-only op files with a storage adapter (Google Drive / Claude connector / mock).
import { openDB } from 'idb';
import { emptyState, applyAll, applyOp, hlc, uid, toJSON, diffToOps, get, list } from './ops.js';

const DBNAME = 'case-vault';
export async function openStore(name = DBNAME) {
  return openDB(name, 1, {
    upgrade(db) {
      db.createObjectStore('kv');
      db.createObjectStore('ops', { keyPath: 'id' });
      db.createObjectStore('outbox', { keyPath: 'id' });
      db.createObjectStore('files');           // cached PDFs / evidence blobs by drive id
      db.createObjectStore('backups', { keyPath: 'at' });
    }
  });
}

export class Vault {
  constructor(db, { device } = {}) {
    this.db = db; this.device = device; this.state = emptyState();
    this.listeners = new Set(); this.adapter = null; this.syncing = false; this.lastSync = null; this.syncError = null;
  }
  static async open(opts = {}) {
    const db = await openStore(opts.dbName);
    let device = await db.get('kv', 'device');
    if (!device) { device = (opts.deviceLabel || 'dev') + '-' + uid().slice(0, 6); await db.put('kv', device, 'device'); }
    const v = new Vault(db, { device });
    const ops = await db.getAll('ops');
    applyAll(v.state, ops);
    v.lastSync = await db.get('kv', 'lastSync') || null;
    return v;
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.version = (this.version || 0) + 1; for (const fn of this.listeners) fn(this); }

  // ---- writes ----
  async commit(changes) { // changes: [{coll,key,kind,data}] -> ops
    const ops = changes.map(c => {
      const base = {};
      if (c.kind === 'patch' && c.data) for (const f of Object.keys(c.data)) base[f] = this.state._fts[c.coll]?.[c.key]?.[f] || '';
      return { id: uid('op'), ts: hlc(this.device), device: this.device, coll: c.coll, key: c.key, kind: c.kind, data: c.data ? structuredClone(c.data) : undefined, base: c.kind === 'patch' ? base : undefined };
    });
    const tx = this.db.transaction(['ops', 'outbox'], 'readwrite');
    for (const op of ops) { tx.objectStore('ops').put(op); tx.objectStore('outbox').put(op); }
    await tx.done;
    for (const op of ops) applyOp(this.state, op);
    this.emit();
    this.scheduleSync();
    return ops;
  }
  put(coll, data) { const key = data.id || uid(coll.slice(0, 2)); return this.commit([{ coll, key, kind: 'put', data: { ...data, id: key } }]).then(() => key); }
  patch(coll, key, data) { return this.commit([{ coll, key, kind: 'patch', data }]); }
  del(coll, key) { return this.commit([{ coll, key, kind: 'del' }]); }
  get(coll, key) { return get(this.state, coll, key); }
  list(coll, pred) { return list(this.state, coll, pred); }

  // ---- backups ----
  async backup(reason) {
    const at = Date.now();
    await this.db.put('backups', { at, reason, state: toJSON(this.state) });
    const all = await this.db.getAllKeys('backups');
    for (const k of all.slice(0, Math.max(0, all.length - 30))) await this.db.delete('backups', k);
    return at;
  }
  async backups() { return (await this.db.getAll('backups')).map(b => ({ at: b.at, reason: b.reason })).reverse(); }
  async restore(at) {
    const b = await this.db.get('backups', at); if (!b) throw new Error('Backup not found');
    await this.backup('Before restoring ' + new Date(at).toLocaleString());
    const ops = diffToOps(toJSON(this.state), b.state, this.device);
    const tx = this.db.transaction(['ops', 'outbox'], 'readwrite');
    for (const op of ops) { tx.objectStore('ops').put(op); tx.objectStore('outbox').put(op); }
    await tx.done; applyAll(this.state, ops); this.emit(); this.scheduleSync();
    return ops.length;
  }

  // ---- sync ----
  setAdapter(a) { this.adapter = a; this.emit(); }
  async pendingCount() { return (await this.db.count('outbox')); }
  scheduleSync(delay = 1500) {
    if (!this.adapter || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    clearTimeout(this._t); this._t = setTimeout(() => this.sync().catch(() => {}), delay);
  }
  async sync() {
    if (!this.adapter || this.syncing) return { skipped: true };
    this.syncing = true; this.syncError = null; this.emit();
    try {
      const known = new Set(await this.db.get('kv', 'knownFiles') || []);
      // pull
      const files = await this.adapter.listOpFiles();
      // newest snapshot first (covers many op files), then remaining op files
      const snaps = files.filter(f => f.name.startsWith('snapshot') && !known.has(f.name)).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 1);
      const fresh = [...snaps, ...files.filter(f => !f.name.startsWith('snapshot') && !known.has(f.name)).sort((a, b) => a.name.localeCompare(b.name))];
      let pulled = 0, fromClaude = false;
      const incoming = [];
      for (const f of fresh) {
        const txt = await this.adapter.readText(f);
        let batch; try { batch = JSON.parse(txt); } catch { continue; }
        const ops = (batch.ops || []).map(o => structuredClone(o));
        if (f.name.startsWith('snapshot')) { const inc = new Set(batch.includes || []); inc.forEach(n => known.add(n)); for (let i = fresh.length - 1; i >= 0; i--) if (inc.has(fresh[i].name)) fresh.splice(i, 1); }
        if ((batch.device || '').startsWith('claude')) fromClaude = true;
        incoming.push(...ops); known.add(f.name);
      }
      if (incoming.length) {
        if (fromClaude || incoming.length > 50) await this.backup(fromClaude ? 'Before applying Claude update' : 'Before large sync');
        const tx = this.db.transaction('ops', 'readwrite');
        for (const op of incoming) tx.store.put(op);
        await tx.done;
        pulled = applyAll(this.state, incoming);
      }
      // push
      const out = await this.db.getAll('outbox');
      let pushed = 0;
      if (out.length) {
        const name = `ops-${out[0].ts.split('.')[0]}-${this.device}-${uid().slice(0, 4)}.json`;
        await this.adapter.writeText(name, JSON.stringify({ device: this.device, ops: out }));
        known.add(name);
        const tx = this.db.transaction('outbox', 'readwrite');
        for (const op of out) tx.store.delete(op.id);
        await tx.done; pushed = out.length;
      }
      // compaction: occasionally write a snapshot so new devices load fast
      const opFiles = [...known].filter(n => n.startsWith('ops-'));
      const lastSnapCount = await this.db.get('kv', 'snapCount') || 0;
      if (opFiles.length - lastSnapCount > 150 && this.adapter.writeText) {
        const all = await this.db.getAll('ops');
        await this.adapter.writeText(`snapshot-${hlc(this.device).split('.')[0]}.json`, JSON.stringify({ device: this.device, includes: opFiles, ops: all }));
        await this.db.put('kv', opFiles.length, 'snapCount');
      }
      await this.db.put('kv', [...known], 'knownFiles');
      this.lastSync = Date.now(); await this.db.put('kv', this.lastSync, 'lastSync');
      try { const { uploadPendingFiles, linkFilesByName } = await import('./files.js'); await uploadPendingFiles(this); await linkFilesByName(this); } catch (e) { this.syncError = 'File upload: ' + (e.message || e); }
      try { const j = await import('../claude/jobs.js'); const n = await j.mergeRemoteResults(this); if (n) pulled += n; await j.writeStateForClaude(this); } catch (e) { console.warn('claude results', e); }
      return { pulled, pushed };
    } catch (e) { this.syncError = e.message || String(e); throw e; }
    finally { this.syncing = false; this.emit(); }
  }

  // ---- cached binary files (PDFs) ----
  async file(id) {
    let blob = await this.db.get('files', id);
    if (!blob && this.adapter && !String(id).startsWith('local:')) { blob = await this.adapter.readBlob(id); if (blob) await this.db.put('files', blob, id); }
    return blob || null;
  }
  async cacheFile(id, blob) { await this.db.put('files', blob, id); }

  // ---- device settings (not synced) ----
  async setting(k, v) { if (v === undefined) return this.db.get('kv', 'set:' + k); await this.db.put('kv', v, 'set:' + k); }
}
