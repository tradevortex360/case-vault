import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { useApp, useVault, Sheet, Field, Empty, confirmBox, openPdf, PointLines, TextBox } from './core.jsx';
import { allegationsOf, allegationProgress, repliesFor, paraStatus, datesIn, eventsOf, nextAllegationNo, addDays, docCite } from '../domain.js';
import { ReplyComposer, ReplyView } from './replies.jsx';
import { requestJob } from '../claude/jobs.js';
import { formatDate, parseDate, sortKey } from '../search/dates.js';
import { SearchIndex, buildItems } from '../search/index.js';

function AllegationForm({ caseId, a, onDone }) {
  const app = useApp(); const v = app.v;
  const [f, setF] = useState({ title: a?.title || '', brief: a?.brief || '', group: a?.group || '' });
  const save = async () => { if (!f.title.trim()) return app.toast('Give it a short title'); if (a) await v.patch('allegations', a.id, f); else await v.put('allegations', { ...f, caseId, n: nextAllegationNo(v, caseId), paraIds: [] }); onDone(); };
  return <div>
    <Field label="Allegation (short)"><input type="text" value={f.title} placeholder="Refusal of duplicate keys" onInput={e => setF({ ...f, title: e.currentTarget.value })} /></Field>
    <Field label="Allegation in brief"><textarea rows={3} value={f.brief} onInput={e => setF({ ...f, brief: e.currentTarget.value })} /></Field>
    <Field label="Group"><input type="text" value={f.group} placeholder="e.g. DV order & enforcement" onInput={e => setF({ ...f, group: e.currentTarget.value })} /></Field>
    <div class="row" style="margin-top:10px"><button class="btn" onClick={save}>Save</button>
      {a && <button class="btn g" style="color:var(--bad);border-color:var(--bad)" onClick={async () => { if (await confirmBox(app, 'Delete this allegation? Paragraphs and replies stay; they are just no longer grouped here.', 'Delete', true)) { await v.del('allegations', a.id); onDone(); app.back(); } }}>Delete</button>}</div>
  </div>;
}

export function Allegations({ caseId }) {
  const app = useApp(); const v = useVault();
  const [flt, setFlt] = useState('');
  const all = allegationsOf(v, caseId);
  const rows = all.map(a => ({ a, p: allegationProgress(v, a), sug: v.list('replies', r => r.allegationId === a.id && r.status === 'suggested').length }))
    .filter(x => !flt || (flt === 'open' ? x.p.done < x.p.total : flt === 'sug' ? x.sug > 0 : x.p.done === x.p.total));
  let group = null;
  return <main>
    <div class="between"><h2 style="margin:4px 0">Allegations</h2><button class="btn g" onClick={() => app.sheet.open(close => <Sheet title="New allegation" onClose={close}><AllegationForm caseId={caseId} onDone={close} /></Sheet>)}>+ New</button></div>
    <div class="small mut">Paragraphs from every document filed against you, grouped by what they allege. Answer each paragraph, or write one common reply for all of them.</div>
    <div class="row" style="margin:8px 0">{[['', 'All'], ['open', 'Not fully answered'], ['sug', 'Has suggestions'], ['done', 'Done']].map(([k, l]) => <span class={'chip' + (flt === k ? ' on' : '')} onClick={() => setFlt(k)}>{l}</span>)}</div>
    {!rows.length && <Empty>{all.length ? 'Nothing matches this filter.' : 'No allegations yet — they are created when Claude reads documents filed against you.'}</Empty>}
    <div class="card list">{rows.map(({ a, p, sug }) => {
      const head = (a.group || '') !== group ? (group = a.group || '') : null;
      return [head !== null && head && <div class="tiny mut" style="padding:8px 14px 2px;font-weight:600;border-top:1px solid var(--line)">{head}</div>,
        <div class="item" key={a.id} onClick={() => app.nav('case', caseId, 'al', a.id)}>
          <div class="d" style="flex-basis:40px">A{a.n}</div>
          <div class="grow"><b>{a.title}</b><div>
            <span class={'tag ' + (p.total && p.done === p.total ? 'ok' : 'warn')}>{p.done}/{p.total} answered</span>
            {sug > 0 && <span class="tag warn">{sug} suggested</span>}
            {v.list('consolidated', c => c.id === a.id).length > 0 && <span class="tag">consolidated ✓</span>}</div></div></div>];
    })}</div>
  </main>;
}

// Side panel: timeline around dates mentioned + my earlier replies on similar points
function Lookups({ caseId, p, a }) {
  const v = useVault(); const app = useApp();
  const dates = datesIn(p.text + ' ' + (p.translation || ''));
  const evs = eventsOf(v, caseId);
  const near = dates.flatMap(d => evs.filter(e => { const x = parseDate(e.date); return x && x.from >= addDays(d, -3) && x.from <= addDays(d, 3); })).filter((e, i, arr) => arr.indexOf(e) === i).slice(0, 6);
  const related = useMemo(() => {
    const idx = new SearchIndex().build(buildItems(v, caseId).filter(i => i.type === 'My reply' || i.type === 'Consolidated response'));
    return idx;
  }, [v.version, caseId]);
  const [rel, setRel] = useState(null);
  if (rel === null) related.search(p.text.slice(0, 300), { caseId, limit: 4 }).then(r => setRel(r.filter(x => !(v.get('replies', x.ref)?.paraId === p.id))));
  if (!near.length && !(rel || []).length) return null;
  return <div class="side">
    {near.length > 0 && <div><b class="small">Timeline around {dates.map(formatDate).join(', ')}</b>
      {near.map(e => <div key={e.id} class="small" style="cursor:pointer" onClick={() => app.nav('case', caseId, 'ev', e.id)}>• <b>{formatDate(e.date)}</b> {e.title}{e.verified?.status === 'verified' ? ' ✓' : ''}</div>)}</div>}
    {(rel || []).length > 0 && <div style="margin-top:6px"><b class="small">Your earlier replies on similar points</b>
      {rel.map(x => { const r = v.get('replies', x.ref) || v.get('consolidated', x.ref); return r && <div key={x.id} class="small" style="margin:4px 0"><span class="mut">{x.type}:</span> {(r.text || '').slice(0, 220)}{(r.text || '').length > 220 ? '…' : ''}</div>; })}</div>}
  </div>;
}

