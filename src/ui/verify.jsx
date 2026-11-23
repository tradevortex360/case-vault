import { h } from 'preact';
import { useState } from 'preact/hooks';
import { useApp, useVault, Sheet, Field, Empty, openPdf, TextBox } from './core.jsx';
import { EvidencePicker } from './trackers.jsx';
import { parseDate, formatDate } from '../search/dates.js';

export function Verify({ caseId }) {
  const app = useApp(); const v = useVault(); const [show, setShow] = useState('open');
  const items = v.list('verifications', x => x.caseId === caseId && (show === 'all' || (show === 'open' ? x.status !== 'resolved' : x.status === 'resolved')));
  return <main>
    <h2 style="margin:4px 0">For verification</h2>
    <div class="small mut">Places where documents disagree on a date or fact, or where Claude found something that needs your confirmation. Settle each one once; the timeline uses your answer.</div>
    <div class="row" style="margin:8px 0">{[['open', 'Open'], ['resolved', 'Settled'], ['all', 'All']].map(([k, l]) => <span class={'chip' + (show === k ? ' on' : '')} onClick={() => setShow(k)}>{l}</span>)}
      <button class="btn g s" style="margin-left:auto" onClick={() => app.sheet.open(close => <AddItem caseId={caseId} onDone={close} />)}>+ Add</button></div>
    {!items.length && <Empty>{show === 'open' ? 'Nothing waiting for verification.' : 'None.'}</Empty>}
    {items.map(x => <div class="card pad" key={x.id}>
      <div class="between"><b>{x.title}</b>{x.status === 'resolved' ? <span class="tag ok">settled</span> : <span class="tag bad">open</span>}</div>
      {(x.variants || []).map((vr, i) => <div key={i} class="small" style="margin:4px 0">• <b>{vr.value}</b>{(vr.sources || []).map((s, j) => { const d = s.docId && v.get('documents', s.docId); return <span key={j} class="mut"> — {s.label || (d ? (d.short || d.title) : '')}{s.ref ? ' ' + s.ref : ''}{d?.fileId && s.page ? <> (<button class="lnk" onClick={() => openPdf(app, d, s.page)}>p.{s.page}</button>)</> : ''}</span>; })}</div>)}
      {x.status === 'resolved' && x.resolution && <div class="box ok small"><b>Your answer:</b> {x.resolution.value}{x.resolution.note ? ' — ' + x.resolution.note : ''}{(x.resolution.evidenceIds || []).length ? ` · 📎 ${x.resolution.evidenceIds.length} supporting` : ''}</div>}
      <button class="btn s" style="margin-top:6px" onClick={() => app.sheet.open(close => <Resolve x={x} caseId={caseId} onDone={close} />)}>{x.status === 'resolved' ? 'Change' : 'Settle this'}</button>
    </div>)}
  </main>;
}

function Resolve({ x, caseId, onDone }) {
  const app = useApp(); const v = app.v;
  const [val, setVal] = useState(x.resolution?.value || ''); const [note, setNote] = useState(x.resolution?.note || ''); const [ev, setEv] = useState(x.resolution?.evidenceIds || []);
  const save = async () => {
    if (!val.trim()) return app.toast('Choose or type the correct version');
    const ch = [{ coll: 'verifications', key: x.id, kind: 'patch', data: { status: 'resolved', resolution: { value: val.trim(), note, evidenceIds: ev, at: Date.now() } } }];
    if (x.eventId && x.kind === 'date') { const d = parseDate(val); if (d) ch.push({ coll: 'events', key: x.eventId, kind: 'patch', data: { date: d.precision === 'day' ? d.from : val.trim(), verified: { status: 'verified', note, at: Date.now() }, evidenceIds: [...new Set([...(v.get('events', x.eventId)?.evidenceIds || []), ...ev])] } }); }
    await v.commit(ch); onDone(); app.toast('Settled');
  };
  return <Sheet title={x.title} onClose={onDone}>
    <p class="small mut">Which is correct? Pick one, or type the right version.</p>
    {(x.variants || []).map((vr, i) => <label class="row" style="padding:6px 0" key={i}><input type="radio" name="vv" checked={val === vr.value} onChange={() => setVal(vr.value)} /> <span>{vr.value}</span></label>)}
    <Field label="Correct version"><input type="text" value={val} onInput={e => setVal(e.currentTarget.value)} placeholder={x.kind === 'date' ? 'e.g. 10.11.2023' : ''} /></Field>
    <Field label="Why you say this (optional)"><TextBox value={note} rows={2} onInput={setNote} /></Field>
    <Field label="Supporting documents (optional)"><EvidencePicker caseId={caseId} selected={ev} onDone={setEv} inline /></Field>
    <div class="row" style="margin-top:10px"><button class="btn" onClick={save}>Save</button></div>
  </Sheet>;
}

function AddItem({ caseId, onDone }) {
  const app = useApp(); const [t, setT] = useState(''); const [a, setA] = useState(''); const [b, setB] = useState('');
  return <Sheet title="Add something to verify" onClose={onDone}>
    <Field label="What doesn't match"><input type="text" value={t} onInput={e => setT(e.currentTarget.value)} placeholder="Date she left the house" /></Field>
    <Field label="Version 1"><input type="text" value={a} onInput={e => setA(e.currentTarget.value)} /></Field>
    <Field label="Version 2"><input type="text" value={b} onInput={e => setB(e.currentTarget.value)} /></Field>
    <div class="row" style="margin-top:10px"><button class="btn" onClick={async () => { if (!t.trim()) return; await app.v.put('verifications', { caseId, title: t, kind: 'fact', status: 'open', variants: [a, b].filter(Boolean).map(value => ({ value, sources: [] })) }); onDone(); }}>Add</button></div>
  </Sheet>;
}
