import { h } from 'preact';
import { useState } from 'preact/hooks';
import { useApp, useVault, Sheet, Field, Empty, confirmBox, openPdf, TextBox } from './core.jsx';
import { FILED_BY, needsReply, docsOf, parasOf, proceedingsOf, paraStatus, allegationsOf, repliesFor } from '../domain.js';
import { formatDate, parseDate } from '../search/dates.js';
import { ReplyComposer, ReplyView } from './replies.jsx';
import { requestJob } from '../claude/jobs.js';
import { storeLocalFile } from '../store/files.js';

export function DocForm({ caseId, d, onDone }) {
  const app = useApp(); const v = app.v;
  const [f, setF] = useState({ title: d?.title || '', short: d?.short || '', date: d?.date ? formatDate(d.date) : '', filedBy: d?.filedBy || 'opponent', proceedingId: d?.proceedingId || '', language: d?.language || 'en', notes: d?.notes || '' });
  const [file, setFile] = useState(null); const [text, setText] = useState(''); const [err, setErr] = useState('');
  const set = k => e => setF({ ...f, [k]: e.currentTarget.value });
  const save = async () => {
    if (!f.title.trim()) return setErr('Give the document a title');
    const dt = f.date.trim() ? parseDate(f.date) : null; if (f.date.trim() && !dt) return setErr('Date not understood');
    const data = { ...f, caseId, date: dt ? (dt.precision === 'day' ? dt.from : f.date.trim()) : null };
    let id = d?.id;
    if (d) await v.patch('documents', d.id, data);
    else id = await v.put('documents', { ...data, createdAt: Date.now(), source: 'manual' });
    if (file) { const ref = await storeLocalFile(v, file, 'documents'); await v.patch('documents', id, ref); }
    if (text.trim()) { // manual paragraphs: blank line or "1." / "That" starts a new paragraph
      const parts = text.split(/\n\s*\n|\n(?=\s*\d{1,3}[.)]\s)/).map(s => s.trim()).filter(Boolean);
      const start = parasOf(v, id).length;
      await v.commit(parts.map((t, i) => ({ coll: 'paragraphs', key: id + '-m' + (start + i), kind: 'put', data: { id: id + '-m' + (start + i), docId: id, order: start + i, ref: (t.match(/^(\d{1,3})[.)]/) || [])[1] ? '¶' + t.match(/^(\d{1,3})/)[1] : '¶' + (start + i + 1), text: t.replace(/^\d{1,3}[.)]\s*/, ''), page: null } })));
    }
    onDone(id);
  };
  return <div>
    <Field label="Title"><input type="text" value={f.title} placeholder="e.g. Section 31 PWDVA Petition" onInput={set('title')} /></Field>
    <div class="grid2"><Field label="Short name"><input type="text" value={f.short} placeholder="s.31 Petition" onInput={set('short')} /></Field>
      <Field label="Date filed / issued"><input type="text" value={f.date} placeholder="08.07.2026" onInput={set('date')} /></Field></div>
    <div class="grid2"><Field label="Whose document"><select value={f.filedBy} onChange={set('filedBy')}>{Object.entries(FILED_BY).map(([k, x]) => <option value={k}>{x.label}</option>)}</select></Field>
      <Field label="Proceeding"><select value={f.proceedingId} onChange={set('proceedingId')}><option value="">— choose —</option>{proceedingsOf(v, caseId).map(p => <option value={p.id}>{p.number} {p.title}</option>)}</select></Field></div>
    <Field label="Language"><select value={f.language} onChange={set('language')}><option value="en">English</option><option value="bn">Bengali</option><option value="mixed">Mixed</option></select></Field>
    {!d && <><Field label="PDF (optional)"><input type="file" accept="application/pdf,image/*" onChange={e => setFile(e.currentTarget.files[0])} /></Field>
      <Field label="Paste the text (optional — one paragraph per block)"><textarea rows={4} value={text} onInput={e => setText(e.currentTarget.value)} placeholder="Or leave empty and let Claude read the PDF with Update vault" /></Field></>}
    <Field label="Notes"><textarea rows={2} value={f.notes} onInput={set('notes')} /></Field>
    {err && <div class="small" style="color:var(--bad)">{err}</div>}
    <div class="row" style="margin-top:12px"><button class="btn" onClick={save}>Save</button></div>
  </div>;
}

