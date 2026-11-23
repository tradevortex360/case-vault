import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Ctx, useRouter, useSheet, Toast, Sheet, useVault } from './core.jsx';
import { Home } from './cases.jsx';
import { CaseShell } from './caseShell.jsx';
import { Settings } from './settings.jsx';
import { SearchSheet } from './search.jsx';
import { runQueuedJobs, canRunNow } from '../claude/jobs.js';

function SyncBadge() {
  const app = window.__app; const v = useVault(); const [pending, setPending] = useState(0);
  useEffect(() => { v.pendingCount().then(setPending); }, [v.version]);
  const a = v.adapter;
  let cls = '', txt = 'Offline copy';
  if (!a) { txt = 'Not connected to Drive'; cls = 'bad'; }
  else if (v.syncing) { txt = 'Syncing…'; cls = 'busy'; }
  else if (v.syncError) { txt = /sign-in|reauth/i.test(v.syncError) ? 'Tap to sign in to Drive' : navigator.onLine ? 'Sync problem' : 'Offline'; cls = 'bad'; }
  else if (pending) { txt = `${pending} change${pending > 1 ? 's' : ''} to sync`; cls = 'busy'; }
  else if (v.lastSync) { txt = 'Synced ' + new Date(v.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); cls = 'ok'; }
  return <button class="sync lnk" style="color:var(--mut)" onClick={async () => { if (a?.ensureSignedIn && /sign-in/i.test(v.syncError || '')) { try { await a.ensureSignedIn(); await v.sync(); } catch (e) { app.toast('Could not sign in: ' + (e.message || e), 6000); } } else app.nav('settings'); }} title={v.syncError || ''}><span class={'dot ' + cls} />{txt}</button>;
}

export function App({ v, inClaude, claude }) {
  const router = useRouter(inClaude);
  const sheet = useSheet();
  const [msg, setMsg] = useState('');
  const app = {
    v, inClaude, claude, sheet, nav: router.nav, back: router.back, path: router.path,
    toast: (m, ms = 2600) => { setMsg(m); clearTimeout(window.__tt); window.__tt = setTimeout(() => setMsg(''), ms); },
  };
  window.__app = app;
  const [, bump] = useState(0);
  useEffect(() => v.subscribe(() => bump(n => n + 1)), [v]);
  const [p0, p1] = router.path;
  let body, title = 'Case Vault', showBack = router.path.length > 0;
  if (p0 === 'settings') { body = <Settings />; title = 'Settings'; }
  else if (p0 === 'case' && v.get('cases', p1)) { body = <CaseShell caseId={p1} />; title = v.get('cases', p1).name; }
  else { body = <Home />; showBack = false; }

  const updateVault = async () => {
    if (canRunNow(app)) { await runQueuedJobs(app, { includeInbox: true }); }
    else {
      await v.put('jobs', { type: 'process_inbox', status: 'queued', requestedAt: Date.now(), device: v.device });
      app.toast('Queued. Claude processes it at the next scheduled run, or open the app inside Claude to run it now.', 5000);
    }
  };

  return <Ctx.Provider value={app}>
    <div class="app">
      <div class="top">
        {showBack && <button class="back" aria-label="Back" onClick={() => router.back()}>‹</button>}
        <h1>{title}</h1>
        <button class="btn g s gear" aria-label="Settings" title="Settings" onClick={() => router.nav('settings')}><svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 5.5h8M15 5.5h2M3 10h3M10 10h7M3 14.5h9M16 14.5h1" /><circle cx="13" cy="5.5" r="1.8" /><circle cx="8" cy="10" r="1.8" /><circle cx="14" cy="14.5" r="1.8" /></svg></button>
        <div class="acts"><SyncBadge />
          <button class="btn g s" aria-label="Search" onClick={() => sheet.open(close => <SearchSheet onClose={close} caseId={p0 === 'case' ? p1 : null} />)}>Search</button>
          <button class="btn s" onClick={updateVault} title="Process new documents in the Drive inbox and run queued Claude jobs">Update vault</button></div>
      </div>
      {body}
    </div>
    {sheet.el}
    <Toast msg={msg} />
  </Ctx.Provider>;
}
