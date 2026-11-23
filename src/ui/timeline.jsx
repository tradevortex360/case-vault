import { h } from 'preact';
import { useState } from 'preact/hooks';
import { useApp, useVault, Sheet, Field, Empty, confirmBox, openPdf, TextBox } from './core.jsx';
import { eventsOf, proceedingsOf } from '../domain.js';
import { formatDate, parseDate } from '../search/dates.js';
import { EvidencePicker } from './trackers.jsx';

export const ACCOUNT = { theirs: ['Their account', 'bad'], mine: ['My account', 'ok'], record: ['On record', ''], both: ['Both versions', 'warn'] };

export function EventForm({ caseId, e, onDone }) {
  const app = useApp(); const v = app.v;
  const [f, setF] = useState({ date: e?.date ? formatDate(e.date) : '', title: e?.title || '', desc: e?.desc || '', account: e?.account || 'mine', proceedingId: e?.proceedingId || '', kind: e?.kind || 'incident' });
  const [err, setErr] = useState('');
  const set = k => ev => setF({ ...f, [k]: ev.currentTarget.value });
  const save = async () => {
    const d = f.date.trim() ? parseDate(f.date) : null;
    if (f.date.trim() && !d) return setErr('Date not understood. Use 03.04.2026, April 2026 or 2026.');
    if (!f.title.trim()) return setErr('Add a short title');
    const data = { ...f, date: d ? (d.precision === 'day' ? d.from : f.date.trim()) : null, caseId };
    if (e) await v.patch('events', e.id, data); else await v.put('events', { ...data, manual: true, sources: [], createdAt: Date.now() });
    onDone();
  };
  return <div>
    <div class="grid2"><Field label="Date"><input type="text" value={f.date} placeholder="03.04.2026 or April 2026" onInput={set('date')} /></Field>
      <Field label="Type"><select value={f.kind} onChange={set('kind')}>{[['incident', 'Incident'], ['filing', 'Filing'], ['order', 'Court order'], ['hearing', 'Hearing'], ['police', 'Police'], ['communication', 'Call / message'], ['other', 'Other']].map(([k, l]) => <option value={k}>{l}</option>)}</select></Field></div>
    <Field label="What happened (short title)"><input type="text" value={f.title} onInput={set('title')} /></Field>
    <Field label="Details"><TextBox value={f.desc} rows={3} onInput={x => setF({ ...f, desc: x })} /></Field>
    <div class="grid2"><Field label="Whose account"><select value={f.account} onChange={set('account')}>{Object.entries(ACCOUNT).map(([k, [l]]) => <option value={k}>{l}</option>)}</select></Field>
      <Field label="Proceeding"><select value={f.proceedingId} onChange={set('proceedingId')}><option value="">— whole case —</option>{proceedingsOf(v, caseId).map(p => <option value={p.id}>{p.number} {p.title}</option>)}</select></Field></div>
    {err && <div class="small" style="color:var(--bad);margin-top:6px">{err}</div>}
    <div class="row" style="margin-top:12px"><button class="btn" onClick={save}>Save</button></div>
  </div>;
}

