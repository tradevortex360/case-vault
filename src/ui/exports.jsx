import { h } from 'preact';
import { useState } from 'preact/hooks';
import { useApp, useVault, Empty } from './core.jsx';
import { docsOf, needsReply, parasOf, paraStatus, docLabel } from '../domain.js';
import { documentResponse, caseStory } from '../export/model.js';
import { formatDate, formatWhen } from '../search/dates.js';
import { requestJob, canRunNow } from '../claude/jobs.js';

async function fontBytes(name) { const r = await fetch(import.meta.env.BASE_URL + 'fonts/' + name); if (!r.ok) throw new Error('font'); return new Uint8Array(await r.arrayBuffer()); }

export async function saveBlob(app, blob, name) {
  let got = false;
  const dl = app.claude?.downloads;
  if (dl?.save) { try { await dl.save({ filename: name, data: blob }); got = true; } catch { /* declined or failed */ } }
  if (!got && !app.inClaude) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); got = true; }
  // also keep a copy in Drive → Legal/exports so it can be shared with the lawyer from the phone
  let drive = false;
  if (app.v.adapter?.upload) { try { await app.v.adapter.upload(name, blob, 'exports'); drive = true; } catch { } }
  return got && drive ? 'downloaded and saved to Drive' : drive ? 'saved to Drive' : got ? 'downloaded' : 'not saved';
}

const MSG = { 'downloaded and saved to Drive': 'Downloaded · copy in Drive → Legal → exports', 'saved to Drive': 'Saved to Drive → Legal → exports', downloaded: 'Downloaded', 'not saved': 'Could not save the file here' };
export async function makeExport(app, model, kind) {
  if (kind === 'docx') { const { buildDocx } = await import('../export/docx.js'); return buildDocx(model); }
  const { buildPdf, canvasRenderer } = await import('../export/pdf.js');
  const fonts = { regular: await fontBytes('Carlito-Regular.ttf'), bold: await fontBytes('Carlito-Bold.ttf'), italic: await fontBytes('Carlito-Italic.ttf') };
  const bytes = await buildPdf(model, { fonts, renderComplex: canvasRenderer(), loadAnnexure: async id => { const b = await app.v.file(id); return b ? new Uint8Array(await b.arrayBuffer()) : null; } });
  return new Blob([bytes], { type: 'application/pdf' });
}

export function Exports({ caseId }) {
  const app = useApp(); const v = useVault();
  const docs = docsOf(v, caseId).filter(needsReply);
  const pre = app.path[3];
  const [docId, setDocId] = useState(pre && docs.some(d => d.id === pre) ? pre : docs[docs.length - 1]?.id || '');
  const [order, setOrder] = useState('paragraph'); const [orig, setOrig] = useState(true);
  const [len, setLen] = useState('full'); const [busy, setBusy] = useState('');
  const c = v.get('cases', caseId); const story = v.get('stories', caseId + '-' + len);
  const go = async (what, kind) => {
    setBusy(what + kind);
    try {
      const model = what === 'doc' ? documentResponse(v, docId, { order, includeOriginal: orig && kind === 'pdf' }) : caseStory(v, caseId, len);
      const blob = await makeExport(app, model, kind);
      const base = (what === 'doc' ? 'Reply - ' + docLabel(v, v.get('documents', docId)) : (len === 'snapshot' ? 'Snapshot - ' : 'Case brief - ') + c.name).replace(/[\\/:*?"<>|]+/g, '-');
      const where = await saveBlob(app, blob, `${base} (${new Date().toISOString().slice(0, 10)}).${kind}`);
      app.toast(MSG[where]);
    } catch (e) { app.toast('Export failed: ' + (e.message || e), 6000); console.error(e); }
    setBusy('');
  };
  const d = docs.find(x => x.id === docId);
  const stats = d ? (() => { const ps = parasOf(v, d.id); const st = ps.map(p => paraStatus(v, p)); return { t: ps.length, done: st.filter(s => s === 'answered' || s === 'common').length }; })() : null;
  return <main>
    <h2 style="margin:4px 0">Export for your lawyer</h2>
    <div class="card pad">
      <h3 style="margin-top:0">Reply to one document</h3>
      {!docs.length ? <Empty>No documents filed against you yet.</Empty> : <>
        <select value={docId} onChange={e => setDocId(e.currentTarget.value)}>{docs.map(x => <option value={x.id}>{docLabel(v, x)} ({formatDate(x.date)})</option>)}</select>
        {stats && <div class="small mut" style="margin-top:4px">{stats.done} of {stats.t} paragraphs answered{stats.done < stats.t ? ' — unanswered ones are marked "Not answered yet"' : ''}.</div>}
        <div class="row small" style="margin:8px 0"><span class={'chip' + (order === 'paragraph' ? ' on' : '')} onClick={() => setOrder('paragraph')}>In paragraph order</span><span class={'chip' + (order === 'allegation' ? ' on' : '')} onClick={() => setOrder('allegation')}>Grouped by allegation</span>
          <label class="row" style="gap:4px"><input type="checkbox" checked={orig} onChange={() => setOrig(!orig)} /> attach original with page links (PDF)</label></div>
        <div class="row"><button class="btn" disabled={!!busy} onClick={() => go('doc', 'pdf')}>{busy === 'docpdf' ? 'Making PDF…' : 'PDF'}</button><button class="btn g" disabled={!!busy} onClick={() => go('doc', 'docx')}>{busy === 'docdocx' ? 'Making Word…' : 'Word'}</button></div></>}
    </div>
    <div class="card pad">
      <h3 style="margin-top:0">The whole case story</h3>
      <div class="small mut">For a new lawyer, or to refresh your current one: parties and proceedings, the story in date order with your response in brief, your main lines of defence, and where things stand.</div>
      <div class="row" style="margin:8px 0"><span class={'chip' + (len === 'snapshot' ? ' on' : '')} onClick={() => setLen('snapshot')}>One-page snapshot</span><span class={'chip' + (len === 'full' ? ' on' : '')} onClick={() => setLen('full')}>Full brief</span></div>
      <div class="small">{story ? <>✓ Written narrative from {formatWhen(story.at)}.</> : <span class="mut">No written narrative yet — the export will be a structured chronology (works offline).</span>}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn g" onClick={() => requestJob(app, 'story', { caseId, length: len })}>{story ? 'Rewrite with Claude' : 'Write with Claude'}</button>
        <button class="btn" disabled={!!busy} onClick={() => go('story', 'pdf')}>{busy === 'storypdf' ? 'Making PDF…' : 'PDF'}</button><button class="btn g" disabled={!!busy} onClick={() => go('story', 'docx')}>{busy === 'storydocx' ? 'Making Word…' : 'Word'}</button></div>
      {!canRunNow(app) && <div class="tiny mut" style="margin-top:4px">Writing the narrative needs Claude; it is queued and appears here after the next run.</div>}
      {story && <details style="margin-top:8px"><summary class="small">Read the narrative</summary><div class="small" style="white-space:pre-wrap;margin-top:6px">{story.text}</div></details>}
    </div>
    <div class="small mut">Files are downloaded{v.adapter?.upload ? ' and a copy is saved in Drive → Legal → exports, so you can share it with your lawyer from the phone' : ''}.</div>
  </main>;
}
