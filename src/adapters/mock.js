// In-memory / shared storage adapter used by tests and the demo mode.
export class MockAdapter {
  constructor(store = new Map(), { freeze = false, failWrites = false } = {}) { this.store = store; this.freeze = freeze; this.failWrites = failWrites; this.blobs = new Map(); }
  async listOpFiles() { return [...this.store.keys()].filter(n => n.endsWith('.json')).map(name => ({ name, id: name })); }
  async readText(f) {
    const t = this.store.get(f.name);
    if (this.freeze) { // simulate connectors that return read-only objects
      const o = JSON.parse(t); deepFreeze(o); return JSON.stringify(o);
    }
    return t;
  }
  async writeText(name, text) { if (this.failWrites) throw new Error('offline'); this.store.set(name, text); }
  async readBlob(id) { return this.blobs.get(id) || null; }
}
function deepFreeze(o) { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; }