export function Timeline({ caseId }) {
  const app = useApp(); const v = useVault();
  const [flt, setFlt] = useState({ proc: '', acc: '', only: '' });
  const procs = proceedingsOf(v, caseId);
  let evs = eventsOf(v, caseId);
  if (flt.proc) evs = evs.filter(e => e.proceedingId === flt.proc);
  if (flt.acc) evs = evs.filter(e => e.account === flt.acc);
  if (flt.only === 'verified') evs = evs.filter(e => e.verified?.status === 'verified');
  if (flt.only === 'evidence') evs = evs.filter(e => (e.evidenceIds || []).length);
  if (flt.only === 'manual') evs = evs.filter(e => e.manual);
  const add = () => app.sheet.open(close => <Sheet title="Add event" onClose={close}><EventForm caseId={caseId} onDone={close} /></Sheet>);
  let year = null;
  return <main>
    <div class="between"><h2 style="margin:4px 0">Timeline</h2><button class="btn" onClick={add}>+ Add event</button></div>
    <div class="row small" style="margin:6px 0">
      <select style="width:auto" value={flt.proc} onChange={e => setFlt({ ...flt, proc: e.currentTarget.value })} aria-label="Proceeding"><option value="">All proceedings</option>{procs.map(p => <option value={p.id}>{p.number}</option>)}</select>
      <select style="width:auto" value={flt.acc} onChange={e => setFlt({ ...flt, acc: e.currentTarget.value })} aria-label="Account"><option value="">All accounts</option>{Object.entries(ACCOUNT).map(([k, [l]]) => <option value={k}>{l}</option>)}</select>
      <select style="width:auto" value={flt.only} onChange={e => setFlt({ ...flt, only: e.currentTarget.value })} aria-label="Show"><option value="">Everything</option><option value="verified">Verified ✓ only</option><option value="evidence">With evidence</option><option value="manual">Added by me</option></select>
    </div>
    {!evs.length && <Empty>No events{flt.proc || flt.acc || flt.only ? ' match these filters' : ' yet'}.</Empty>}
    <div class="card list">{evs.map(e => {
      const y = e.date ? (parseDate(e.date)?.from || '').slice(0, 4) : 'Undated';
      const head = y !== year ? (year = y) : null;
      const [al, at] = ACCOUNT[e.account] || ['', ''];
      return [head && <div class="tiny mut" style="padding:8px 14px 2px;font-weight:600;border-top:1px solid var(--line)" key={'y' + y}>{y}</div>,
        <div class="item" key={e.id} onClick={() => app.nav('case', caseId, 'ev', e.id)}>
          <div class="d">{formatDate(e.date)}</div>
          <div class="grow"><b>{e.title}</b>
            <div>{al && <span class={'tag ' + at}>{al}</span>}{e.verified?.status === 'verified' && <span class="tag ok">✓ verified</span>}{e.verified?.status === 'disputed' && <span class="tag bad">disputed</span>}
              {(e.evidenceIds || []).length > 0 && <span class="tag">📎 {e.evidenceIds.length}</span>}{(e.sources || []).length > 1 && <span class="tag">{e.sources.length} sources</span>}{e.manual && <span class="tag">added by me</span>}</div></div></div>];
    })}</div>
  </main>;
}

export function EventPage({ caseId, eventId }) {
  const app = useApp(); const v = useVault(); const e = v.get('events', eventId);
  if (!e) return <main><Empty>This event no longer exists.</Empty></main>;
  const docs = Object.fromEntries(v.list('documents').map(d => [d.id, d]));
  const evid = (e.evidenceIds || []).map(id => v.get('evidence', id)).filter(Boolean);
  const [al, at] = ACCOUNT[e.account] || ['', ''];
  const verify = () => app.sheet.open(close => <VerifyEvent e={e} onDone={close} />);
  const merge = () => app.sheet.open(close => <MergePicker caseId={caseId} e={e} onDone={close} />);
  return <main>
    <div class="card pad">
      <div class="mut small">{formatDate(e.date)}{e.kind ? ' · ' + e.kind : ''}</div>
      <h2 style="margin:4px 0">{e.title}</h2>
      <div>{al && <span class={'tag ' + at}>{al}</span>}{e.verified?.status === 'verified' && <span class="tag ok">✓ verified by you</span>}{e.manual && <span class="tag">added by you</span>}</div>
      {e.desc && <p style="white-space:pre-wrap">{e.desc}</p>}
      {e.verified?.note && <div class="box ok small"><b>Your note:</b> {e.verified.note}</div>}
      <div class="row" style="margin-top:8px">
        <button class="btn s" onClick={verify}>{e.verified?.status ? 'Change verification' : 'Verify'}</button>
        <button class="btn g s" onClick={() => app.sheet.open(close => <Sheet title="Edit event" onClose={close}><EventForm caseId={caseId} e={e} onDone={close} /></Sheet>)}>Edit</button>
        <button class="btn g s" onClick={merge}>Merge duplicate…</button>
        <button class="btn g s" style="color:var(--bad);border-color:var(--bad)" onClick={async () => { if (await confirmBox(app, 'Delete this event? You can restore it from Settings → Backups.', 'Delete', true)) { await v.del('events', e.id); app.back(); } }}>Delete</button>
      </div>
    </div>
    <h3>Where this is recorded</h3>
    {!(e.sources || []).length && <div class="small mut">No document source{e.manual ? ' — you added this yourself' : ''}.</div>}
    {(e.sources || []).map((s, i) => { const d = docs[s.docId]; return <div class="card pad small" key={i}>
      <b>{d ? (d.short || d.title) : s.label || 'Source'}</b>{s.ref ? ' · ' + s.ref : ''}{s.page ? ' · page ' + s.page : ''}{s.claim ? <div class="mut">{s.claim}</div> : null}
      <div class="row" style="margin-top:4px">{d?.fileId && s.page && <button class="lnk" onClick={() => openPdf(app, d, s.page)}>Open page {s.page}</button>}{d && <button class="lnk" onClick={() => app.nav('case', caseId, 'doc', d.id)}>Open document</button>}</div></div>; })}
    <div class="between"><h3>Supporting evidence</h3><button class="btn g s" onClick={() => app.sheet.open(close => <Sheet title="Attach evidence" onClose={close}><EvidencePicker caseId={caseId} selected={e.evidenceIds || []} onDone={async ids => { await v.patch('events', e.id, { evidenceIds: ids }); close(); }} /></Sheet>)}>Attach</button></div>
    {!evid.length && <div class="small mut">Optional. Attach a receipt, message, photo, recording or police copy that proves this.</div>}
    {evid.map(x => <div class="card pad small" key={x.id}><b>{x.title}</b><div class="mut">{[x.kind, x.obtainedOn && 'obtained ' + formatDate(x.obtainedOn), x.originalLocation && 'original: ' + x.originalLocation].filter(Boolean).join(' · ')}</div></div>)}
  </main>;
}

