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
const GROUP_BEFORE = { overview: 'Case file', evidence: 'Records', ask: 'With Claude' };

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
  return <div class="case">
    <nav class="tabs" role="tablist" aria-label="Case sections">{TABS.map(([k, l]) => [GROUP_BEFORE[k] && <span class="gl" key={'g' + k} aria-hidden="true">{GROUP_BEFORE[k]}</span>,
      <button key={k} role="tab" aria-selected={tab === k} class={'tab' + (tab === k ? ' on' : '')} onClick={() => app.nav('case', caseId, k)}>{l}
      {k === 'verify' && vcount > 0 && <span class="n">{vcount}</span>}{k === 'allegations' && sugg > 0 && <span class="n" style="background:var(--warn)">{sugg}</span>}</button>])}</nav>
    <div>{body}</div>
  </div>;
}

export function ProceedingForm({ caseId, p, onDone }) {
  const app = useApp(); const v = app.v;
  const [f, setF] = useState({ number: p?.number || '', title: p?.title || '', court: p?.court || '', status: p?.status || 'Pending', filedBy: p?.filedBy || 'opponent', myRole: p?.myRole || '', theirRole: p?.theirRole || '', notes: p?.notes || '' });
  const set = k => e => setF({ ...f, [k]: e.currentTarget.value });
  const save = async () => { if (!f.number.trim() && !f.title.trim()) return app.toast('Add a case number or title'); if (p) await v.patch('proceedings', p.id, f); else await v.put('proceedings', { ...f, caseId }); onDone(); };
  return <div>
    <div class="grid2"><Field label="Case / file number"><input type="text" value={f.number} placeholder="AC 123/2026" onInput={set('number')} /></Field>
      <Field label="Short title"><input type="text" value={f.title} placeholder="DV complaint" onInput={set('title')} /></Field></div>
    <Field label="Court / forum"><input type="text" value={f.court} placeholder="Ld. 1st JM, City" onInput={set('court')} /></Field>
    <div class="grid2"><Field label="Status"><select value={f.status} onChange={set('status')}>{['Pending', 'Under appeal', 'Reserved', 'Disposed', 'Withdrawn', 'Dismissed', 'Closed'].map(s => <option>{s}</option>)}</select></Field>
      <Field label="Started by"><select value={f.filedBy} onChange={set('filedBy')}><option value="opponent">Other side</option><option value="me">Me</option><option value="court">Court / police</option></select></Field></div>
    <div class="grid2"><Field label="You are the"><input type="text" value={f.myRole} list="roles" placeholder="Respondent No. 1" onInput={set('myRole')} /></Field>
      <Field label="The other side is the"><input type="text" value={f.theirRole} list="roles" placeholder="Petitioner" onInput={set('theirRole')} /></Field></div>
    <datalist id="roles">{['Petitioner', 'Respondent', 'Respondent No. 1', 'Appellant', 'Complainant', 'Accused', 'Opposite Party', 'Plaintiff', 'Defendant'].map(r => <option value={r} />)}</datalist>
    <div class="small mut">Used when documents are named, e.g. "filed by the Petitioner in AC 123/2026".</div>
    <Field label="Notes"><textarea rows={2} value={f.notes} onInput={set('notes')} /></Field>
    <div class="row" style="margin-top:10px"><button class="btn" onClick={save}>Save</button>
      {p && <button class="btn g bad" style="color:var(--bad);border-color:var(--bad)" onClick={async () => { if (await confirmBox(app, 'Delete this proceeding? Documents stay in the case.', 'Delete', true)) { await v.del('proceedings', p.id); onDone(); } }}>Delete</button>}</div>
  </div>;
}

const CopyIcon = () => <svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" /></svg>;
const TickIcon = () => <svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 10.5l4 4 8-9" /></svg>;

