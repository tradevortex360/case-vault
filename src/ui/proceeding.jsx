import { h } from 'preact';
import { useApp, useVault, Sheet, Empty, Gloss } from './core.jsx';
import { ProceedingForm } from './caseShell.jsx';
import { HearingForm, DeadlineForm, DirectionForm } from './trackers.jsx';
import { docsOf, eventsOf, docName, filerOf, calendarLink, needsReply, parasOf, paraStatus } from '../domain.js';
import { formatDate } from '../search/dates.js';

const today = () => new Date().toISOString().slice(0, 10);

// Dates that matter for one proceeding: started, last hearing, next date.
export function procSummary(v, p) {
  const hs = v.list('hearings', h => h.proceedingId === p.id).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const t = today();
  const last = [...hs].reverse().find(h => h.date && h.date <= t);
  const nextCands = hs.flatMap(h => [h.date, h.nextDate]).filter(d => d && d >= t).sort();
  const docs = v.list('documents', d => d.proceedingId === p.id);
  const started = p.startedOn || docs.map(d => d.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort()[0] || '';
  const bits = [];
  if (nextCands[0]) bits.push('Next date ' + formatDate(nextCands[0]));
  if (last) bits.push('last heard ' + formatDate(last.date));
  if (!nextCands[0] && !last && started) bits.push((p.startedOn ? 'Filed ' : 'First document ') + formatDate(started));
  if (docs.length) bits.push(docs.length + (docs.length === 1 ? ' document' : ' documents'));
  const line = bits.join(', ');
  return { hearings: hs, last, next: nextCands[0] || '', started, docs, line: line && line[0].toUpperCase() + line.slice(1) };
}

export function ProceedingPage({ caseId, procId }) {
  const app = useApp(); const v = useVault();
  const p = v.get('proceedings', procId);
  if (!p) return <main><Empty>This proceeding was removed.</Empty></main>;
  const c = v.get('cases', caseId);
  const s = procSummary(v, p);
  const open = (T, title, x) => app.sheet.open(close => <Sheet title={title} onClose={close}><T caseId={caseId} x={x} procId={p.id} onDone={close} /></Sheet>);
  const edit = () => app.sheet.open(close => <Sheet title="Edit proceeding" onClose={close}><ProceedingForm caseId={caseId} p={p} onDone={close} /></Sheet>);
  const dirs = v.list('directions', d => d.proceedingId === p.id);
  const dls = v.list('deadlines', d => d.proceedingId === p.id).sort((a, b) => (a.done - b.done) || (a.due || '').localeCompare(b.due || ''));
  const docs = docsOf(v, caseId).filter(d => d.proceedingId === p.id);
  const evs = eventsOf(v, caseId).filter(e => e.proceedingId === p.id);
  const hs = [...s.hearings].reverse();
  const roles = [p.myRole && 'You: ' + p.myRole, p.theirRole && 'Other side: ' + p.theirRole].filter(Boolean).join('. ');
  return <main>
    <section class="card pad">
      <div class="between"><div>
        <h2 style="margin:0">{p.number || p.title}</h2>
        <div class="small" style="margin-top:2px"><Gloss text={[p.title, p.court].filter(Boolean).join(', ')} /></div>
        {roles && <div class="small mut" style="margin-top:2px"><Gloss text={roles} /></div>}
      </div><span class="row" style="flex:none"><span class={'tag ' + ((p.status || '').toLowerCase() === 'pending' ? 'warn' : '')}>{p.status}</span><button class="btn g s" onClick={edit}>Edit</button></span></div>
      <div class="pdates">
        <div><span class="k">Filed</span><b>{s.started ? formatDate(s.started) : '—'}</b>{!p.startedOn && s.started && <span class="tiny mut">from first document</span>}</div>
        <div><span class="k">Last hearing</span><b>{s.last ? formatDate(s.last.date) : '—'}</b>{s.last?.purpose && <span class="tiny mut"><Gloss text={s.last.purpose} /></span>}</div>
        <div class={s.next ? 'nx' : ''}><span class="k">Next date</span><b>{s.next ? formatDate(s.next) : 'Not recorded'}</b>
          {s.next && <a class="lnk tiny" href={calendarLink(`${p.number} ${s.hearings.find(h => h.nextDate === s.next)?.nextPurpose || 'hearing'}`, s.next, c?.name || '')} target="_blank" rel="noopener">Add to calendar</a>}</div>
      </div>
    </section>

    <section class="card pad">
      <div class="between"><h3 style="margin:0">Hearings</h3><button class="btn s" onClick={() => open(HearingForm, 'Log a hearing', null)}>+ Log hearing</button></div>
      {!hs.length && <p class="small mut" style="margin:6px 0 0">No hearings logged. After each date, note what happened and the next date.</p>}
      {hs.length > 0 && <div class="list flat">{hs.map(x => <div class="item" key={x.id} onClick={() => open(HearingForm, 'Hearing', x)}>
        <div class="d">{formatDate(x.date)}</div>
        <div class="grow"><b><Gloss text={x.purpose || 'Hearing'} /></b>{x.outcome && <div class="small"><Gloss text={x.outcome} /></div>}
          {x.nextDate && <div class="small" style="margin-top:3px"><span class={'tag ' + (x.nextDate >= today() ? 'warn' : '')}>Next: {formatDate(x.nextDate)}</span>{x.nextPurpose && <span class="mut"> <Gloss text={x.nextPurpose} /></span>}</div>}</div></div>)}</div>}
    </section>

    <section class="card pad">
      <div class="between"><h3 style="margin:0">Orders and directions</h3><button class="btn g s" onClick={() => open(DirectionForm, 'Court direction', null)}>+ Add</button></div>
      {!dirs.length && <p class="small mut" style="margin:6px 0 0">Nothing recorded.</p>}
      {dirs.length > 0 && <div class="list flat">{dirs.map(x => <div class="item" key={x.id} onClick={() => open(DirectionForm, 'Court direction', x)}>
        <div class="d">{x.orderDate ? formatDate(x.orderDate) : ''}</div>
        <div class="grow"><Gloss text={x.text} /> <span class={'tag ' + (x.status === 'complied' ? 'ok' : 'bad')}>{x.status === 'complied' ? 'complied' : x.status || 'to comply'}</span></div></div>)}</div>}
    </section>

    {(dls.length > 0) && <section class="card pad">
      <div class="between"><h3 style="margin:0">Deadlines</h3><button class="btn g s" onClick={() => open(DeadlineForm, 'Add deadline', null)}>+ Add</button></div>
      <div class="list flat">{dls.map(x => <div class="item" key={x.id} onClick={() => open(DeadlineForm, 'Deadline', x)}>
        <div class="d">{formatDate(x.due)}</div><div class="grow" style={x.done ? 'text-decoration:line-through;opacity:.6' : ''}>{x.what}</div></div>)}</div>
    </section>}

    <section class="card pad">
      <h3 style="margin:0">Documents</h3>
      {!docs.length && <p class="small mut" style="margin:6px 0 0">No documents filed in this proceeding yet.</p>}
      {docs.length > 0 && <div class="list flat">{docs.map(d => { const paras = needsReply(d) ? parasOf(v, d.id) : []; const done = paras.filter(x => paraStatus(v, x) !== 'open').length;
        return <div class="item" key={d.id} onClick={() => app.nav('case', caseId, 'doc', d.id)}>
          <div class="d">{/^\d{4}-/.test(d.date || '') ? formatDate(d.date) : d.date}</div>
          <div class="grow"><b><Gloss text={docName(d)} /></b><div class="small mut">{filerOf(v, d) ? 'Filed by ' + (/^the /.test(filerOf(v, d)) ? '' : 'the ') + filerOf(v, d) : ''}{paras.length ? `. ${done} of ${paras.length} paragraphs answered` : ''}</div></div></div>; })}</div>}
    </section>

    {evs.length > 0 && <section class="card pad">
      <h3 style="margin:0">Timeline</h3>
      <div class="list flat">{evs.map(e => <div class="item" key={e.id} onClick={() => app.nav('case', caseId, 'ev', e.id)}>
        <div class="d">{/^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? formatDate(e.date) : e.date}</div><div class="grow"><Gloss text={e.title} /></div></div>)}</div>
    </section>}
  </main>;
}