function VerifyEvent({ e, onDone }) {
  const app = useApp(); const v = app.v;
  const [st, setSt] = useState(e.verified?.status || 'verified'); const [date, setDate] = useState(e.date ? formatDate(e.date) : ''); const [note, setNote] = useState(e.verified?.note || '');
  const save = async () => {
    const d = date.trim() ? parseDate(date) : null;
    if (date.trim() && !d) return app.toast('Date not understood');
    await v.patch('events', e.id, { date: d ? (d.precision === 'day' ? d.from : date.trim()) : e.date, verified: { status: st, note, at: Date.now() } });
    onDone(); app.toast('Saved');
  };
  return <Sheet title="Verify event" onClose={onDone}>
    <p class="small mut">Confirm this from your own knowledge. If the date is wrong, correct it here and say why.</p>
    <Field label="Status"><select value={st} onChange={x => setSt(x.currentTarget.value)}><option value="verified">✓ Correct as stated (verified)</option><option value="disputed">Disputed — this is not true</option><option value="">Not verified yet</option></select></Field>
    <Field label="Correct date"><input type="text" value={date} onInput={x => setDate(x.currentTarget.value)} /></Field>
    <Field label="Why / how you know (optional)"><TextBox value={note} rows={2} onInput={setNote} /></Field>
    <div class="row" style="margin-top:10px"><button class="btn" onClick={save}>Save</button></div>
  </Sheet>;
}

function MergePicker({ caseId, e, onDone }) {
  const app = useApp(); const v = app.v; const [q, setQ] = useState('');
  const others = eventsOf(v, caseId).filter(x => x.id !== e.id && (!q || (x.title + formatDate(x.date)).toLowerCase().includes(q.toLowerCase())));
  const merge = async o => {
    if (!await confirmBox(app, `Merge "${o.title}" into "${e.title}"? Its sources and evidence move here; the other entry is hidden (you can restore it from Backups).`, 'Merge')) return;
    const sources = [...(e.sources || []), ...(o.sources || [])].filter((s, i, a) => a.findIndex(t => t.docId === s.docId && t.page === s.page && t.ref === s.ref) === i);
    const evidenceIds = [...new Set([...(e.evidenceIds || []), ...(o.evidenceIds || [])])];
    await v.commit([{ coll: 'events', key: e.id, kind: 'patch', data: { sources, evidenceIds, desc: [e.desc, o.desc && o.desc !== e.desc ? o.desc : ''].filter(Boolean).join('\n\n') } }, { coll: 'events', key: o.id, kind: 'patch', data: { mergedInto: e.id } }]);
    onDone(); app.toast('Merged');
  };
  return <Sheet title="Merge a duplicate into this event" onClose={onDone}>
    <input type="search" placeholder="Find the duplicate…" value={q} onInput={x => setQ(x.currentTarget.value)} />
    <div class="card list" style="margin-top:8px">{others.slice(0, 40).map(o => <div class="item" key={o.id} onClick={() => merge(o)}><div class="d">{formatDate(o.date)}</div><div class="grow">{o.title}</div></div>)}</div>
  </Sheet>;
}