export function Documents({ caseId }) {
  const app = useApp(); const v = useVault();
  const [by, setBy] = useState('');
  let docs = docsOf(v, caseId); if (by) docs = docs.filter(d => d.filedBy === by);
  const add = () => app.sheet.open(close => <Sheet title="Add document by hand" onClose={close}><DocForm caseId={caseId} onDone={id => { close(); app.nav('case', caseId, 'doc', id); }} /></Sheet>);
  const procs = Object.fromEntries(proceedingsOf(v, caseId).map(p => [p.id, p]));
  return <main>
    <div class="between"><h2 style="margin:4px 0">Documents</h2><button class="btn g" onClick={add}>+ Add by hand</button></div>
    <div class="small mut">New PDFs: put them in Drive → Legal → <b>inbox</b>, then tap <b>Update vault</b>. Claude reads them, files them here and updates the timeline.</div>
    <div class="row" style="margin:8px 0">{[['', 'All'], ...Object.entries(FILED_BY).map(([k, x]) => [k, x.short])].map(([k, l]) => <span class={'chip' + (by === k ? ' on' : '')} onClick={() => setBy(k)}>{l}</span>)}</div>
    {!docs.length && <Empty>No documents yet.</Empty>}
    <div class="card list">{docs.map(d => {
      const ps = parasOf(v, d.id); const st = needsReply(d) ? ps.map(p => paraStatus(v, p)) : [];
      const done = st.filter(s => s === 'answered' || s === 'common').length; const sug = st.filter(s => s === 'suggested').length;
      const fb = FILED_BY[d.filedBy] || FILED_BY.other;
      return <div class="item" key={d.id} onClick={() => app.nav('case', caseId, 'doc', d.id)}>
        <div class="d">{formatDate(d.date)}</div>
        <div class="grow"><b>{d.title}</b>
          <div><span class={'tag ' + fb.tag}>{fb.label}</span>{procs[d.proceedingId] && <span class="tag">{procs[d.proceedingId].number}</span>}{d.language === 'bn' && <span class="tag">Bengali</span>}
            {needsReply(d) && ps.length > 0 && <span class={'tag ' + (done === ps.length ? 'ok' : 'warn')}>{done}/{ps.length} answered</span>}{sug > 0 && <span class="tag warn">{sug} suggestions</span>}
            {!ps.length && <span class="tag">not read yet</span>}</div></div></div>;
    })}</div>
  </main>;
}

function ParaText({ p, d }) {
  return <div>
    <div class="quote" lang={p.lang || d.language || 'en'}>{p.text}</div>
    {p.translation && <div class="small" style="margin-top:4px"><span class="tag">English translation</span> {p.translation}</div>}
    {p.corrected && <span class="tag ok">text corrected by you</span>}
  </div>;
}

function CorrectText({ p, onDone }) {
  const app = useApp(); const [t, setT] = useState(p.text); const [tr, setTr] = useState(p.translation || '');
  return <Sheet title={'Correct text — ' + p.ref} onClose={onDone}>
    <p class="small mut">Fix words the scan reading got wrong. Search, quotes and exports will use your correction; the original reading is kept.</p>
    <Field label="Text as in the document"><textarea rows={8} value={t} onInput={e => setT(e.currentTarget.value)} /></Field>
    {(p.translation || p.lang === 'bn') && <Field label="English translation"><textarea rows={5} value={tr} onInput={e => setTr(e.currentTarget.value)} /></Field>}
    <div class="row" style="margin-top:10px"><button class="btn" onClick={async () => { await app.v.patch('paragraphs', p.id, { text: t, translation: tr || p.translation || null, corrected: true, ocrText: p.ocrText || p.text }); onDone(); }}>Save correction</button>
      {p.corrected && <button class="btn g" onClick={async () => { await app.v.patch('paragraphs', p.id, { text: p.ocrText || p.text, corrected: false }); onDone(); }}>Go back to the original reading</button>}</div>
  </Sheet>;
}

function AssignAllegations({ p, caseId, onDone }) {
  const app = useApp(); const v = app.v; const all = allegationsOf(v, caseId);
  const [sel, setSel] = useState(new Set(p.allegationIds || []));
  const save = async () => {
    const ch = [{ coll: 'paragraphs', key: p.id, kind: 'patch', data: { allegationIds: [...sel] } }];
    for (const a of all) { const has = (a.paraIds || []).includes(p.id), want = sel.has(a.id); if (has !== want) ch.push({ coll: 'allegations', key: a.id, kind: 'patch', data: { paraIds: want ? [...(a.paraIds || []), p.id] : (a.paraIds || []).filter(x => x !== p.id) } }); }
    await v.commit(ch); onDone();
  };
  return <Sheet title={'Allegations in ' + p.ref} onClose={onDone}>
    {all.map(a => <label class="row" style="padding:6px 0" key={a.id}><input type="checkbox" checked={sel.has(a.id)} onChange={() => { const s = new Set(sel); s.has(a.id) ? s.delete(a.id) : s.add(a.id); setSel(s); }} /> <span>A{a.n} · {a.title}</span></label>)}
    <div class="row" style="margin-top:10px"><button class="btn" onClick={save}>Save</button></div>
  </Sheet>;
}

