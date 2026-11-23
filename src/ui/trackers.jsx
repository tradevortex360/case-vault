import { h } from 'preact';
import { useState } from 'preact/hooks';
import { useApp, useVault, Sheet, Field, Empty, confirmBox, TextBox, fmtMoney, todayISO } from './core.jsx';
import { proceedingsOf, allegationsOf, eventsOf, calendarLink, upcoming } from '../domain.js';
import { formatDate, parseDate } from '../search/dates.js';
import { storeLocalFile } from '../store/files.js';

const dateIn = (s) => { if (!s?.trim()) return null; const d = parseDate(s); return d ? (d.precision === 'day' ? d.from : s.trim()) : undefined; };
function DelBtn({ coll, id, onDone, what = 'this entry' }) {
  const app = useApp();
  return <button class="btn g" style="color:var(--bad);border-color:var(--bad)" onClick={async () => { if (await confirmBox(app, `Delete ${what}?`, 'Delete', true)) { await app.v.del(coll, id); onDone(); } }}>Delete</button>;
}
async function openFile(app, id) {
  const blob = await app.v.file(id); if (!blob) return app.toast('File not on this device yet — sync once online');
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---------------- Evidence ----------------
export function EvidenceForm({ caseId, x, onDone }) {
  const app = useApp(); const v = app.v;
  const [f, setF] = useState({ title: x?.title || '', kind: x?.kind || 'Document', obtainedOn: x?.obtainedOn ? formatDate(x.obtainedOn) : '', source: x?.source || '', originalLocation: x?.originalLocation || '', notes: x?.notes || '', allegationIds: x?.allegationIds || [], eventIds: x?.eventIds || [] });
  const [file, setFile] = useState(null);
  const set = k => e => setF({ ...f, [k]: e.currentTarget.value });
  const save = async () => {
    if (!f.title.trim()) return app.toast('Give it a title');
    const od = dateIn(f.obtainedOn); if (od === undefined) return app.toast('Date not understood');
    const data = { ...f, obtainedOn: od, caseId };
    let id = x?.id; if (x) await v.patch('evidence', x.id, data); else id = await v.put('evidence', { ...data, createdAt: Date.now() });
    if (file) await v.patch('evidence', id, await storeLocalFile(v, file, 'evidence'));
    // keep event links two-way
    for (const e of eventsOf(v, caseId)) { const has = (e.evidenceIds || []).includes(id), want = f.eventIds.includes(e.id); if (has !== want) await v.patch('events', e.id, { evidenceIds: want ? [...(e.evidenceIds || []), id] : e.evidenceIds.filter(z => z !== id) }); }
    onDone(id);
  };
  const tog = (k, id) => setF({ ...f, [k]: f[k].includes(id) ? f[k].filter(z => z !== id) : [...f[k], id] });
  return <div>
    <Field label="What it is"><input type="text" value={f.title} placeholder="Video of 03.04.2026 visit" onInput={set('title')} /></Field>
    <div class="grid2"><Field label="Kind"><select value={f.kind} onChange={set('kind')}>{['Document', 'Video', 'Audio recording', 'Photo', 'Message / chat', 'Email', 'Bank statement', 'Police copy', 'Receipt', 'Witness', 'Other'].map(k => <option>{k}</option>)}</select></Field>
      <Field label="When you got it"><input type="text" value={f.obtainedOn} placeholder="03.04.2026" onInput={set('obtainedOn')} /></Field></div>
    <Field label="From whom / how"><input type="text" value={f.source} placeholder="Recorded on my phone" onInput={set('source')} /></Field>
    <Field label="Where the original is kept"><input type="text" value={f.originalLocation} placeholder="Phone gallery + Google Drive backup" onInput={set('originalLocation')} /></Field>
    <Field label="What it proves / notes"><TextBox value={f.notes} rows={2} onInput={t => setF({ ...f, notes: t })} /></Field>
    <Field label="File (optional)"><input type="file" onChange={e => setFile(e.currentTarget.files[0])} />{x?.fileId && <button class="lnk" onClick={() => openFile(app, x.fileId)}>Open current file</button>}</Field>
    <details style="margin-top:8px"><summary class="small">Supports which allegations ({f.allegationIds.length})</summary>
      {allegationsOf(v, caseId).map(a => <label class="row small" style="padding:3px 0"><input type="checkbox" checked={f.allegationIds.includes(a.id)} onChange={() => tog('allegationIds', a.id)} /> A{a.n} · {a.title}</label>)}</details>
    <details style="margin-top:6px"><summary class="small">Supports which timeline events ({f.eventIds.length})</summary>
      {eventsOf(v, caseId).map(e => <label class="row small" style="padding:3px 0"><input type="checkbox" checked={f.eventIds.includes(e.id)} onChange={() => tog('eventIds', e.id)} /> {formatDate(e.date)} · {e.title}</label>)}</details>
    <div class="row" style="margin-top:12px"><button class="btn" onClick={save}>Save</button>{x && <DelBtn coll="evidence" id={x.id} onDone={onDone} what="this evidence entry" />}</div>
  </div>;
}

export function EvidencePicker({ caseId, selected, onDone, inline }) {
  const app = useApp(); const v = useVault(); const [sel, setSel] = useState(selected || []); const [adding, setAdding] = useState(false);
  const all = v.list('evidence', x => x.caseId === caseId);
  const toggle = id => { const n = sel.includes(id) ? sel.filter(z => z !== id) : [...sel, id]; setSel(n); if (inline) onDone(n); };
  if (adding) return <EvidenceForm caseId={caseId} onDone={id => { setAdding(false); if (id) toggle(id); }} />;
  return <div>
    {!all.length && <div class="small mut">No evidence registered yet.</div>}
    {all.map(x => <label class="row" style="padding:5px 0" key={x.id}><input type="checkbox" checked={sel.includes(x.id)} onChange={() => toggle(x.id)} /> <span>{x.title} <span class="tiny mut">{x.kind}</span></span></label>)}
    <div class="row" style="margin-top:8px"><button class="btn g s" onClick={() => setAdding(true)}>+ New evidence</button>{!inline && <button class="btn" onClick={() => onDone(sel)}>Done</button>}</div>
  </div>;
}

export function Evidence({ caseId }) {
  const app = useApp(); const v = useVault();
  const all = v.list('evidence', x => x.caseId === caseId).sort((a, b) => (a.obtainedOn || '').localeCompare(b.obtainedOn || ''));
  const als = Object.fromEntries(allegationsOf(v, caseId).map(a => [a.id, a]));
  const edit = x => app.sheet.open(close => <Sheet title={x ? 'Evidence' : 'Register evidence'} onClose={close}><EvidenceForm caseId={caseId} x={x} onDone={close} /></Sheet>);
  return <main>
    <div class="between"><h2 style="margin:4px 0">Evidence register</h2><button class="btn" onClick={() => edit(null)}>+ Register</button></div>
    <div class="small mut">Every video, recording, message, email or statement: when and how you got it, where the original is, and what it proves.</div>
    {!all.length && <Empty>Nothing registered yet.</Empty>}
    <div class="card list" style="margin-top:8px">{all.map(x => <div class="item" key={x.id} onClick={() => edit(x)}>
      <div class="d">{x.obtainedOn ? formatDate(x.obtainedOn) : '—'}</div>
      <div class="grow"><b>{x.title}</b><div class="small mut">{x.kind}{x.originalLocation ? ' · original: ' + x.originalLocation : ''}</div>
        <div>{(x.allegationIds || []).map(id => als[id] && <span class="tag">A{als[id].n}</span>)}{x.fileId && <span class="tag">📎 file</span>}{x.pendingUpload && <span class="tag warn">uploading when online</span>}</div></div></div>)}</div>
  </main>;
}

// ---------------- Hearings, deadlines, directions ----------------
function HearingForm({ caseId, x, onDone }) {
  const app = useApp(); const v = app.v; const procs = proceedingsOf(v, caseId);
  const [f, setF] = useState({ proceedingId: x?.proceedingId || procs[0]?.id || '', date: x?.date ? formatDate(x.date) : formatDate(todayISO()), purpose: x?.purpose || '', outcome: x?.outcome || '', appeared: x?.appeared || '', directions: x?.directions || '', nextDate: x?.nextDate ? formatDate(x.nextDate) : '', nextPurpose: x?.nextPurpose || '', notes: x?.notes || '' });
  const set = k => e => setF({ ...f, [k]: e.currentTarget.value });
  const save = async () => {
    const d = dateIn(f.date), nd = dateIn(f.nextDate); if (!d || nd === undefined) return app.toast('Check the dates');
    if (!f.proceedingId) return app.toast('Choose the proceeding (add one on the Overview tab)');
    const data = { ...f, date: d, nextDate: nd, caseId };
    if (x) await v.patch('hearings', x.id, data); else await v.put('hearings', { ...data, createdAt: Date.now() });
    onDone();
  };
  return <div>
    <Field label="Proceeding"><select value={f.proceedingId} onChange={set('proceedingId')}>{procs.map(p => <option value={p.id}>{p.number} {p.title}</option>)}</select></Field>
    <div class="grid2"><Field label="Hearing date"><input type="text" value={f.date} onInput={set('date')} /></Field><Field label="Listed for"><input type="text" value={f.purpose} placeholder="Show cause / evidence / arguments" onInput={set('purpose')} /></Field></div>
    <Field label="What happened"><TextBox value={f.outcome} rows={2} onInput={t => setF({ ...f, outcome: t })} /></Field>
    <Field label="Who appeared"><input type="text" value={f.appeared} placeholder="My advocate; her advocate; she was present" onInput={set('appeared')} /></Field>
    <Field label="Directions given"><textarea rows={2} value={f.directions} onInput={set('directions')} /></Field>
    <div class="grid2"><Field label="Next date"><input type="text" value={f.nextDate} placeholder="dd.mm.yyyy" onInput={set('nextDate')} /></Field><Field label="Next date is for"><input type="text" value={f.nextPurpose} onInput={set('nextPurpose')} /></Field></div>
    <Field label="Private notes"><textarea rows={2} value={f.notes} onInput={set('notes')} /></Field>
    <div class="row" style="margin-top:12px"><button class="btn" onClick={save}>Save</button>{x && <DelBtn coll="hearings" id={x.id} onDone={onDone} what="this hearing entry" />}</div>
  </div>;
}
function DeadlineForm({ caseId, x, onDone }) {
  const app = useApp(); const v = app.v; const procs = proceedingsOf(v, caseId);
  const [f, setF] = useState({ proceedingId: x?.proceedingId || procs[0]?.id || '', what: x?.what || '', from: '', days: '', due: x?.due ? formatDate(x.due) : '', basis: x?.basis || '' });
  const set = k => e => setF({ ...f, [k]: e.currentTarget.value });
  const calc = () => { const d = parseDate(f.from); if (d && +f.days) { const dt = new Date(d.from + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + +f.days); setF({ ...f, due: formatDate(dt.toISOString().slice(0, 10)) }); } };
  const save = async () => { const due = dateIn(f.due); if (!due || !f.what.trim()) return app.toast('Add what is due and the date'); const data = { proceedingId: f.proceedingId, what: f.what, due, basis: f.basis, caseId }; if (x) await v.patch('deadlines', x.id, data); else await v.put('deadlines', { ...data, done: false }); onDone(); };
  return <div>
    <Field label="Proceeding"><select value={f.proceedingId} onChange={set('proceedingId')}>{procs.map(p => <option value={p.id}>{p.number}</option>)}</select></Field>
    <Field label="What is due"><input type="text" value={f.what} placeholder="File reply to s.31 petition" onInput={set('what')} /></Field>
    <div class="box acc small">Count from a date: <input type="text" style="width:120px;display:inline-block" placeholder="order date" value={f.from} onInput={set('from')} /> + <input type="number" style="width:70px;display:inline-block" placeholder="days" value={f.days} onInput={set('days')} /> <button class="btn g s" onClick={calc}>Calculate</button><div class="tiny mut" style="margin-top:4px">Always confirm legal time limits with your advocate.</div></div>
    <Field label="Due date"><input type="text" value={f.due} onInput={set('due')} /></Field>
    <Field label="Basis (order / rule)"><input type="text" value={f.basis} onInput={set('basis')} /></Field>
    <div class="row" style="margin-top:12px"><button class="btn" onClick={save}>Save</button>{x && <DelBtn coll="deadlines" id={x.id} onDone={onDone} />}</div>
  </div>;
}
function DirectionForm({ caseId, x, onDone }) {
  const app = useApp(); const v = app.v; const procs = proceedingsOf(v, caseId);
  const [f, setF] = useState({ proceedingId: x?.proceedingId || procs[0]?.id || '', orderDate: x?.orderDate ? formatDate(x.orderDate) : '', text: x?.text || '', status: x?.status || 'to comply', complianceNotes: x?.complianceNotes || '', evidenceIds: x?.evidenceIds || [] });
  const set = k => e => setF({ ...f, [k]: e.currentTarget.value });
  const save = async () => { const od = dateIn(f.orderDate); if (od === undefined || !f.text.trim()) return app.toast('Add the direction and order date'); const data = { ...f, orderDate: od, caseId }; if (x) await v.patch('directions', x.id, data); else await v.put('directions', data); onDone(); };
  return <div>
    <div class="grid2"><Field label="Proceeding"><select value={f.proceedingId} onChange={set('proceedingId')}>{procs.map(p => <option value={p.id}>{p.number}</option>)}</select></Field><Field label="Order date"><input type="text" value={f.orderDate} onInput={set('orderDate')} /></Field></div>
    <Field label="What the court directed (that applies to you)"><textarea rows={3} value={f.text} onInput={set('text')} /></Field>
    <Field label="Status"><select value={f.status} onChange={set('status')}>{['to comply', 'complying (ongoing)', 'complied', 'stayed', 'not applicable'].map(s => <option>{s}</option>)}</select></Field>
    <Field label="What you did to comply"><TextBox value={f.complianceNotes} rows={3} onInput={t => setF({ ...f, complianceNotes: t })} /></Field>
    <Field label="Proof of compliance"><EvidencePicker caseId={caseId} selected={f.evidenceIds} inline onDone={ids => setF({ ...f, evidenceIds: ids })} /></Field>
    <div class="row" style="margin-top:12px"><button class="btn" onClick={save}>Save</button>{x && <DelBtn coll="directions" id={x.id} onDone={onDone} />}</div>
  </div>;
}

export function Hearings({ caseId }) {
  const app = useApp(); const v = useVault(); const c = v.get('cases', caseId);
  const procs = Object.fromEntries(proceedingsOf(v, caseId).map(p => [p.id, p]));
  const hs = v.list('hearings', x => procs[x.proceedingId]).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const dls = v.list('deadlines', x => procs[x.proceedingId]).sort((a, b) => (a.done - b.done) || (a.due || '').localeCompare(b.due || ''));
  const dirs = v.list('directions', x => procs[x.proceedingId]);
  const up = upcoming(v, caseId);
  const open = (T, title, x) => app.sheet.open(close => <Sheet title={title} onClose={close}><T caseId={caseId} x={x} onDone={close} /></Sheet>);
  if (!Object.keys(procs).length) return <main><Empty>Add a proceeding first (Overview → Proceedings in this case).</Empty></main>;
  return <main>
    {up.hearings.length > 0 && <div class="box warn"><b class="small">COMING UP</b>{up.hearings.slice(0, 4).map(({ date, h: x }) => <div class="between small" key={x.id} style="padding:3px 0"><span><b>{formatDate(date)}</b> · {procs[x.proceedingId]?.number} {x.nextPurpose || x.purpose ? '— ' + (x.nextPurpose || x.purpose) : ''}</span><a href={calendarLink(`${procs[x.proceedingId]?.number} — ${x.nextPurpose || x.purpose || 'hearing'}`, date, c.name)} target="_blank" rel="noopener">Add to calendar</a></div>)}</div>}
    <div class="between"><h2 style="margin:8px 0 4px">Hearing log</h2><button class="btn" onClick={() => open(HearingForm, 'Log a hearing', null)}>+ Log hearing</button></div>
    {!hs.length && <div class="small mut">After each date, note in 30 seconds what happened and the next date.</div>}
    <div class="card list">{hs.map(x => <div class="item" key={x.id} onClick={() => open(HearingForm, 'Hearing', x)}><div class="d">{formatDate(x.date)}</div><div class="grow"><b>{procs[x.proceedingId]?.number}</b> {x.purpose && <span class="mut">— {x.purpose}</span>}<div class="small">{x.outcome}</div>{x.nextDate && <span class="tag warn">Next: {formatDate(x.nextDate)}</span>}</div></div>)}</div>
    <div class="between"><h2 style="margin:14px 0 4px">Deadlines</h2><button class="btn g" onClick={() => open(DeadlineForm, 'Add deadline', null)}>+ Add</button></div>
    <div class="card list">{dls.map(x => <div class="item" key={x.id}><input type="checkbox" checked={!!x.done} onChange={() => v.patch('deadlines', x.id, { done: !x.done })} aria-label="Done" />
      <div class="grow" onClick={() => open(DeadlineForm, 'Deadline', x)} style={x.done ? 'text-decoration:line-through;opacity:.6' : ''}><b>{formatDate(x.due)}</b> — {x.what}<div class="small mut">{procs[x.proceedingId]?.number}{x.basis ? ' · ' + x.basis : ''}</div></div>
      {!x.done && <a class="small" href={calendarLink(x.what, x.due, c.name)} target="_blank" rel="noopener">Calendar</a>}</div>)}</div>
    {!dls.length && <div class="small mut">None.</div>}
    <div class="between"><h2 style="margin:14px 0 4px">Court directions you must follow</h2><button class="btn g" onClick={() => open(DirectionForm, 'Add direction', null)}>+ Add</button></div>
    <div class="small mut">What each order requires of you, and proof you complied — your answer to any breach allegation.</div>
    {dirs.map(x => <div class="card pad" key={x.id} style="cursor:pointer" onClick={() => open(DirectionForm, 'Direction', x)}>
      <div class="between"><span class="small mut">{procs[x.proceedingId]?.number} · order {formatDate(x.orderDate)}</span><span class={'tag ' + (x.status === 'complied' ? 'ok' : x.status === 'to comply' ? 'bad' : 'warn')}>{x.status}</span></div>
      <div>{x.text}</div>{x.complianceNotes && <div class="small" style="margin-top:4px"><b>Done:</b> {x.complianceNotes}</div>}{(x.evidenceIds || []).length > 0 && <span class="tag">📎 {x.evidenceIds.length} proof</span>}</div>)}
  </main>;
}

// ---------------- Expenses ----------------
const CATS = ['Advocate fees', 'Court fees / stamps', 'Certified copies', 'Travel', 'Notary / affidavits', 'Printing / typing', 'Other'];
function ExpenseForm({ caseId, x, onDone }) {
  const app = useApp(); const v = app.v;
  const [f, setF] = useState({ date: x?.date ? formatDate(x.date) : formatDate(todayISO()), amount: x?.amount || '', category: x?.category || CATS[0], payee: x?.payee || '', proceedingId: x?.proceedingId || '', note: x?.note || '', mode: x?.mode || 'UPI' });
  const [file, setFile] = useState(null); const set = k => e => setF({ ...f, [k]: e.currentTarget.value });
  const save = async () => { const d = dateIn(f.date); if (!d || !(+f.amount > 0)) return app.toast('Add date and amount'); const data = { ...f, amount: +f.amount, date: d, caseId }; let id = x?.id; if (x) await v.patch('expenses', x.id, data); else id = await v.put('expenses', data); if (file) await v.patch('expenses', id, await storeLocalFile(v, file, 'evidence')); onDone(); };
  return <div>
    <div class="grid2"><Field label="Date"><input type="text" value={f.date} onInput={set('date')} /></Field><Field label="Amount (₹)"><input type="number" inputMode="decimal" value={f.amount} onInput={set('amount')} /></Field></div>
    <div class="grid2"><Field label="Category"><select value={f.category} onChange={set('category')}>{CATS.map(c => <option>{c}</option>)}</select></Field><Field label="Paid to"><input type="text" value={f.payee} onInput={set('payee')} /></Field></div>
    <div class="grid2"><Field label="Paid by"><select value={f.mode} onChange={set('mode')}>{['UPI', 'Cash', 'Bank transfer', 'Card', 'Cheque'].map(m => <option>{m}</option>)}</select></Field>
      <Field label="Proceeding"><select value={f.proceedingId} onChange={set('proceedingId')}><option value="">— general —</option>{proceedingsOf(v, caseId).map(p => <option value={p.id}>{p.number}</option>)}</select></Field></div>
    <Field label="Note"><input type="text" value={f.note} onInput={set('note')} /></Field>
    <Field label="Receipt (photo or PDF)"><input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.currentTarget.files[0])} />{x?.fileId && <button class="lnk" onClick={() => openFile(app, x.fileId)}>Open receipt</button>}</Field>
    <div class="row" style="margin-top:12px"><button class="btn" onClick={save}>Save</button>{x && <DelBtn coll="expenses" id={x.id} onDone={onDone} />}</div>
  </div>;
}
export function Money({ caseId }) {
  const app = useApp(); const v = useVault();
  const xs = v.list('expenses', x => x.caseId === caseId).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const total = xs.reduce((s, x) => s + (+x.amount || 0), 0);
  const byCat = CATS.map(c => [c, xs.filter(x => x.category === c).reduce((s, x) => s + (+x.amount || 0), 0)]).filter(([, n]) => n);
  const csv = () => { const rows = [['Date', 'Amount', 'Category', 'Paid to', 'Mode', 'Note'], ...xs.map(x => [formatDate(x.date), x.amount, x.category, x.payee, x.mode, x.note])]; const t = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'); navigator.clipboard?.writeText(t).then(() => app.toast('Copied as CSV — paste into a sheet'), () => app.toast('Copy not allowed here')); };
  const edit = x => app.sheet.open(close => <Sheet title={x ? 'Expense' : 'Add expense'} onClose={close}><ExpenseForm caseId={caseId} x={x} onDone={close} /></Sheet>);
  return <main>
    <div class="between"><h2 style="margin:4px 0">Expenses</h2><button class="btn" onClick={() => edit(null)}>+ Add</button></div>
    <div class="card pad"><div class="between"><span class="mut">Total spent</span><b style="font-size:20px">{fmtMoney(total)}</b></div>
      {byCat.map(([c, n]) => <div class="between small" key={c}><span>{c}</span><span>{fmtMoney(n)}</span></div>)}
      {xs.length > 0 && <button class="lnk" style="margin-top:6px" onClick={csv}>Copy as CSV</button>}</div>
    {!xs.length && <Empty>No expenses recorded.</Empty>}
    <div class="card list">{xs.map(x => <div class="item" key={x.id} onClick={() => edit(x)}><div class="d">{formatDate(x.date)}</div><div class="grow"><b>{fmtMoney(x.amount)}</b> · {x.category}<div class="small mut">{[x.payee, x.mode, x.note].filter(Boolean).join(' · ')}</div></div>{x.fileId && <span class="tag">📎</span>}</div>)}</div>
  </main>;
}

// ---------------- People & contact log ----------------
function ContactForm({ caseId, x, onDone }) {
  const app = useApp(); const v = app.v;
  const [f, setF] = useState({ name: x?.name || '', role: x?.role || '', phone: x?.phone || '', email: x?.email || '', notes: x?.notes || '' }); const set = k => e => setF({ ...f, [k]: e.currentTarget.value });
  const save = async () => { if (!f.name.trim()) return; if (x) await v.patch('contacts', x.id, f); else await v.put('contacts', { ...f, caseId }); onDone(); };
  return <div><Field label="Name"><input type="text" value={f.name} onInput={set('name')} /></Field><Field label="Role"><input type="text" value={f.role} placeholder="My advocate / Petitioner / Protection Officer" onInput={set('role')} /></Field>
    <div class="grid2"><Field label="Phone"><input type="text" inputMode="tel" value={f.phone} onInput={set('phone')} /></Field><Field label="Email"><input type="text" inputMode="email" value={f.email} onInput={set('email')} /></Field></div>
    <Field label="Notes"><textarea rows={2} value={f.notes} onInput={set('notes')} /></Field>
    <div class="row" style="margin-top:12px"><button class="btn" onClick={save}>Save</button>{x && <DelBtn coll="contacts" id={x.id} onDone={onDone} />}</div></div>;
}
function LogForm({ caseId, x, onDone }) {
  const app = useApp(); const v = app.v;
  const [f, setF] = useState({ date: x?.date ? formatDate(x.date) : formatDate(todayISO()), with: x?.with || '', mode: x?.mode || 'Call', summary: x?.summary || '', offer: x?.offer || '' }); const set = k => e => setF({ ...f, [k]: e.currentTarget.value });
  const save = async () => { const d = dateIn(f.date); if (!d || !f.summary.trim()) return app.toast('Add date and what was said'); const data = { ...f, date: d, caseId }; if (x) await v.patch('commlog', x.id, data); else await v.put('commlog', data); onDone(); };
  return <div><div class="grid2"><Field label="Date"><input type="text" value={f.date} onInput={set('date')} /></Field><Field label="How"><select value={f.mode} onChange={set('mode')}>{['Call', 'Message', 'Email', 'Meeting', 'Mediation sitting', 'Through advocates', 'Other'].map(m => <option>{m}</option>)}</select></Field></div>
    <Field label="With whom"><input type="text" value={f.with} onInput={set('with')} /></Field>
    <Field label="What was said"><TextBox value={f.summary} rows={3} onInput={t => setF({ ...f, summary: t })} /></Field>
    <Field label="Offer / demand made (if any)"><input type="text" value={f.offer} onInput={set('offer')} /></Field>
    <div class="row" style="margin-top:12px"><button class="btn" onClick={save}>Save</button>{x && <DelBtn coll="commlog" id={x.id} onDone={onDone} />}</div></div>;
}
export function People({ caseId }) {
  const app = useApp(); const v = useVault();
  const cs = v.list('contacts', x => x.caseId === caseId);
  const log = v.list('commlog', x => x.caseId === caseId).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const open = (T, t, x) => app.sheet.open(close => <Sheet title={t} onClose={close}><T caseId={caseId} x={x} onDone={close} /></Sheet>);
  return <main>
    <div class="between"><h2 style="margin:4px 0">People</h2><button class="btn g" onClick={() => open(ContactForm, 'Add person', null)}>+ Add</button></div>
    <div class="card list">{cs.map(x => <div class="item" key={x.id} onClick={() => open(ContactForm, 'Person', x)}><div class="grow"><b>{x.name}</b> <span class="mut small">{x.role}</span>
      <div class="small">{x.phone && <a href={'tel:' + x.phone} onClick={e => e.stopPropagation()}>{x.phone}</a>}{x.phone && x.email && ' · '}{x.email}</div></div></div>)}</div>
    {!cs.length && <div class="small mut">Parties, advocates, officers, witnesses.</div>}
    <div class="between"><h2 style="margin:14px 0 4px">Contact & settlement log</h2><button class="btn" onClick={() => open(LogForm, 'Log a contact', null)}>+ Log</button></div>
    <div class="small mut">Calls, messages, mediation sittings and offers — with dates.</div>
    <div class="card list" style="margin-top:6px">{log.map(x => <div class="item" key={x.id} onClick={() => open(LogForm, 'Contact', x)}><div class="d">{formatDate(x.date)}</div><div class="grow"><b>{x.mode}</b>{x.with ? ' with ' + x.with : ''}<div class="small">{x.summary}</div>{x.offer && <span class="tag warn">Offer: {x.offer}</span>}</div></div>)}</div>
  </main>;
}
