import { h } from 'preact';
import { useState } from 'preact/hooks';
import { useApp, useVault, Sheet, Field, Empty, confirmBox } from './core.jsx';
import { CaseForm } from './cases.jsx';
import { Timeline, EventPage } from './timeline.jsx';
import { Documents, DocPage } from './documents.jsx';
import { Allegations, AllegationPage } from './allegations.jsx';
import { Verify } from './verify.jsx';
import { Evidence, Hearings, Money, People } from './trackers.jsx';
import { Ask } from './ask.jsx';
import { Exports } from './exports.jsx';
import { proceedingsOf, upcoming, allegationsOf, allegationProgress, docsOf, calendarLink } from '../domain.js';
import { formatDate } from '../search/dates.js';

const TABS = [['overview', 'Overview'], ['timeline', 'Timeline'], ['documents', 'Documents'], ['allegations', 'Allegations'], ['verify', 'For verification'], ['evidence', 'Evidence'], ['hearings', 'Hearings & orders'], ['money', 'Expenses'], ['people', 'People & contacts'], ['ask', 'Ask Claude'], ['exports', 'Export']];

export function CaseShell({ caseId }) {
  const app = useApp(); const v = useVault();
  const [, , sub, id] = app.path;
  const tab = TABS.some(t => t[0] === sub) ? sub : (['doc', 'al', 'ev'].includes(sub) ? null : 'overview');
  const vcount = v.list('verifications', x => x.caseId === caseId && x.status !== 'resolved').length;
  const sugg = v.list('replies', r => r.caseId === caseId && r.status === 'suggested').length;
  let body;
  if (sub === 'doc') body = <DocPage caseId={caseId} docId={id} />;
  else if (sub === 'al') body = <AllegationPage caseId={caseId} alId={id} />;
  else if (sub === 'ev') body = <EventPage caseId={caseId} eventId={id} />;
  else body = {
    overview: <Overview caseId={caseId} />, timeline: <Timeline caseId={caseId} />, documents: <Documents caseId={caseId} />,
    allegations: <Allegations caseId={caseId} />, verify: <Verify caseId={caseId} />, evidence: <Evidence caseId={caseId} />,
    hearings: <Hearings caseId={caseId} />, money: <Money caseId={caseId} />, people: <People caseId={caseId} />, ask: <Ask caseId={caseId} />, exports: <Exports caseId={caseId} />,
  }[tab];
  return <div>
    <div class="tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" class={'tab' + (tab === k ? ' on' : '')} onClick={() => app.nav('case', caseId, k)}>{l}
      {k === 'verify' && vcount > 0 && <span class="n">{vcount}</span>}{k === 'allegations' && sugg > 0 && <span class="n" style="background:var(--warn)">{sugg}</span>}</button>)}</div>
    {body}
  </div>;
}

export function ProceedingForm({ caseId, p, onDone }) {
  const app = useApp(); const v = app.v;
  const [f, setF] = useState({ number: p?.number || '', title: p?.title || '', court: p?.court || '', status: p?.status || 'Pending', filedBy: p?.filedBy || 'opponent', notes: p?.notes || '' });
  const set = k => e => setF({ ...f, [k]: e.currentTarget.value });
  const save = async () => { if (!f.number.trim() && !f.title.trim()) return app.toast('Add a case number or title'); if (p) await v.patch('proceedings', p.id, f); else await v.put('proceedings', { ...f, caseId }); onDone(); };
  return <div>
    <div class="grid2"><Field label="Case / file number"><input type="text" value={f.number} placeholder="AC 123/2026" onInput={set('number')} /></Field>
      <Field label="Short title"><input type="text" value={f.title} placeholder="DV complaint" onInput={set('title')} /></Field></div>
    <Field label="Court / forum"><input type="text" value={f.court} placeholder="Ld. 1st JM, City" onInput={set('court')} /></Field>
    <div class="grid2"><Field label="Status"><select value={f.status} onChange={set('status')}>{['Pending', 'Under appeal', 'Reserved', 'Disposed', 'Withdrawn', 'Dismissed', 'Closed'].map(s => <option>{s}</option>)}</select></Field>
      <Field label="Started by"><select value={f.filedBy} onChange={set('filedBy')}><option value="opponent">Other side</option><option value="me">Me</option><option value="court">Court / police</option></select></Field></div>
    <Field label="Notes"><textarea rows={2} value={f.notes} onInput={set('notes')} /></Field>
    <div class="row" style="margin-top:10px"><button class="btn" onClick={save}>Save</button>
      {p && <button class="btn g bad" style="color:var(--bad);border-color:var(--bad)" onClick={async () => { if (await confirmBox(app, 'Delete this proceeding? Documents stay in the case.', 'Delete', true)) { await v.del('proceedings', p.id); onDone(); } }}>Delete</button>}</div>
  </div>;
}