export function DocPage({ caseId, docId }) {
  const app = useApp(); const v = useVault(); const d = v.get('documents', docId);
  const [open, setOpen] = useState(null); const [only, setOnly] = useState('');
  if (!d) return <main><Empty>Document not found.</Empty></main>;
  const ps = parasOf(v, d.id); const reply = needsReply(d);
  const als = Object.fromEntries(allegationsOf(v, caseId).map(a => [a.id, a]));
  const shown = only ? ps.filter(p => paraStatus(v, p) === only || (only === 'open' && paraStatus(v, p) === 'suggested')) : ps;
  const fb = FILED_BY[d.filedBy] || FILED_BY.other;
  return <main>
    <div class="card pad">
      <div class="mut small">{formatDate(d.date)} · <span class={'tag ' + fb.tag}>{fb.label}</span></div>
      <h2 style="margin:4px 0">{d.title}</h2>
      {d.summary && <p class="small">{d.summary}</p>}
      <div class="row">
        {d.fileId && <button class="btn s" onClick={() => openPdf(app, d, 1)}>Open PDF</button>}
        <button class="btn g s" onClick={() => app.sheet.open(close => <Sheet title="Edit document" onClose={close}><DocForm caseId={caseId} d={d} onDone={close} /></Sheet>)}>Edit details</button>
        {reply && <button class="btn g s" onClick={() => requestJob(app, 'suggest', { docId: d.id })}>Suggest replies</button>}
        {reply && <button class="btn g s" onClick={() => app.nav('case', caseId, 'exports', d.id)}>Export my response</button>}
        <button class="btn g s" style="color:var(--bad);border-color:var(--bad)" onClick={async () => { if (await confirmBox(app, 'Remove this document from the vault? The PDF stays in Drive.', 'Remove', true)) { await v.del('documents', d.id); app.back(); } }}>Remove</button>
      </div>
      {!reply && <div class="small mut" style="margin-top:6px">{d.filedBy === 'me' ? 'Your own filing: it feeds the timeline and is your recorded stand — no reply needed.' : 'Official record: feeds the timeline. You can add private notes under Notes.'}</div>}
    </div>
    {reply && ps.length > 0 && <div class="row" style="margin:6px 0">{[['', 'All paragraphs'], ['open', 'Not answered'], ['answered', 'Answered'], ['common', 'Covered by common reply']].map(([k, l]) => <span class={'chip' + (only === k ? ' on' : '')} onClick={() => setOnly(k)}>{l}</span>)}</div>}
    {!ps.length && <Empty>This document hasn't been read yet. Tap <b>Update vault</b> (Claude reads it), or paste its text with Edit details.</Empty>}
    {shown.map(p => {
      const st = reply ? paraStatus(v, p) : null;
      const own = repliesFor(v, { paraId: p.id });
      const commons = (p.allegationIds || []).flatMap(aid => v.list('replies', r => r.allegationId === aid && !r.paraId && r.status === 'accepted'));
      return <div class="card pad" key={p.id} id={'p-' + p.id}>
        <div class="between"><b>{p.ref}</b><span class="row">{p.page && d.fileId && <button class="lnk" onClick={() => openPdf(app, d, p.page)}>page {p.page}</button>}{p.page && !d.fileId && <span class="tiny mut">page {p.page}</span>}
          <button class="lnk" onClick={() => app.sheet.open(close => <CorrectText p={p} onDone={close} />)}>Correct text</button></span></div>
        <ParaText p={p} d={d} />
        <div style="margin-top:6px">{(p.allegationIds || []).map(aid => als[aid] && <span class="tag" style="cursor:pointer" onClick={() => app.nav('case', caseId, 'al', aid)}>A{als[aid].n} · {als[aid].title}</span>)}
          {reply && <button class="lnk" onClick={() => app.sheet.open(close => <AssignAllegations p={p} caseId={caseId} onDone={close} />)}>{(p.allegationIds || []).length ? 'change' : '+ link to allegation'}</button>}</div>
        {reply && <>
          {own.map(r => <ReplyView r={r} key={r.id} />)}
          {!own.some(r => r.status === 'accepted') && commons.length > 0 && <div class="small mut" style="margin-top:6px">✓ Covered by the common reply on {commons.map(r => 'A' + (als[r.allegationId]?.n || '')).join(', ')}{' '}<button class="lnk" onClick={() => app.nav('case', caseId, 'al', commons[0].allegationId)}>view</button></div>}
          {open === p.id ? <ReplyComposer caseId={caseId} allegationId={(p.allegationIds || [])[0]} paraId={p.id} onDone={() => setOpen(null)} />
            : <button class="lnk" style="margin-top:6px" onClick={() => setOpen(p.id)}>{own.length ? '+ Add another reply' : 'Reply to this paragraph'}</button>}
          {st === 'open' && !commons.length && <span class="tag warn" style="margin-left:8px">not answered</span>}
        </>}
      </div>;
    })}
  </main>;
}
