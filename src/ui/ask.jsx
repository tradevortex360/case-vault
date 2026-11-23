import { h } from 'preact';
import { useState, useRef } from 'preact/hooks';
import { useApp, useVault, TextBox, Empty, confirmBox } from './core.jsx';
import { canRunNow } from '../claude/jobs.js';
import { askSystem } from '../claude/prompts.js';
import { SearchIndex, buildItems } from '../search/index.js';
import { allegationsOf, eventsOf, parasOf, docsOf, paraStatus, needsReply, docCite, docLong } from '../domain.js';
import { formatDate, overlaps, parseDate, formatWhen } from '../search/dates.js';

const QUICK = [
  ['Case assessment', 'Give me a frank assessment of where I stand in this case right now: my strongest points, my weakest points, and the main risks. Cite the documents and replies you rely on.'],
  ['What am I missing?', 'Which allegations or paragraphs have I not answered, which of my claims have no supporting evidence, and what facts could give me an upper hand that I have not used?'],
  ['Consistency check', 'Check my replies against each other and against my own earlier filings and verified timeline. List every contradiction or inconsistency, with references.'],
  ['Before filing', 'I am about to send my replies to my advocate. Review them for anything that could hurt me, anything overstated, and anything that needs evidence. Be specific.'],
];

export function vaultTools(v, caseId) {
  const idx = new SearchIndex().build(buildItems(v, caseId));
  const docs = Object.fromEntries(docsOf(v, caseId).map(d => [d.id, d]));
  const clip = (s, n = 600) => (s || '').length > n ? s.slice(0, n) + '…' : (s || '');
  return [
    { name: 'search_vault', description: 'Search everything in this case (timeline, document paragraphs, my replies, evidence, hearings, notes). Understands dates like "April 2026" or "between March and May 2026".', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      execute: async ({ query }) => (await idx.search(query, { caseId, limit: 12 })).map(r => ({ type: r.type, date: r.date ? formatDate(r.date) : null, title: r.title, text: clip(r.text), id: r.ref })) },
    { name: 'get_timeline', description: 'Timeline events in a date range (dd.mm.yyyy, Month yyyy or yyyy). Omit both for the whole timeline.', inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
      execute: async ({ from, to }) => eventsOf(v, caseId).filter(e => overlaps(e.date, from ? parseDate(from)?.from : null, to ? parseDate(to)?.to : null)).slice(0, 120).map(e => ({ date: formatDate(e.date), title: e.title, account: e.account, verified: e.verified?.status === 'verified', sources: (e.sources || []).map(s => `${docs[s.docId] ? docCite(v, docs[s.docId], s.ref) : (s.label || '')} p.${s.page || '?'}`) })) },
    { name: 'list_documents', description: 'All documents in the case with who filed them.', inputSchema: { type: 'object', properties: {} },
      execute: async () => Object.values(docs).map(d => ({ id: d.id, name: docLong(v, d, formatDate), description: d.title, date: formatDate(d.date), filedBy: d.filedBy, summary: d.summary })) },
    { name: 'get_document_paragraphs', description: 'Paragraphs of one document (by id) with my reply status.', inputSchema: { type: 'object', properties: { documentId: { type: 'string' } }, required: ['documentId'] },
      execute: async ({ documentId }) => parasOf(v, documentId).map(p => ({ ref: p.ref, page: p.page, text: clip(p.translation || p.text, 900), status: needsReply(docs[documentId]) ? paraStatus(v, p) : 'n/a', myReply: v.list('replies', r => r.paraId === p.id && r.status === 'accepted').map(r => r.text).join('\n') })) },
    { name: 'list_allegations', description: 'Allegations against me with progress and my consolidated response.', inputSchema: { type: 'object', properties: {} },
      execute: async () => allegationsOf(v, caseId).map(a => ({ id: a.id, code: 'A' + a.n, title: a.title, brief: a.brief, paragraphs: (a.paraIds || []).length, consolidated: v.get('consolidated', a.id)?.text || null })) },
    { name: 'get_allegation', description: 'One allegation: every paragraph making it and every reply of mine.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      execute: async ({ id }) => { const a = v.get('allegations', id); if (!a) return { error: 'not found' }; return { title: a.title, brief: a.brief, paragraphs: (a.paraIds || []).map(pid => v.get('paragraphs', pid)).filter(Boolean).map(p => ({ doc: docs[p.docId] ? docCite(v, docs[p.docId]) : '', ref: p.ref, page: p.page, text: clip(p.translation || p.text, 700) })), replies: v.list('replies', r => r.allegationId === id && r.status === 'accepted').map(r => r.text), consolidated: v.get('consolidated', id)?.text }; } },
    { name: 'get_case_facts', description: 'Quick facts, proceedings, hearings, deadlines, court directions and open verification points.', inputSchema: { type: 'object', properties: {} },
      execute: async () => { const c = v.get('cases', caseId); const procs = v.list('proceedings', p => p.caseId === caseId); const pid = new Set(procs.map(p => p.id));
        return { facts: c.facts || [], proceedings: procs.map(p => ({ number: p.number, court: p.court, status: p.status })), hearings: v.list('hearings', h => pid.has(h.proceedingId)).map(h => ({ date: formatDate(h.date), outcome: h.outcome, next: formatDate(h.nextDate) })), deadlines: v.list('deadlines', d => pid.has(d.proceedingId) && !d.done).map(d => ({ due: formatDate(d.due), what: d.what })), directions: v.list('directions', d => pid.has(d.proceedingId)).map(d => ({ text: d.text, status: d.status, done: d.complianceNotes })), openVerification: v.list('verifications', x => x.caseId === caseId && x.status !== 'resolved').map(x => x.title) }; } },
  ];
}

export function Ask({ caseId }) {
  const app = useApp(); const v = useVault();
  const [q, setQ] = useState(''); const [live, setLive] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const abort = useRef(null);
  const hist = v.list('qa', x => x.caseId === caseId).sort((a, b) => (a.at || 0) - (b.at || 0));
  const can = canRunNow(app);
  const send = async (question) => {
    if (!question.trim() || busy) return;
    setBusy(true); setErr(''); setLive('Thinking…'); abort.current = new AbortController();
    try {
      const recent = hist.slice(-4).flatMap(x => [{ role: 'user', content: x.question }, { role: 'assistant', content: x.answer }]);
      const msgs = [{ role: 'user', content: askSystem(v, caseId) + '\n\nUse the tools to look things up before answering.' }, { role: 'assistant', content: 'Understood. I will look things up in your vault and cite what I use.' }, ...recent, { role: 'user', content: question }];
      const r = await app.claude.sample(msgs, { tools: vaultTools(v, caseId), modelTier: 'complex', cache: false, signal: abort.current.signal, onText: ({ text }) => setLive(text) });
      await v.put('qa', { caseId, question, answer: (r.text || '').trim(), at: Date.now() });
      setQ(''); setLive('');
    } catch (e) { setErr(e.code === 'not_granted' ? 'Claude access was declined for this page.' : e.code === 'rate_limited' ? 'Claude is busy — try again in a minute.' : 'Could not get an answer: ' + (e.message || e.code)); setLive(''); }
    finally { setBusy(false); }
  };
  return <main>
    <h2 style="margin:4px 0">Ask Claude</h2>
    <div class="small mut">Claude reads this case's vault before answering and cites what it uses. Not legal advice — confirm with your advocate. For the latest judgments or amendments, ask in a normal Claude chat (it can search the web).</div>
    {!can && <div class="box warn small">Asking needs the app opened inside Claude (online). Here you can read earlier answers.</div>}
    {hist.length === 0 && !live && <Empty>No questions yet.</Empty>}
    {hist.map(x => <div key={x.id}><div class="msg me">{x.question}</div><div class="msg ai">{x.answer}
      <div class="row tiny" style="margin-top:6px"><span class="mut">{formatWhen(x.at)}</span>
        <button class="lnk" onClick={async () => { await v.put('notes', { caseId, title: 'From Ask Claude: ' + x.question.slice(0, 60), text: x.answer, date: new Date(x.at).toISOString().slice(0, 10) }); app.toast('Pinned to case notes'); }}>Pin to notes</button>
        <button class="lnk bad" onClick={async () => { if (await confirmBox(app, 'Delete this question and answer?', 'Delete', true)) v.del('qa', x.id); }}>Delete</button></div></div></div>)}
    {live && <div><div class="msg me">{q}</div><div class="msg ai">{live}</div></div>}
    {err && <div class="box bad small">{err}</div>}
    {can && <div class="card pad" style="position:sticky;bottom:8px">
      <div class="row" style="margin-bottom:6px">{QUICK.map(([l, t]) => <button class="chip" disabled={busy} onClick={() => { setQ(l); send(t); }}>{l}</button>)}</div>
      <TextBox value={q} rows={2} placeholder="Ask anything about this case…" onInput={setQ} />
      <div class="row" style="margin-top:6px"><button class="btn" disabled={busy || !q.trim()} onClick={() => send(q)}>{busy ? 'Answering…' : 'Ask'}</button>{busy && <button class="lnk" onClick={() => abort.current?.abort()}>Stop</button>}</div>
    </div>}
  </main>;
}
