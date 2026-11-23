import { h } from 'preact';
import { useState } from 'preact/hooks';
import { useApp, useVault, Sheet, Field, Empty } from './core.jsx';
import { docsOf, eventsOf, allegationsOf, allegationProgress, upcoming, proceedingsOf } from '../domain.js';
import { formatDate } from '../search/dates.js';

export function CaseForm({ c, onDone }) {
  const app = useApp(); const v = app.v;
  const [f, setF] = useState({ name: c?.name || '', description: c?.description || '', opponent: c?.opponent || '', myRole: c?.myRole || '' });
  const save = async () => {
    if (!f.name.trim()) return app.toast('Give the case a name');
    if (c) await v.patch('cases', c.id, f); else { const id = await v.put('cases', { ...f, createdAt: Date.now() }); onDone(id); return; }
    onDone(c.id);
  };
  return <div>
    <Field label="Case name"><input type="text" value={f.name} placeholder="e.g. Matrimonial — with wife" onInput={e => setF({ ...f, name: e.currentTarget.value })} /></Field>
    <Field label="What this case covers (optional)"><textarea rows={2} value={f.description} placeholder="All proceedings, police matters and filings related to…" onInput={e => setF({ ...f, description: e.currentTarget.value })} /></Field>
    <div class="grid2">
      <Field label="Other side"><input type="text" value={f.opponent} placeholder="Name of the other party" onInput={e => setF({ ...f, opponent: e.currentTarget.value })} /></Field>
      <Field label="Your role"><input type="text" value={f.myRole} placeholder="e.g. Respondent No. 1" onInput={e => setF({ ...f, myRole: e.currentTarget.value })} /></Field>
    </div>
    <div class="row" style="margin-top:12px"><button class="btn" onClick={save}>{c ? 'Save' : 'Create case'}</button></div>
  </div>;
}

export function Home() {
  const app = useApp(); const v = useVault();
  const cases = v.list('cases', c => !c.archived).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const archived = v.list('cases', c => c.archived);
  const create = () => app.sheet.open(close => <Sheet title="New case" onClose={close}><CaseForm onDone={id => { close(); app.nav('case', id); }} /></Sheet>);
  const inbox = v.list('jobs', j => j.status === 'queued').length;
  return <main>
    {!v.adapter && <div class="box warn small">This device isn't connected to Google Drive yet, so changes stay on this device. <button class="lnk" onClick={() => app.nav('settings')}>Connect in Settings</button></div>}
    {inbox > 0 && <div class="box acc small">{inbox} Claude job{inbox > 1 ? 's' : ''} waiting. They run at the next scheduled run, or tap <b>Update vault</b> inside Claude.</div>}
    <div class="between"><h2>Cases</h2><button class="btn" onClick={create}>+ New case</button></div>
    {!cases.length && <Empty>No cases yet. Create one, then add its documents to the <b>inbox</b> folder in Google Drive and tap <b>Update vault</b>.</Empty>}
    {cases.map(c => {
      const docs = docsOf(v, c.id); const evs = eventsOf(v, c.id); const als = allegationsOf(v, c.id);
      const prog = als.reduce((a, x) => { const p = allegationProgress(v, x); return { t: a.t + p.total, d: a.d + p.done }; }, { t: 0, d: 0 });
      const ver = v.list('verifications', x => x.caseId === c.id && x.status !== 'resolved').length;
      const up = upcoming(v, c.id); const next = up.hearings[0];
      return <div class="card pad" style="cursor:pointer" onClick={() => app.nav('case', c.id)} key={c.id}>
        <div class="between"><b style="font-size:16px">{c.name}</b><span class="tiny mut">{proceedingsOf(v, c.id).length} proceedings</span></div>
        {c.description && <div class="small mut">{c.description}</div>}
        <div style="margin-top:6px">
          <span class="tag">{docs.length} documents</span><span class="tag">{evs.length} events</span>
          {prog.t > 0 && <span class={'tag ' + (prog.d === prog.t ? 'ok' : 'warn')}>{prog.d}/{prog.t} paragraphs answered</span>}
          {ver > 0 && <span class="tag bad">{ver} for verification</span>}
          {next && <span class="tag warn">Next: {formatDate(next.date)}</span>}
        </div>
      </div>;
    })}
    {archived.length > 0 && <details style="margin-top:12px"><summary class="small mut">Archived cases ({archived.length})</summary>
      {archived.map(c => <div class="card pad" key={c.id} onClick={() => app.nav('case', c.id)} style="cursor:pointer">{c.name}</div>)}</details>}
  </main>;
}
