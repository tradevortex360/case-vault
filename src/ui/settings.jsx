import { formatWhen } from '../search/dates.js';
import { DEFAULT_GOOGLE_CLIENT_ID } from '../config.js';
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useApp, useVault, Field, confirmBox, Sheet } from './core.jsx';
import { GoogleDriveAdapter } from '../adapters/gdrive.js';
import { loadEmbedder } from '../search/index.js';
import { setEmbedder } from './search.jsx';
import { applyResult } from '../claude/merge.js';
import { toJSON, uid, hlc } from '../store/ops.js';
import { saveBlob } from './exports.jsx';

function DriveCard() {
  const app = useApp(); const v = useVault();
  const [cid, setCid] = useState(''); const [root, setRoot] = useState('Legal'); const [busy, setBusy] = useState(false);
  useEffect(() => { (async () => { setCid((await v.setting('googleClientId')) || (location.hostname.endsWith('github.io') ? DEFAULT_GOOGLE_CLIENT_ID : '')); setRoot((await v.setting('rootName')) || 'Legal'); })(); }, []);
  const a = v.adapter;
  const connect = async () => {
    if (!cid.trim()) return app.toast('Paste your Google Client ID first (see the setup guide)');
    setBusy(true);
    try {
      await v.setting('googleClientId', cid.trim()); await v.setting('rootName', root.trim() || 'Legal'); await v.setting('driveIds', null);
      const ad = new GoogleDriveAdapter({ clientId: cid.trim(), rootName: root.trim() || 'Legal', v });
      await ad.signIn(true); await ad.ensure(); v.setAdapter(ad); await v.sync(); app.toast('Connected to Google Drive');
    } catch (e) { app.toast('Could not connect: ' + (e.message || e), 6000); }
    setBusy(false);
  };
  return <div class="card pad">
    <h3 style="margin-top:0">Google Drive</h3>
    {app.inClaude ? <div class="small">Inside Claude, the app uses your <b>Google Drive connector</b>. {a ? <span class="tag ok">connected</span> : <span class="tag bad">not available — add Google Drive in Claude settings → Connectors</span>}</div> : <>
      <div class="small">{a ? <><span class="tag ok">connected</span> Folder: <b>{root}</b></> : <span class="tag bad">not connected</span>}{v.syncError && <div class="box bad small" style="margin-top:6px">Last sync problem: {v.syncError}</div>}</div>
      <details style="margin-top:8px" open={!location.hostname.endsWith('github.io')}><summary class="small mut">Advanced: Google sign-in ID and folder name</summary>
      <Field label="Google Client ID (one-time setup)"><input type="text" value={cid} placeholder="xxxx.apps.googleusercontent.com" onInput={e => setCid(e.currentTarget.value)} /></Field>
      <Field label="Main folder in My Drive"><input type="text" value={root} onInput={e => setRoot(e.currentTarget.value)} /></Field></details>
      <div class="row" style="margin-top:8px"><button class="btn" disabled={busy} onClick={connect}>{a ? 'Reconnect' : 'Connect Google Drive'}</button>
        {a && <button class="btn g" onClick={() => (a.ensureSignedIn ? a.ensureSignedIn() : Promise.resolve()).then(() => v.sync()).then(r => app.toast(`Synced: ${r.pulled || 0} in, ${r.pushed || 0} out`)).catch(e => app.toast('Sync failed: ' + e.message, 6000))}>Sync now</button>}</div></>}
    {v.syncError && <div class="box bad small" style="margin-top:8px">{v.syncError}</div>}
    {v.lastSync && <div class="tiny mut" style="margin-top:6px">Last sync {formatWhen(v.lastSync)} · device {v.device}</div>}
  </div>;
}

