import { h } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp, useVault, Sheet, openPdf } from './core.jsx';
import { SearchIndex, buildItems, tokenize } from '../search/index.js';
import { parseQuery, formatDate } from '../search/dates.js';

let embedder = null; export const setEmbedder = e => { embedder = e; };

function Snip({ text, q }) {
  const terms = new Set(tokenize(q)); if (!text) return null;
  const words = text.split(/(\s+)/); let first = words.findIndex(w => terms.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')));
  const start = Math.max(0, first - 20); const slice = words.slice(start, start + 70);
  return <div class="small">{start > 0 && '…'}{slice.map((w, i) => terms.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')) ? <mark class="hl" key={i}>{w}</mark> : w)}{start + 70 < words.length && '…'}</div>;
}

export function SearchSheet({ onClose, caseId }) {
  const app = useApp(); const v = useVault();
  const [q, setQ] = useState(''); const [scope, setScope] = useState(caseId || ''); const [type, setType] = useState(''); const [res, setRes] = useState([]); const [busy, setBusy] = useState(false);
  const idx = useMemo(() => { const i = new SearchIndex().build(buildItems(v)); if (embedder) i.setEmbedder(embedder); return i; }, [v.version]);
  const t = useRef();
  useEffect(() => { clearTimeout(t.current); if (!q.trim()) { setRes([]); return; } t.current = setTimeout(async () => { setBusy(true); try { setRes(await idx.search(q, { caseId: scope || undefined, types: type ? [type] : undefined })); } finally { setBusy(false); } }, 220); }, [q, scope, type, idx]);
  const pq = q.trim() ? parseQuery(q) : null;
  const go = r => {
    onClose();
    const c = r.caseId;
    if (r.type === 'Event') app.nav('case', c, 'ev', r.ref);
    else if (r.type === 'Paragraph') { app.nav('case', c, 'doc', r.docId); setTimeout(() => document.getElementById('p-' + r.ref)?.scrollIntoView({ block: 'center' }), 300); }
    else if (r.type === 'My reply' || r.type === 'Suggested reply') { const rr = v.get('replies', r.ref); if (rr?.allegationId) app.nav('case', c, 'al', rr.allegationId); else if (rr?.paraId) app.nav('case', c, 'doc', v.get('paragraphs', rr.paraId)?.docId); }
    else if (r.type === 'Consolidated response') app.nav('case', c, 'al', r.ref);
    else app.nav('case', c, { Evidence: 'evidence', Hearing: 'hearings', 'Contact log': 'people', 'Q&A': 'ask', Verification: 'verify', Note: 'documents' }[r.type] || 'overview');
  };
  const cases = v.list('cases');
  return <Sheet title="Search" onClose={onClose}>
    <input type="search" autoFocus placeholder='Try "keys", "April 2026", "between March and May 2026 police", "after 10.11.2023"' value={q} onInput={e => setQ(e.currentTarget.value)} />
    <div class="row small" style="margin:6px 0">
      <select style="width:auto" value={scope} onChange={e => setScope(e.currentTarget.value)} aria-label="Case"><option value="">All cases</option>{cases.map(c => <option value={c.id}>{c.name}</option>)}</select>
      <select style="width:auto" value={type} onChange={e => setType(e.currentTarget.value)} aria-label="Type"><option value="">Everything</option>{['Event', 'Paragraph', 'My reply', 'Consolidated response', 'Evidence', 'Hearing', 'Contact log', 'Q&A', 'Verification'].map(x => <option>{x}</option>)}</select>
      {embedder ? <span class="tag ok">smart search on</span> : <span class="tiny mut">Smart (meaning) search can be turned on in Settings</span>}
    </div>
    {pq && (pq.from || pq.to) && <div class="tiny mut">Dates: {pq.from ? formatDate(pq.from) : '…'} → {pq.to ? formatDate(pq.to) : '…'}{pq.text ? ' · about: ' + pq.text : ''}</div>}
    {busy && <div class="small mut">Searching…</div>}
    {q && !busy && !res.length && <div class="empty">Nothing found. Try other words or a wider date range.</div>}
    <div class="card list" style="margin-top:6px">{res.map(r => <div class="item" key={r.id} onClick={() => go(r)}>
      <div class="d">{r.date ? formatDate(r.date) : '—'}</div>
      <div class="grow"><div><span class="tag">{r.type}</span>{r.verified && <span class="tag ok">✓</span>}{!scope && cases.length > 1 && <span class="tiny mut">{v.get('cases', r.caseId)?.name}</span>}</div>
        <b class="small">{r.title}</b><Snip text={r.text} q={pq?.text || q} />
        {r.type === 'Paragraph' && r.page && <button class="lnk" onClick={e => { e.stopPropagation(); openPdf(app, v.get('documents', r.docId), r.page); }}>open page {r.page}</button>}</div></div>)}</div>
  </Sheet>;
}
