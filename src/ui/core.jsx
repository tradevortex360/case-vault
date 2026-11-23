import { createContext, h } from 'preact';
import { useContext, useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { docName } from '../domain.js';

export const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);
export function useVault() {
  const app = useApp(); const [, setN] = useState(0);
  useEffect(() => app.v.subscribe(() => setN(n => n + 1)), [app.v]);
  return app.v;
}

// ---------- tiny router (hash in a normal browser, memory inside Claude) ----------
export function useRouter(inClaude) {
  const parse = s => (s || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [path, setPath] = useState(() => inClaude ? [] : parse(location.hash));
  useEffect(() => {
    if (inClaude) return;
    const on = () => setPath(parse(location.hash)); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on);
  }, []);
  const nav = useCallback((...p) => {
    const parts = p.flat().filter(x => x !== undefined && x !== null && x !== '');
    if (inClaude) { setPath(parts); window.__navStack = [...(window.__navStack || []), parts]; }
    else location.hash = '#/' + parts.map(encodeURIComponent).join('/');
    window.scrollTo(0, 0);
  }, []);
  const back = useCallback(() => {
    if (inClaude) { const st = window.__navStack || []; st.pop(); setPath(st[st.length - 1] || []); }
    else history.back();
  }, []);
  return { path, nav, back };
}

// ---------- sheets / dialogs / toast ----------
export function Sheet({ title, onClose, children, actions }) {
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  return <div class="sheet-bg" onClick={e => e.target === e.currentTarget && onClose()}>
    <div class="sheet" role="dialog" aria-label={title}>
      <div class="hd"><h3>{title}</h3>{actions}<button class="btn g s" onClick={onClose} aria-label="Close">Close</button></div>
      {children}
    </div></div>;
}
export function useSheet() {
  const [node, setNode] = useState(null);
  const open = (render) => setNode(() => render);
  const close = () => setNode(null);
  return { el: node ? node(close) : null, open, close };
}
export function confirmBox(app, text, okLabel = 'Confirm', danger = false) {
  return new Promise(res => app.sheet.open(close => <Sheet title="Please confirm" onClose={() => { close(); res(false); }}>
    <p>{text}</p>
    <div class="row"><button class={'btn ' + (danger ? 'bad' : '')} onClick={() => { close(); res(true); }}>{okLabel}</button><button class="btn g" onClick={() => { close(); res(false); }}>Cancel</button></div>
  </Sheet>));
}
export function Toast({ msg }) { return msg ? <div class="toast" role="status">{msg}</div> : null; }

export function Field({ label, children }) { return <div><label class="f">{label}</label>{children}</div>; }

// ---------- reply text as numbered points with × per point + undo ----------
// Split a reply into points: one per line, plus inline "2. …" only when it is the NEXT number
// in sequence (so "Respondent No. 1." or "Rs. 25." never start a new point).
export function splitPoints(text) {
  const out = []; let last = 0;
  for (const raw of (text || '').split(/\n+/)) {
    let line = raw.trim(); if (!line) continue;
    const lead = line.match(/^(?:\[[^\]]*\]\s*)?(\d{1,2})[.)]\s/);
    if (lead) last = +lead[1];
    let from = lead ? lead[0].length : 0;
    while (last) {
      const re = new RegExp('([.;:)\\]])\\s+(' + (last + 1) + ')[.)]\\s', 'g'); re.lastIndex = from;
      const m = re.exec(line); if (!m) break;
      const at = m.index + m[1].length; out.push(line.slice(0, at).trim()); line = line.slice(at).trim(); last++;
      from = String(last).length + 2;
    }
    out.push(line);
  }
  return out;
}
export function renumber(lines) { let n = 0; return lines.map(l => /^\d{1,2}[.)]\s/.test(l) ? (++n) + '. ' + l.replace(/^\d{1,2}[.)]\s*/, '') : l); }
export function PointLines({ text, onChange }) {
  const [undo, setUndo] = useState(null); const [gone, setGone] = useState(-1);
  const ls = splitPoints(text);
  if (ls.length < 2 || !onChange) return <div style="white-space:pre-wrap">{text}</div>;
  return <div>
    {ls.map((l, k) => <div class={'ln' + (gone === k ? ' gone' : '')} key={k + l.slice(0, 20)}><span>{l}</span>
      <button class="x" title="Remove this point" aria-label="Remove this point" onClick={() => { setGone(k); const prev = text; const nx = renumber(ls.filter((_, i) => i !== k)).join('\n'); setTimeout(() => { onChange(nx); setUndo(prev); setGone(-1); }, 180); }}>×</button></div>)}
    {undo && <button class="lnk" onClick={() => { onChange(undo); setUndo(null); }}>↶ Undo remove</button>}
  </div>;
}

