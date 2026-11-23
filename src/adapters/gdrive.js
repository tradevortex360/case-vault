// Google Drive adapter for the installed (offline-capable) app.
// Uses Google Identity Services (browser sign-in, no server) and the Drive REST API.
// Vault layout inside the chosen root folder (default "Legal"):
//   inbox/  documents/  evidence/  exports/  vault/ops/  README-for-Claude.md
const API = 'https://www.googleapis.com/drive/v3';
const UP = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
export const SUBFOLDERS = ['inbox', 'documents', 'evidence', 'exports', 'vault', 'vault/ops', 'vault/jobs', 'vault/results'];

let gisP = null;
function loadGIS() {
  return gisP ||= new Promise((res, rej) => {
    if (window.google?.accounts?.oauth2) return res();
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => { gisP = null; rej(new Error('Could not load Google sign-in (offline?)')); };
    document.head.appendChild(s);
  });
}

export class GoogleDriveAdapter {
  constructor({ clientId, rootName = 'Legal', v }) { this.clientId = clientId; this.rootName = rootName; this.v = v; this.token = null; this.exp = 0; this.ids = {}; this.kind = 'gdrive'; }

  async signIn(interactive = true) {
    await loadGIS();
    return new Promise((res, rej) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId, scope: 'https://www.googleapis.com/auth/drive',
        prompt: interactive ? '' : 'none',
        callback: r => { if (r.error) return rej(new Error(r.error)); this.token = r.access_token; this.exp = Date.now() + (r.expires_in - 60) * 1000; res(true); },
        error_callback: e => rej(new Error(e.type || 'sign-in failed')),
      });
      tc.requestAccessToken();
    });
  }
  get signedIn() { return !!this.token && Date.now() < this.exp; }
  async auth() { if (!this.signedIn) { try { await this.signIn(false); } catch { throw Object.assign(new Error('Google Drive sign-in needed'), { code: 'reauth' }); } } return this.token; }

  async req(url, opts = {}, retry = 2) {
    const t = await this.auth();
    const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } });
    if (r.status === 401) { this.token = null; if (retry) return this.req(url, opts, retry - 1); }
    if ((r.status === 429 || r.status >= 500) && retry) { await new Promise(s => setTimeout(s, 800 * (3 - retry))); return this.req(url, opts, retry - 1); }
    if (!r.ok) throw new Error(`Drive ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r;
  }
  async q(query, fields = 'files(id,name,mimeType,modifiedTime,size,createdTime),nextPageToken') {
    const out = []; let pt = '';
    do {
      const r = await (await this.req(`${API}/files?q=${encodeURIComponent(query + ' and trashed=false')}&fields=${encodeURIComponent(fields)}&pageSize=1000&spaces=drive${pt ? '&pageToken=' + pt : ''}`)).json();
      out.push(...(r.files || [])); pt = r.nextPageToken || '';
    } while (pt);
    return out;
  }
  async folder(name, parent) {
    const found = await this.q(`name='${name.replace(/'/g, "\\'")}' and mimeType='${FOLDER}' and '${parent}' in parents`);
    if (found[0]) return found[0].id;
    const r = await (await this.req(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) })).json();
    return r.id;
  }
  async ensure() {
    if (this.ids.root) return this.ids;
    const saved = await this.v?.setting('driveIds');
    if (saved?.root) { this.ids = saved; return this.ids; }
    this.ids.root = await this.folder(this.rootName, 'root');
    for (const p of SUBFOLDERS) { const parts = p.split('/'); const parent = parts.length > 1 ? this.ids[parts.slice(0, -1).join('/')] : this.ids.root; this.ids[p] = await this.folder(parts.at(-1), parent); }
    await this.v?.setting('driveIds', this.ids);
    return this.ids;
  }
  // ---- adapter interface used by Vault.sync ----
  async listOpFiles() { const ids = await this.ensure(); return (await this.q(`'${ids['vault/ops']}' in parents`)).filter(f => f.name.endsWith('.json')); }
  async readText(f) { return (await this.req(`${API}/files/${f.id}?alt=media`)).text(); }
  async writeText(name, text, folderKey = 'vault/ops', mime = 'application/json') {
    const ids = await this.ensure();
    return this.upload(name, new Blob([text], { type: mime }), folderKey, ids);
  }
  async readBlob(id) { return (await this.req(`${API}/files/${id}?alt=media`)).blob(); }
  async upload(name, blob, folderKey = 'documents', ids) {
    ids ||= await this.ensure();
    const meta = { name, parents: [ids[folderKey]] };
    const fd = new FormData(); fd.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' })); fd.append('file', blob);
    const r = await (await this.req(`${UP}/files?uploadType=multipart&fields=id,name`, { method: 'POST', body: fd })).json();
    return r.id;
  }
  async replaceText(name, text, folderKey = 'vault', mime = 'application/json') { // overwrite in place (installed app only)
    const ex = await this.findByName(name, folderKey);
    if (!ex) return this.writeText(name, text, folderKey, mime);
    await this.req(`${UP}/files/${ex.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': mime }, body: text });
    return ex.id;
  }
  async listFolder(folderKey) { const ids = await this.ensure(); return this.q(`'${ids[folderKey]}' in parents`); }
  async move(id, toKey, fromKey) { const ids = await this.ensure(); await this.req(`${API}/files/${id}?addParents=${ids[toKey]}&removeParents=${ids[fromKey]}&fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' }); }
  async findByName(name, folderKey) { const ids = await this.ensure(); return (await this.q(`name='${name.replace(/'/g, "\\'")}' and '${ids[folderKey]}' in parents`))[0] || null; }
}
