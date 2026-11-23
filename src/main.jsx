import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './ui/style.css';
import { Vault } from './store/vault.js';
import { App } from './ui/app.jsx';
import { setupAdapter } from './adapters/select.js';

async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join(''); }

function Lock({ v, onOpen }) {
  const [mode, setMode] = useState('loading'); const [pin, setPin] = useState(''); const [pin2, setPin2] = useState(''); const [err, setErr] = useState('');
  const [bio, setBio] = useState(null);
  const waitUntil = until => { setMode('wait'); setErr('Too many wrong PINs. Try again in a moment.'); setTimeout(() => { setMode('enter'); setErr(''); }, Math.max(0, until - Date.now())); };
  // the wait survives closing and reopening the app
  useEffect(() => { (async () => { const h = await v.setting('pinHash'); setBio(await v.setting('bioId')); const until = (await v.setting('lockUntil')) || 0; if (h && until > Date.now()) waitUntil(until); else setMode(h ? 'enter' : 'create'); })(); }, []);
  const tryBio = async () => {
    try {
      await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(16)), allowCredentials: [{ type: 'public-key', id: Uint8Array.from(atob(bio), c => c.charCodeAt(0)) }], userVerification: 'required', timeout: 60000 } });
      onOpen();
    } catch { setErr('Fingerprint not accepted — use your PIN'); }
  };
  useEffect(() => { if (mode === 'enter' && bio) tryBio(); }, [mode, bio]);
  const submit = async e => {
    e.preventDefault(); setErr('');
    const salt = v.device;
    if (mode === 'create') {
      if (!/^\d{4,8}$/.test(pin)) return setErr('Use 4 to 8 digits');
      if (pin !== pin2) return setErr('The two PINs do not match');
      await v.setting('pinHash', await sha(salt + pin)); onOpen(); return;
    }
    if ((await sha(salt + pin)) === await v.setting('pinHash')) { await v.setting('failCount', 0); onOpen(); }
    else { const f = ((await v.setting('failCount')) || 0) + 1; await v.setting('failCount', f); setPin(''); if (f >= 5 && f % 5 === 0) { const until = Date.now() + 30000 * (f / 5); await v.setting('lockUntil', until); waitUntil(until); } else setErr(`Wrong PIN (${5 - (f % 5)} tries left before a wait)`); }
  };
  if (mode === 'loading') return null;
  return <div class="lock"><form class="card" onSubmit={submit}>
    <h2 style="margin-top:0">Case Vault</h2>
    {mode === 'create' ? <p class="mut small">Set a PIN for this device. It locks the app; your data stays on this device and in your Google Drive.</p> : <p class="mut small">Enter your PIN</p>}
    {mode !== 'wait' && <input class="pin" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} onInput={e => setPin(e.currentTarget.value.replace(/\D/g, ''))} autoFocus aria-label="PIN" />}
    {mode === 'create' && <input class="pin" style="margin-top:8px" type="password" inputMode="numeric" maxLength={8} placeholder="repeat" value={pin2} onInput={e => setPin2(e.currentTarget.value.replace(/\D/g, ''))} aria-label="Repeat PIN" />}
    {err && <p style="color:var(--bad)" class="small">{err}</p>}
    {mode !== 'wait' && <button class="btn" style="width:100%;margin-top:12px" type="submit">{mode === 'create' ? 'Set PIN' : 'Unlock'}</button>}
    {mode === 'enter' && bio && <button class="btn g" type="button" style="width:100%;margin-top:8px" onClick={tryBio}>Use fingerprint</button>}
  </form></div>;
}

function Root({ v, inClaude, claude }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { // auto-lock after 5 minutes in background
    // phones freeze background timers, so also compare the time spent hidden when the app comes back
    let t, hiddenAt = 0; const on = () => { if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); t = setTimeout(() => setOpen(false), 5 * 60 * 1000); } else { clearTimeout(t); if (hiddenAt && Date.now() - hiddenAt >= 5 * 60 * 1000) setOpen(false); hiddenAt = 0; } };
    document.addEventListener('visibilitychange', on); return () => document.removeEventListener('visibilitychange', on);
  }, []);
  if (!open && !window.__TEST_NO_LOCK) return <Lock v={v} onOpen={() => setOpen(true)} />;
  return <App v={v} inClaude={inClaude} claude={claude} />;
}

(async () => {
  const inClaude = !!(window.claude && window.claude.use);
  const ua = navigator.userAgent; const label = inClaude ? 'claudepage' : /Android|iPhone/i.test(ua) ? 'phone' : 'laptop';
  const v = await Vault.open({ deviceLabel: label, dbName: window.__TEST_DB });
  window.__vault = v;
  const claude = inClaude ? {} : null;
  render(<Root v={v} inClaude={inClaude} claude={claude} />, document.getElementById('app'));
  // capabilities arrive later inside Claude; the app lights features up as they resolve
  if (inClaude) {
    for (const cap of ['sample', 'dictation', 'mcp', 'downloads']) window.claude.use(cap).then(x => { claude[cap] = x; v.emit(); }).catch(() => {});
  }
  await setupAdapter(v, { inClaude, claude });
  if ('serviceWorker' in navigator && !inClaude && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
  addEventListener('online', () => v.scheduleSync(200));
  setInterval(() => v.scheduleSync(0), 5 * 60 * 1000);
})();