export function AllegationPage({ caseId, alId }) {
  const app = useApp(); const v = useVault(); const a = v.get('allegations', alId);
  const [compose, setCompose] = useState(null); const [look, setLook] = useState({});
  if (!a) return <main><Empty>Allegation not found.</Empty></main>;
  const paras = (a.paraIds || []).map(id => v.get('paragraphs', id)).filter(Boolean)
    .map(p => ({ p, d: v.get('documents', p.docId) })).filter(x => x.d)
    .sort((x, y) => sortKey(x.d.date).localeCompare(sortKey(y.d.date)) || (x.p.order ?? 0) - (y.p.order ?? 0));
  const common = repliesFor(v, { allegationId: a.id, paraId: null });
  const cons = v.get('consolidated', a.id);
  const prog = allegationProgress(v, a);
  const allReplies = v.list('replies', r => r.allegationId === a.id && r.status === 'accepted');
  const stale = cons && allReplies.some(r => (r.updatedAt || r.createdAt || 0) > (cons.at || 0));
  return <main>
    <div class="card pad">
      <div class="mut small">A{a.n}{a.group ? ' · ' + a.group : ''}</div>
      <h2 style="margin:4px 0">{a.title}</h2>
      {a.brief && <p style="margin:4px 0"><b>Allegation in brief:</b> {a.brief}</p>}
      {a.myStand && <div class="small mut"><b>Your earlier stand on record:</b> {a.myStand}</div>}
      <div class="row" style="margin-top:6px"><span class={'tag ' + (prog.done === prog.total ? 'ok' : 'warn')}>{prog.done} of {prog.total} paragraphs answered</span>
        <button class="lnk" onClick={() => app.sheet.open(close => <Sheet title="Edit allegation" onClose={close}><AllegationForm caseId={caseId} a={a} onDone={close} /></Sheet>)}>Edit</button></div>
    </div>

    <div class="box acc">
      <div class="between"><b class="small">CONSOLIDATED RESPONSE</b>
        <button class="btn s" disabled={!allReplies.length} onClick={() => requestJob(app, 'consolidate', { allegationId: a.id })}>{cons ? 'Update' : 'Build from my replies'}</button></div>
      {cons ? <><PointLines text={cons.text} onChange={t => v.patch('consolidated', a.id, { text: t })} />
        <div class="tiny mut">{stale ? <span style="color:var(--warn)">⚠ You changed replies after this was built — tap Update.</span> : 'Built ' + new Date(cons.at).toLocaleString()}</div></>
        : <div class="small mut">{allReplies.length ? 'A short, high-impact summary of your answer to this allegation.' : 'Reply to at least one paragraph first.'}</div>}
    </div>

    <h3>Common reply <span class="tiny mut">— covers every paragraph below</span></h3>
    {common.map(r => <ReplyView r={r} key={r.id} />)}
    {compose === 'common' ? <ReplyComposer caseId={caseId} allegationId={a.id} paraId={null} onDone={() => setCompose(null)} />
      : <button class="btn g s" onClick={() => setCompose('common')}>{common.length ? '+ Add to common reply' : 'Write one reply for all paragraphs'}</button>}

    <h3>Paragraphs ({paras.length})</h3>
    {!paras.length && <Empty>No paragraphs linked yet.</Empty>}
    {paras.map(({ p, d }) => {
      const own = repliesFor(v, { paraId: p.id }); const st = paraStatus(v, p);
      return <div class="card pad" key={p.id} id={'ap-' + p.id}>
        <div class="between"><b class="small">{docCite(v, d, p.ref)}</b>
          <span class="row">{p.page && d.fileId && <button class="lnk" onClick={() => openPdf(app, d, p.page)}>page {p.page}</button>}
            <span class={'tag ' + (st === 'answered' || st === 'common' ? 'ok' : st === 'suggested' ? 'warn' : 'bad')}>{{ answered: 'answered', common: 'common reply', suggested: 'suggestion', open: 'not answered' }[st]}</span></span></div>
        <div class="quote">{p.text}</div>
        {p.translation && <div class="small" style="margin-top:4px"><span class="tag">English translation</span> {p.translation}</div>}
        {own.map(r => <ReplyView r={r} key={r.id} />)}
        <div class="row" style="margin-top:6px">
          {compose !== p.id && <button class="lnk" onClick={() => setCompose(p.id)}>{own.length ? '+ Another reply' : 'Reply to this paragraph'}</button>}
          {!own.length && <button class="lnk" onClick={() => requestJob(app, 'suggest', { paraIds: [p.id] })}>Suggest a reply</button>}
          <button class="lnk" onClick={() => setLook({ ...look, [p.id]: !look[p.id] })}>{look[p.id] ? 'Hide lookups' : 'Look up dates & earlier replies'}</button>
        </div>
        {look[p.id] && <Lookups caseId={caseId} p={p} a={a} />}
        {compose === p.id && <ReplyComposer caseId={caseId} allegationId={a.id} paraId={p.id} onDone={() => setCompose(null)} />}
      </div>;
    })}
  </main>;
}