function LockCard() {
  const app = useApp(); const v = useVault(); const [bio, setBio] = useState(null);
  useEffect(() => { v.setting('bioId').then(setBio); }, []);
  const enableBio = async () => {
    try {
      const cred = await navigator.credentials.create({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(16)), rp: { name: 'Case Vault' }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'case-vault', displayName: 'Case Vault' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' }, timeout: 60000 } });
      const id = btoa(String.fromCharCode(...new Uint8Array(cred.rawId))); await v.setting('bioId', id); setBio(id); app.toast('Fingerprint unlock enabled');
    } catch (e) { app.toast('Fingerprint not available here: ' + (e.message || e), 5000); }
  };
  return <div class="card pad"><h3 style="margin-top:0">App lock</h3>
    <div class="row"><button class="btn g" onClick={async () => { if (await confirmBox(app, 'Set a new PIN? You will choose it on the next screen.', 'Change PIN')) { await v.setting('pinHash', null); location.reload(); } }}>Change PIN</button>
      {window.PublicKeyCredential && (bio ? <button class="btn g" onClick={async () => { await v.setting('bioId', null); setBio(null); }}>Turn off fingerprint</button> : <button class="btn g" onClick={enableBio}>Use fingerprint to unlock</button>)}</div>
    <div class="tiny mut" style="margin-top:6px">The app locks itself after 5 minutes in the background.</div></div>;
}

function SmartSearchCard() {
  const app = useApp(); const v = useVault(); const [st, setSt] = useState('');
  useEffect(() => { v.setting('smartSearch').then(on => { if (on && !window.__emb) start(true); }); }, []);
  const start = async (silent) => {
    setSt('Loading model…');
    try { const e = await loadEmbedder(p => p?.progress && setSt(`Downloading model… ${Math.round(p.progress)}%`)); window.__emb = e; setEmbedder(e); await v.setting('smartSearch', true); setSt('on'); if (!silent) app.toast('Smart search is on'); }
    catch (e) { setSt(''); if (!silent) app.toast('Could not load the model (needs internet the first time): ' + (e.message || e), 6000); }
  };
  return <div class="card pad"><h3 style="margin-top:0">Smart search (by meaning)</h3>
    <div class="small mut">Finds things by meaning in English and Bengali — "forced to leave" also finds "compelled to vacate". One-time download (~120 MB) over Wi-Fi; afterwards it works offline.</div>
    <div class="row" style="margin-top:8px">{st === 'on' || window.__emb ? <span class="tag ok">on</span> : <button class="btn g" disabled={!!st} onClick={() => start(false)}>{st || 'Turn on'}</button>}</div></div>;
}

export async function importFile(v, data) {
  const r = data.type === 'import' ? data : data.vault ? { type: 'import', records: data.vault } : null;
  if (!r) throw new Error('unknown format');
  await v.backup('Before import');
  return applyResult(v, r);
}

function BackupsCard() {
  const app = useApp(); const v = useVault(); const [list, setList] = useState([]);
  useEffect(() => { v.backups().then(setList); }, [v.version]);
  const exportAll = async () => { const blob = new Blob([JSON.stringify({ exportedAt: Date.now(), vault: toJSON(v.state) }, null, 1)], { type: 'application/json' }); const w = await saveBlob(app, blob, `case-vault-backup-${new Date().toISOString().slice(0, 10)}.json`); app.toast(w === 'not saved' ? 'Could not save the backup here' : w === 'downloaded' ? 'Backup downloaded' : 'Backup saved to Drive → Legal → exports'); };
  return <div class="card pad"><h3 style="margin-top:0">Backups & history</h3>
    <div class="small mut">A snapshot is taken automatically before every Claude update and large sync, and before any restore. Restoring undoes later changes on all devices.</div>
    <div class="row" style="margin:8px 0"><button class="btn g s" onClick={async () => { await v.backup('Manual backup'); app.toast('Backup taken'); }}>Take a backup now</button><button class="btn g s" onClick={exportAll}>Export everything (file)</button>
      <label class="btn g s" style="cursor:pointer">Import a vault file<input type="file" accept="application/json,.json" style="display:none" onChange={async e => { const inp = e.currentTarget; const f = inp.files[0]; if (!f) return; try { const n = await importFile(v, JSON.parse(await f.text())); app.toast(n ? `Imported ${n} items` : 'Nothing new to import'); } catch (err) { app.toast('Not a Case Vault file: ' + err.message, 6000); } inp.value = ''; }} /></label></div>
    {list.slice(0, 15).map(b => <div class="between small" key={b.at} style="padding:4px 0;border-top:1px solid var(--line)"><span>{formatWhen(b.at)} — {b.reason}</span>
      <button class="lnk" onClick={async () => { if (await confirmBox(app, 'Restore the vault to ' + formatWhen(b.at) + '? Changes made after it are undone (a backup of the current state is taken first).', 'Restore')) { const n = await v.restore(b.at); app.toast(`Restored (${n} changes undone)`); } }}>Restore</button></div>)}
    {!list.length && <div class="tiny mut">No backups yet.</div>}</div>;
}

function ConflictsCard() {
  const app = useApp(); const v = useVault();
  const cs = ['replies', 'events', 'notes', 'hearings', 'evidence', 'consolidated'].flatMap(c => v.list(c, r => r._conflicts?.length).map(r => ({ c, r })));
  if (!cs.length) return null;
  return <div class="card pad"><h3 style="margin-top:0">Edited on two devices <span class="tag bad">{cs.length}</span></h3>
    <div class="small mut">The same text was changed on two devices before they synced. Both versions were kept — choose one.</div>
    {cs.map(({ c, r }) => r._conflicts.map((x, i) => <div class="card pad small" key={r.id + i}><div class="mut">{c} · field “{x.field}”</div>
      <div class="grid2"><div><b>Current</b><div style="white-space:pre-wrap">{String(r[x.field] ?? '')}</div><button class="btn s" onClick={() => v.patch(c, r.id, { _conflicts: null })}>Keep current</button></div>
        <div><b>Other device</b><div style="white-space:pre-wrap">{String(x.value ?? '')}</div><button class="btn s g" onClick={() => v.patch(c, r.id, { [x.field]: x.value, _conflicts: null })}>Keep this</button></div></div></div>))}
  </div>;
}

function JobsCard() {
  const app = useApp(); const v = useVault();
  const q = v.list('jobs', j => j.status === 'queued'); const need = v.list('jobs', j => j.status === 'needs_you');
  const cases = v.list('cases');
  return <div class="card pad"><h3 style="margin-top:0">Claude jobs</h3>
    {need.map(j => <div class="box warn small" key={j.id}><b>Which case does “{j.result?.document?.title || j.result?.fileName}” belong to?</b>
      <div class="row" style="margin-top:6px">{cases.map(c => <button class="btn s g" onClick={async () => { await applyResult(v, { ...j.result, caseId: c.id }); await v.patch('jobs', j.id, { status: 'done' }); app.toast('Filed in ' + c.name); }}>{c.name}</button>)}</div></div>)}
    {!q.length && !need.length && <div class="small mut">Nothing waiting.</div>}
    {q.map(j => <div class="between small" key={j.id} style="padding:3px 0"><span>{j.type.replace('_', ' ')} · {formatWhen(j.requestedAt)}{j.lastError ? ' · last error: ' + j.lastError : ''}</span><button class="lnk bad" onClick={() => v.patch('jobs', j.id, { status: 'cancelled' })}>Cancel</button></div>)}
  </div>;
}

export function Settings() {
  const app = useApp();
  return <main>
    <JobsCard />
    <ConflictsCard />
    <DriveCard />
    <LockCard />
    <SmartSearchCard />
    <BackupsCard />
    <div class="card pad small mut">Case Vault · your data lives on your devices and in your own Google Drive. Claude only sees it when you run a Claude job or use the app inside Claude.</div>
  </main>;
}