function FactsCard({ c }) {
  const app = useApp(); const v = app.v;
  const items = c.facts || [];
  const edit = () => app.sheet.open(close => <FactsEditor c={c} onDone={close} />);
  return <div class="card pad">
    <div class="between"><h3 style="margin:0">Quick facts</h3><button class="lnk" onClick={edit}>Edit</button></div>
    {!items.length && <div class="small mut">Case numbers, key dates, addresses, amounts — one tap to copy when a lawyer calls.</div>}
    <table class="t" style="margin-top:4px"><tbody>{items.map((it, i) => <tr key={i}><td class="mut" style="width:38%">{it.label}</td><td>{it.value}</td>
      <td style="width:1%"><button class="lnk" onClick={() => { navigator.clipboard?.writeText(it.value).then(() => app.toast('Copied'), () => app.toast('Copy not allowed here — long-press the text')); }}>Copy</button></td></tr>)}</tbody></table>
  </div>;
}
function FactsEditor({ c, onDone }) {
  const app = useApp();
  const [rows, setRows] = useState((c.facts || []).length ? c.facts : [{ label: '', value: '' }]);
  const upd = (i, k, val) => setRows(rows.map((r, j) => j === i ? { ...r, [k]: val } : r));
  return <Sheet title="Quick facts" onClose={onDone}>
    {rows.map((r, i) => <div class="row" key={i} style="margin-bottom:6px"><input type="text" style="flex:1" placeholder="Label" value={r.label} onInput={e => upd(i, 'label', e.currentTarget.value)} />
      <input type="text" style="flex:2" placeholder="Value" value={r.value} onInput={e => upd(i, 'value', e.currentTarget.value)} />
      <button class="x" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button></div>)}
    <div class="row"><button class="btn g s" onClick={() => setRows([...rows, { label: '', value: '' }])}>+ Add row</button>
      <button class="btn" onClick={async () => { await app.v.patch('cases', c.id, { facts: rows.filter(r => r.label || r.value) }); onDone(); }}>Save</button></div>
  </Sheet>;
}

function Overview({ caseId }) {
  const app = useApp(); const v = useVault(); const c = v.get('cases', caseId);
  const procs = proceedingsOf(v, caseId);
  const up = upcoming(v, caseId);
  const als = allegationsOf(v, caseId);
  const open = als.map(a => ({ a, p: allegationProgress(v, a) })).filter(x => x.p.done < x.p.total);
  const ver = v.list('verifications', x => x.caseId === caseId && x.status !== 'resolved');
  const sugg = v.list('replies', r => r.caseId === caseId && r.status === 'suggested');
  const polish = v.list('replies', r => r.caseId === caseId && r.toPolish);
  const dirs = v.list('directions', d => procs.some(p => p.id === d.proceedingId) && d.status !== 'complied' && d.status !== 'not applicable');
  const editProc = p => app.sheet.open(close => <Sheet title={p ? 'Edit proceeding' : 'Add proceeding'} onClose={close}><ProceedingForm caseId={caseId} p={p} onDone={close} /></Sheet>);
  const docCount = docsOf(v, caseId).length;
  return <main>
    {docCount === 0 && <div class="box acc small"><b>Getting started:</b> put this case's PDFs in the <b>inbox</b> folder of your Google Drive "{'Legal'}" folder and tap <b>Update vault</b>. You can also add a document by hand under Documents.</div>}
    <div class="stats" style="margin-bottom:10px">
      <div class="card stat" style="cursor:pointer" onClick={() => app.nav('case', caseId, 'hearings')}><span class="mut small">Next date</span><b>{up.hearings[0] ? formatDate(up.hearings[0].date) : '—'}</b><span class="small">{up.hearings[0]?.h.purpose || ''}</span></div>
      <div class="card stat" style="cursor:pointer" onClick={() => app.nav('case', caseId, 'verify')}><span class="mut small">For verification</span><b>{ver.length}</b><span class="small">dates/facts that differ</span></div>
      <div class="card stat" style="cursor:pointer" onClick={() => app.nav('case', caseId, 'allegations')}><span class="mut small">Allegations open</span><b>{open.length}</b><span class="small">{sugg.length} suggestions to review</span></div>
      <div class="card stat" style="cursor:pointer" onClick={() => app.nav('case', caseId, 'hearings')}><span class="mut small">Directions to follow</span><b>{dirs.length}</b><span class="small">not marked complied</span></div>
    </div>
    {up.deadlines.length > 0 && <div class="card pad"><h3 style="margin-top:0">Deadlines</h3>{up.deadlines.slice(0, 5).map(d => <div class="between small" key={d.id} style="padding:4px 0"><span><b>{formatDate(d.due)}</b> — {d.what}</span><a href={calendarLink(d.what, d.due, c.name)} target="_blank" rel="noopener">Add to calendar</a></div>)}</div>}
    {polish.length > 0 && <div class="box warn small">{polish.length} repl{polish.length > 1 ? 'ies' : 'y'} typed offline are waiting to be polished by Claude.</div>}
    <FactsCard c={c} />
    <div class="card pad">
      <div class="between"><h3 style="margin:0">Proceedings in this case</h3><button class="btn g s" onClick={() => editProc(null)}>+ Add</button></div>
      {!procs.length && <div class="small mut">Each court number (e.g. AC 123/2026, MS 456/2023) is a proceeding inside this case.</div>}
      <table class="t" style="margin-top:6px"><tbody>{procs.map(p => <tr key={p.id} style="cursor:pointer" onClick={() => editProc(p)}><td><b>{p.number}</b><div class="small mut">{p.title}</div></td><td class="small">{p.court}</td><td><span class={'tag ' + (p.status === 'Pending' ? 'warn' : '')}>{p.status}</span></td></tr>)}</tbody></table>
    </div>
    <div class="card pad"><div class="between"><div><b>{c.name}</b>{c.opponent && <div class="small mut">Other side: {c.opponent}{c.myRole ? ' · You: ' + c.myRole : ''}</div>}</div>
      <span class="row"><button class="lnk" onClick={() => app.sheet.open(close => <Sheet title="Edit case" onClose={close}><CaseForm c={c} onDone={close} /></Sheet>)}>Edit</button>
        <button class="lnk" onClick={async () => { if (await confirmBox(app, c.archived ? 'Restore this case?' : 'Archive this case? Nothing is deleted; it moves to "Archived".', c.archived ? 'Restore' : 'Archive')) await v.patch('cases', caseId, { archived: !c.archived }); }}>{c.archived ? 'Restore' : 'Archive'}</button></span></div></div>
  </main>;
}
