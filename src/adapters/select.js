import { DEFAULT_GOOGLE_CLIENT_ID } from '../config.js';
import { GoogleDriveAdapter } from './gdrive.js';
import { ClaudeDriveAdapter } from './claude.js';
import { MockAdapter } from './mock.js';

// Chooses how this device talks to the vault in Google Drive.
export async function setupAdapter(v, { inClaude, claude }) {
  if (window.__TEST_ADAPTER) { v.setAdapter(window.__TEST_ADAPTER); return; }
  if (inClaude) {
    const wait = () => new Promise(r => { const t = setInterval(() => { if (claude.mcp !== undefined) { clearInterval(t); r(); } }, 200); setTimeout(() => { clearInterval(t); r(); }, 11000); });
    await wait();
    if (claude.mcp) { v.setAdapter(new ClaudeDriveAdapter(claude.mcp, { v, rootName: (await v.setting('rootName')) || 'Legal' })); }
    return;
  }
  const clientId = (await v.setting('googleClientId')) || (location.hostname.endsWith('github.io') ? DEFAULT_GOOGLE_CLIENT_ID : '');
  if (clientId) {
    const a = new GoogleDriveAdapter({ clientId, rootName: (await v.setting('rootName')) || 'Legal', v });
    v.setAdapter(a);
    try { await a.signIn(false); v.scheduleSync(100); } catch { /* user taps "Connect Google Drive" */ }
  }
}

export function demoAdapter() {
  // Shared browser storage, used for the demo and for automated tests of two "devices".
  const KEY = 'casevault-demo-drive';
  const store = new Map(Object.entries(JSON.parse(localStorage.getItem(KEY) || '{}')));
  const a = new MockAdapter(store);
  const w = a.writeText.bind(a);
  a.writeText = async (n, t) => { await w(n, t); localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(store))); };
  a.kind = 'demo';
  return a;
}