// ---------- voice input ----------
// Inside Claude: the platform dictation capability. In a normal browser: Web Speech API (online).
// Offline: the phone keyboard's own mic (Gboard) types straight into the box.
export function Dictate({ onText, lang }) {
  const app = useApp(); const [on, setOn] = useState(false); const [err, setErr] = useState('');
  const ref = useRef(null);
  const dict = app.claude?.dictation;
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!dict && !SR) return null;
  const start = () => {
    setErr('');
    if (dict) {
      if (on) { dict.stop(); return; }
      const subs = [];
      const p = lang ? dict.start({ language: lang }) : dict.start();
      subs.push(dict.onFinal(({ text }) => onText(text)));
      subs.push(dict.onState(({ state, reason }) => { setOn(state !== 'idle'); if (state === 'idle') { subs.forEach(u => u()); if (reason && !['stopped', 'viewer_stopped'].includes(reason)) setErr(reason === 'unavailable' ? 'Voice not available for this language here — try Auto/English' : 'Voice stopped: ' + reason); } }));
      p.catch(e => { subs.forEach(u => u()); setOn(false); if (e?.code !== 'stopped') setErr(e?.code === 'not_granted' ? 'Microphone permission was declined' : 'Could not start voice (' + (e?.code || e) + ')'); });
      return;
    }
    if (on) { ref.current?.stop(); return; }
    const r = new SR(); ref.current = r; r.continuous = true; r.interimResults = false; if (lang) r.lang = lang;
    r.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(' ' + e.results[i][0].transcript); };
    r.onerror = e => setErr(e.error === 'not-allowed' ? 'Microphone permission was declined' : e.error === 'network' ? 'Voice needs internet here — use your keyboard mic offline' : 'Voice error: ' + e.error);
    r.onend = () => setOn(false);
    try { r.start(); setOn(true); } catch (e) { setErr(String(e)); }
  };
  return <span><button type="button" class={'btn s ' + (on ? 'bad' : 'g')} onClick={start}>{on ? '■ Stop' : '🎤 Speak'}</button>{err && <span class="tiny" style="color:var(--bad);margin-left:6px">{err}</span>}</span>;
}

// Text box with voice
export function TextBox({ value, onInput, placeholder, rows = 4, lang }) {
  return <div>
    <textarea rows={rows} value={value} placeholder={placeholder} onInput={e => onInput(e.currentTarget.value)} />
    <div class="row" style="margin-top:4px"><Dictate lang={lang} onText={t => onInput(((value || '') + ' ' + t).replace(/^\s+/, ''))} /></div>
  </div>;
}

// ---------- PDF page viewer (pdf.js, works offline from cached file) ----------
let pdfjsP = null;
async function pdfjs() {
  if (!pdfjsP) pdfjsP = (async () => {
    const lib = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    lib.GlobalWorkerOptions.workerSrc = worker.default; return lib;
  })();
  return pdfjsP;
}
export function PdfPage({ fileId, page = 1, title }) {
  const app = useApp(); const cv = useRef(null); const [state, setState] = useState({ p: page, n: 0, err: '', busy: true });
  const docRef = useRef(null);
  useEffect(() => { (async () => {
    try {
      const blob = await app.v.file(fileId);
      if (!blob) { setState(s => ({ ...s, busy: false, err: 'The original PDF is not on this device yet. Connect to the internet and sync once; after that it opens offline.' })); return; }
      const lib = await pdfjs();
      docRef.current = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      setState(s => ({ ...s, n: docRef.current.numPages }));
    } catch (e) { setState(s => ({ ...s, busy: false, err: 'Could not open the PDF: ' + e.message })); }
  })(); }, [fileId]);
  useEffect(() => { (async () => {
    const d = docRef.current; if (!d || !cv.current) return;
    setState(s => ({ ...s, busy: true }));
    const pg = await d.getPage(Math.min(Math.max(1, state.p), d.numPages));
    const vp = pg.getViewport({ scale: 2 }); const c = cv.current; c.width = vp.width; c.height = vp.height;
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    setState(s => ({ ...s, busy: false }));
  })(); }, [state.n, state.p]);
  if (state.err) return <div class="box warn">{state.err}</div>;
  return <div>
    <div class="between" style="margin-bottom:6px"><span class="small mut">{title}</span>
      <span class="row"><button class="btn g s" disabled={state.p <= 1} onClick={() => setState(s => ({ ...s, p: s.p - 1 }))}>‹</button><span class="small">p. {state.p}{state.n ? ' / ' + state.n : ''}</span><button class="btn g s" disabled={state.n && state.p >= state.n} onClick={() => setState(s => ({ ...s, p: s.p + 1 }))}>›</button></span></div>
    <div class="pdfwrap"><canvas ref={cv} />{state.busy && <div class="mut small" style="padding:8px;color:#ddd">Loading page…</div>}</div>
  </div>;
}
export function openPdf(app, doc, page) {
  if (!doc?.fileId) { app.toast('No PDF attached to this document yet'); return; }
  app.sheet.open(close => <Sheet title={docName(doc) + ' — page ' + page} onClose={close}><PdfPage fileId={doc.fileId} page={page} title={doc.title} /></Sheet>);
}

export const fmtMoney = n => '₹' + Number(n || 0).toLocaleString('en-IN');
export const todayISO = () => new Date().toISOString().slice(0, 10);
export function Empty({ children }) { return <div class="empty">{children}</div>; }