// "AC 123/2026, Ld. 1st JM, City" -> the key part in bold, the rest quieter
function splitFact(v = '') {
  const m = v.match(/^(.{3,}?)(\s*(?:,|\(|—| - |;).*)$/s);
  return m ? [m[1], m[2]] : [v];
}
function FactsCard({ c }) {
  const app = useApp();
  const items = (c.facts || []).filter(it => it.label || it.value);
  const [all, setAll] = useState(false); const [copied, setCopied] = useState(-1);
  const edit = () => app.sheet.open(close => <FactsEditor c={c} onDone={close} />);
  const copy = (it, i) => navigator.clipboard?.writeText(it.value).then(() => { setCopied(i); setTimeout(() => setCopied(-1), 1500); }, () => app.toast('Copy not allowed here — long-press the text'));
  const shown = all ? items : items.slice(0, 12);
  return <section class="card pad">
    <div class="between"><h3 style="margin:0">Quick facts</h3><button class="lnk" onClick={edit}>{items.length ? 'Edit' : 'Add facts'}</button></div>
    {!items.length && <p class="small mut" style="margin:6px 0 0">Case numbers, key dates, addresses and amounts you need when a lawyer calls. Tap one to copy it.</p>}
    {items.length > 0 && <div class="facts">{shown.map((it, i) => <button type="button" class="fact" key={i} onClick={() => copy(it, i)} title="Tap to copy">
      <span class="fl">{it.label}</span>
      <span class="fv">{splitFact(it.value).map((t, k) => k ? <span class="fd" key={k}>{t}</span> : <b key={k}>{t}</b>)}</span>
      <span class={'fc' + (copied === i ? ' on' : '')} aria-label={copied === i ? 'Copied' : 'Copy'}>{copied === i ? <TickIcon /> : <CopyIcon />}</span>
    </button>)}</div>}
    {items.length > 12 && <button class="lnk more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${items.length} facts`}</button>}
  </section>;
}
function FactsEditor({ c, onDone }) {
  const app = useApp();
  const [rows, setRows] = useState((c.facts || []).length ? c.facts : [{ label: '', value: '' }]);
  const upd = (i, k, val) => setRows(rows.map((r, j) => j === i ? { ...r, [k]: val } : r));
  const move = (i, d) => { const r = [...rows]; const [x] = r.splice(i, 1); r.splice(i + d, 0, x); setRows(r); };
  return <Sheet title="Quick facts" onClose={onDone}>
    {rows.map((r, i) => <div class="card pad" key={i} style="margin-bottom:8px">
      <div class="between"><input type="text" style="font-weight:600" placeholder="Label (e.g. DV case)" value={r.label} onInput={e => upd(i, 'label', e.currentTarget.value)} />
        <span class="row" style="flex:none;gap:2px;margin-left:6px">{i > 0 && <button class="btn g s" aria-label="Move up" onClick={() => move(i, -1)}>↑</button>}{i < rows.length - 1 && <button class="btn g s" aria-label="Move down" onClick={() => move(i, 1)}>↓</button>}<button class="x" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button></span></div>
      <textarea rows={2} style="margin-top:6px" placeholder="Value (e.g. AC 123/2026, Ld. 1st JM)" value={r.value} onInput={e => upd(i, 'value', e.currentTarget.value)} />
    </div>)}
    <div class="row"><button class="btn g s" onClick={() => setRows([...rows, { label: '', value: '' }])}>+ Add fact</button>
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
  const nx = up.hearings[0];
  const days = nx ? Math.round((new Date(nx.date + 'T00:00') - new Date(new Date().toDateString())) / 864e5) : null;
  const proc = nx && procs.find(p => p.id === nx.h.proceedingId);
  const purpose = nx && ((nx.date === nx.h.nextDate ? nx.h.nextPurpose : nx.h.purpose) || 'Hearing');
  const attn = [
    [ver.length, ver.length === 1 ? 'date or fact differs between documents' : 'dates or facts differ between documents', 'Review', 'verify'],
    [open.length, open.length === 1 ? 'allegation still needs your reply' : 'allegations still need your reply', 'Reply', 'allegations'],
    [sugg.length, sugg.length === 1 ? 'suggested reply from Claude to check' : 'suggested replies from Claude to check', 'Check', 'allegations'],
    [dirs.length, dirs.length === 1 ? 'court direction not marked complied' : 'court directions not marked complied', 'Open', 'hearings'],
    [polish.length, polish.length === 1 ? 'reply typed offline waits for polishing' : 'replies typed offline wait for polishing', 'Open', 'allegations'],
  ].filter(x => x[0] > 0);
  return <main>
    {docCount === 0 && <div class="box acc small"><b>Getting started:</b> put this case's PDFs in the <b>inbox</b> folder of your Google Drive "Legal" folder and tap <b>Update vault</b>. You can also add a document by hand under Documents.</div>}
    {nx ? <section class="next" aria-label="Next date in court">
      <span class="k">Next date in court</span>
      <div><div class="date">{longDate(nx.date)}</div><div class="when">{weekday(nx.date)}, {days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}</div></div>
      <div class="acts"><a class="btn g s" href={calendarLink(`${proc?.number || ''} ${purpose}`.trim(), nx.date, c.name)} target="_blank" rel="noopener">Add to calendar</a></div>
      <div class="what">{purpose}{proc ? <span class="mut"> in {proc.number}{proc.court ? ', ' + proc.court : ''}</span> : ''}</div>
    </section> : <section class="next none" aria-label="Next date in court">
      <span class="k">Next date in court</span>
      <div><div class="date">No date recorded</div><div class="when">Log the last hearing and its next date so it shows here.</div></div>
      <div class="acts"><button class="btn s" onClick={() => app.nav('case', caseId, 'hearings')}>Log a hearing</button></div>
    </section>}
    {up.deadlines.length > 0 && <section class="card pad"><h3 style="margin-top:0">Deadlines</h3>{up.deadlines.slice(0, 5).map(d => <div class="between small" key={d.id} style="padding:4px 0"><span><b>{formatDate(d.due)}</b> {d.what}</span><a href={calendarLink(d.what, d.due, c.name)} target="_blank" rel="noopener">Add to calendar</a></div>)}</section>}
    <section class="card attn" aria-label="Needs your attention">
      <h3 style="margin:0;padding:12px 14px 4px">Needs your attention</h3>
      {attn.length ? attn.map(([n, label, go, tab]) => <button type="button" class="row-a" key={label} onClick={() => app.nav('case', caseId, tab)}>
        <span class="num">{n}</span><span>{label}</span><span class="go">{go}</span></button>)
        : <div class="clear">Nothing waiting. Every allegation has a reply and every difference is settled.</div>}
    </section>
    <FactsCard c={c} />
    <section class="card pad">
      <div class="between"><h3 style="margin:0">Proceedings</h3><button class="btn g s" onClick={() => editProc(null)}>Add proceeding</button></div>
      {!procs.length && <p class="small mut" style="margin:6px 0 0">Each court number (for example AC 123/2026 or MS 456/2023) is a proceeding inside this case.</p>}
      {procs.length > 0 && <div class="procs">{procs.map(p => <button type="button" class="proc" key={p.id} onClick={() => editProc(p)}>
        <span class="no">{p.number}</span><span class={'st ' + (p.status || '').toLowerCase()}>{p.status}</span>
        <span class="sub">{[p.title, p.court].filter(Boolean).join(', ')}</span></button>)}</div>}
    </section>
    <section class="card pad case-id"><div><b>{c.name}</b>{c.opponent && <div class="small mut">Other side: {c.opponent}{c.myRole ? '. You: ' + c.myRole : ''}</div>}</div>
      <span class="row"><button class="lnk" onClick={() => app.sheet.open(close => <Sheet title="Edit case" onClose={close}><CaseForm c={c} onDone={close} /></Sheet>)}>Edit</button>
        <button class="lnk" onClick={async () => { if (await confirmBox(app, c.archived ? 'Restore this case?' : 'Archive this case? Nothing is deleted; it moves to "Archived".', c.archived ? 'Restore' : 'Archive')) await v.patch('cases', caseId, { archived: !c.archived }); }}>{c.archived ? 'Restore' : 'Archive'}</button></span></section>
  </main>;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function longDate(iso) { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; }
function weekday(iso) { return new Date(iso + 'T00:00').toLocaleDateString('en-IN', { weekday: 'long' }); }
