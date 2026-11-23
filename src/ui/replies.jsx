import { h } from 'preact';
import { useState } from 'preact/hooks';
import { useApp, useVault, PointLines, TextBox, confirmBox, Sheet } from './core.jsx';
import { requestJob, canRunNow } from '../claude/jobs.js';
import { docCite } from '../domain.js';

// Composer for a para-wise reply (paraId) or a common reply (paraId = null)
export function ReplyComposer({ caseId, allegationId, paraId, onDone, initial = '' }) {
  const app = useApp(); const v = app.v;
  const [text, setText] = useState(initial); const [busy, setBusy] = useState(false);
  const live = canRunNow(app);
  const save = async (polish) => {
    const t = text.trim(); if (!t) return app.toast('Speak or type your reply first');
    setBusy(true);
    const id = await v.put('replies', { caseId, allegationId: allegationId || null, paraId: paraId || null, text: t, orig: t, status: 'accepted', origin: 'me', toPolish: !!polish, createdAt: Date.now(), updatedAt: Date.now() });
    if (polish) await requestJob(app, 'polish', { replyId: id });
    setBusy(false); setText(''); onDone?.(id);
  };
  return <div class="box acc" style="margin-top:8px">
    <TextBox value={text} rows={3} placeholder={paraId ? 'Your reply to this paragraph — speak or type in Bengali, Hindi or English' : 'One reply for every paragraph under this allegation'} onInput={setText} />
    <div class="row" style="margin-top:6px">
      <button class="btn" disabled={busy} onClick={() => save(true)}>{busy ? 'Working…' : live ? 'Save & polish' : 'Save (polish later)'}</button>
      <button class="btn g" disabled={busy} onClick={() => save(false)}>Save as written</button>
      {onDone && <button class="lnk" onClick={() => onDone(null)}>Cancel</button>}
    </div>
    {!live && <div class="tiny mut" style="margin-top:4px">Polishing into court English needs Claude. Your reply is saved now and polished at the next Claude run.</div>}
  </div>;
}

export function ReplyView({ r, compact }) {
  const app = useApp(); const v = useVault();
  const [edit, setEdit] = useState(false); const [txt, setTxt] = useState(r.text);
  const sug = r.status === 'suggested';
  const docs = (id) => v.get('documents', id);
  const setText = t => v.patch('replies', r.id, { text: t, updatedAt: Date.now() });
  const sources = r.sources || [];
  return <div class={'reply' + (sug ? ' sug' : '')} id={'r-' + r.id}>
    <div class="between tiny" style="font-weight:600;color:var(--mut)">
      <span>{sug ? '✨ SUGGESTED BY CLAUDE — review' : r.paraId ? 'YOUR REPLY' : 'COMMON REPLY'}{r.toPolish ? ' · waiting to be polished' : ''}</span>
    </div>
    {r._conflicts?.length > 0 && <div class="box bad small"><b>Edited on two devices at once.</b> Choose which version to keep:
      {[{ value: r.text, label: 'Current' }, ...r._conflicts.filter(c => c.field === 'text').map(c => ({ value: c.value, label: 'From ' + c.device.split('-')[0] }))].map((o, i) =>
        <div key={i} class="card pad" style="margin:6px 0"><div class="tiny mut">{o.label}</div><div style="white-space:pre-wrap">{o.value}</div>
          <button class="btn s" style="margin-top:4px" onClick={() => v.patch('replies', r.id, { text: o.value, _conflicts: null })}>Keep this</button></div>)}</div>}
    {edit ? <div><TextBox value={txt} rows={5} onInput={setTxt} /><div class="row" style="margin-top:4px"><button class="btn s" onClick={async () => { await setText(txt); if (sug) await v.patch('replies', r.id, { status: 'accepted' }); setEdit(false); }}>{sug ? 'Save & accept' : 'Save'}</button><button class="lnk" onClick={() => setEdit(false)}>Cancel</button></div></div>
      : <PointLines text={r.text} onChange={setText} />}
    {!compact && r.orig && r.orig !== r.text && <details class="small mut" style="margin-top:4px"><summary>You said</summary><div style="white-space:pre-wrap">{r.orig}</div></details>}
    {sug && sources.length > 0 && <div class="small" style="margin-top:6px"><b>Based on:</b>{sources.map((s, i) => <div key={i} class="src">• {s.label}{s.docId && docs(s.docId) ? ` (${docCite(app.v, docs(s.docId), s.ref)})` : ''}</div>)}</div>}
    {sug && /needs your input/i.test(r.text) && <div class="tiny" style="color:var(--warn)">Parts marked “Needs your input” are things you have never answered before — fill them in.</div>}
    <div class="row" style="margin-top:6px">
      {sug && <button class="btn s ok" onClick={() => v.patch('replies', r.id, { status: 'accepted', acceptedAt: Date.now() })}>✓ Accept</button>}
      {!edit && <button class="lnk" onClick={() => { setTxt(r.text); setEdit(true); }}>{sug ? 'Edit, then accept' : 'Edit'}</button>}
      <button class="lnk" onClick={() => requestJob(app, 'polish', { replyId: r.id, fromOriginal: true })}>{sug ? 'Draft again' : 'Polish again'}</button>
      {sug ? <button class="lnk bad" onClick={() => v.patch('replies', r.id, { status: 'rejected' })}>✕ Reject</button>
        : <button class="lnk bad" onClick={async () => { if (await confirmBox(app, 'Delete this reply?', 'Delete', true)) v.del('replies', r.id); }}>Delete</button>}
    </div>
  </div>;
}
