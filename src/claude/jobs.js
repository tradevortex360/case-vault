// Claude jobs: run now when the app is open inside Claude (sample capability = your plan, no API),
// otherwise queue for the scheduled cloud task. Every job ends as a result merged by merge.js.
import { applyResult } from './merge.js';
import { polishPrompt, suggestPrompt, consolidatePrompt, storyPrompt, extractPrompt } from './prompts.js';
import { SearchIndex, buildItems } from '../search/index.js';
import { parasOf, paraStatus, allegationsOf, proceedingsOf, eventsOf, docsOf, needsReply, docCite, paraWord } from '../domain.js';
import { formatDate } from '../search/dates.js';
import { toJSON } from '../store/ops.js';

export const canRunNow = app => !!(app.inClaude && app.claude?.sample);
const LABEL = { polish: 'Polishing', suggest: 'Drafting suggestions', consolidate: 'Building consolidated response', story: 'Writing the case story', process_inbox: 'Reading new documents' };

export async function requestJob(app, type, params = {}) {
  const v = app.v;
  if (canRunNow(app)) {
    app.toast((LABEL[type] || 'Working') + '…', 60000);
    try { const n = await runJob(app, { type, params }); app.toast(n === 0 && type === 'process_inbox' ? 'No new documents in the inbox' : n === 0 && type === 'suggest' ? 'Nothing left to suggest — every paragraph already has a reply' : 'Done'); return true; }
    catch (e) { app.toast('Claude could not finish: ' + (e.message || e.code || e) + ' — queued for later', 6000); }
  }
  const id = await v.put('jobs', { type, params, status: 'queued', requestedAt: Date.now(), device: v.device });
  if (v.adapter?.writeText) v.adapter.writeText(`job-${id}.json`, JSON.stringify({ id, type, params, requestedAt: Date.now() }), 'vault/jobs').catch(() => {});
  if (!canRunNow(app)) app.toast('Queued for Claude. It runs at the next scheduled run, or tap Update vault inside Claude.', 4500);
  return false;
}

export async function runQueuedJobs(app, { includeInbox } = {}) {
  const v = app.v; let n = 0;
  if (includeInbox) { app.toast('Checking the inbox…', 60000); n += await runJob(app, { type: 'process_inbox', params: {} }).catch(e => { app.toast('Inbox: ' + (e.message || e), 6000); return 0; }); }
  for (const j of v.list('jobs', j => j.status === 'queued')) {
    try { await runJob(app, j); await v.patch('jobs', j.id, { status: 'done', doneAt: Date.now() }); n++; }
    catch (e) { await v.patch('jobs', j.id, { lastError: String(e.message || e) }); }
  }
  app.toast(n ? `Vault updated (${n} item${n > 1 ? 's' : ''})` : 'Vault is up to date');
}

async function ask(app, prompt, opts = {}) {
  const s = app.claude.sample;
  if (opts.json) return s.json(prompt, { modelTier: opts.tier || 'default', images: opts.images });
  const r = await s(prompt, { modelTier: opts.tier || 'default', images: opts.images });
  return (r.text || '').trim();
}

export async function runJob(app, job) {
  const v = app.v; const p = job.params || {}; const at = Date.now();
  switch (job.type) {
    case 'polish': {
      const r = v.get('replies', p.replyId); if (!r) return 0;
      if (r.status === 'suggested') return runJob(app, { type: 'suggest', params: { paraIds: [r.paraId], redo: true } });
      const text = await ask(app, polishPrompt(v, p.fromOriginal ? r : { ...r, orig: r.orig || r.text }));
      return applyResult(v, { type: 'polish', replyId: r.id, text, at });
    }
    case 'suggest': return suggest(app, p, at);
    case 'consolidate': {
      const a = v.get('allegations', p.allegationId);
      const reps = v.list('replies', r => r.allegationId === a.id && r.status === 'accepted').map(r => {
        const pr = r.paraId && v.get('paragraphs', r.paraId); const d = pr && v.get('documents', pr.docId);
        return { label: pr ? docCite(v, d, pr.ref) : 'common reply', text: r.text };
      });
      if (!reps.length) throw new Error('No replies yet');
      const text = await ask(app, consolidatePrompt(v, a, reps));
      return applyResult(v, { type: 'consolidate', caseId: a.caseId, allegationId: a.id, text, at, from: reps.length });
    }
    case 'story': {
      const text = await ask(app, storyPrompt(v, p.caseId, p.length, storyData(v, p.caseId)), { tier: 'complex' });
      return applyResult(v, { type: 'story', caseId: p.caseId, length: p.length, text, at });
    }
    case 'process_inbox': return processInbox(app, p);
    default: throw new Error('Unknown job ' + job.type);
  }
}

// ---------- suggestions ----------
function contextFor(v, caseId, paras) {
  const items = buildItems(v, caseId).filter(i => ['My reply', 'Consolidated response', 'Event', 'Paragraph'].includes(i.type));
  const docs = Object.fromEntries(v.list('documents').map(d => [d.id, d]));
  const usable = items.filter(i => i.type !== 'Paragraph' || docs[i.docId]?.filedBy === 'me').filter(i => i.type !== 'Event' || v.get('events', i.ref)?.verified?.status === 'verified' || v.get('events', i.ref)?.account === 'mine');
  const idx = new SearchIndex().build(usable);
  const pick = new Map();
  return Promise.all(paras.map(p => idx.search(p.text.slice(0, 400), { caseId, limit: 6 }))).then(rs => {
    rs.flat().forEach(r => pick.set(r.id, r));
    // all accepted replies on the same allegations are always included
    for (const p of paras) for (const aid of p.allegationIds || []) v.list('replies', r => r.allegationId === aid && r.status === 'accepted').forEach(r => pick.set('re:' + r.id, { id: 're:' + r.id, type: 'My reply', ref: r.id, text: r.text }));
    return [...pick.values()].slice(0, 40).map((r, i) => {
      const key = 'k' + (i + 1);
      let label = r.type;
      if (r.type === 'My reply') { const rr = v.get('replies', r.ref); const pr = rr?.paraId && v.get('paragraphs', rr.paraId); const d = pr && docs[pr.docId]; label = pr ? `your reply to ${docCite(v, d, pr.ref)}` : 'your common reply'; }
      if (r.type === 'Event') label = `timeline ${formatDate(r.date)}${r.verified ? ' ✓ verified' : ''}`;
      if (r.type === 'Paragraph') label = `your filing: ${r.title}`;
      if (r.type === 'Consolidated response') label = 'your consolidated response';
      return { key, label, text: r.text.slice(0, 700), docId: r.docId };
    });
  });
}
async function suggest(app, p, at) {
  const v = app.v;
  let paras = p.paraIds ? p.paraIds.map(id => v.get('paragraphs', id)).filter(Boolean) : parasOf(v, p.docId);
  // explicit request on a paragraph covered only by a common reply is still honoured
  paras = paras.filter(x => { const st = paraStatus(v, x); return p.redo || st === 'open' || (p.paraIds && st === 'common'); });
  if (!paras.length) return 0;
  const d0 = v.get('documents', paras[0].docId); const caseId = d0.caseId;
  const als = Object.fromEntries(allegationsOf(v, caseId).map(a => [a.id, a]));
  let n = 0;
  for (let i = 0; i < paras.length; i += 6) {
    const chunk = paras.slice(i, i + 6).map(x => { const d = v.get('documents', x.docId); return { id: x.id, text: x.translation || x.text, docLabel: docCite(v, d), ref: paraWord(x.ref), allegationIds: x.allegationIds, allegation: (x.allegationIds || []).map(a => als[a]?.title).filter(Boolean).join('; ') }; });
    const ctx = await contextFor(v, caseId, chunk);
    const out = await ask(app, suggestPrompt(v, caseId, chunk, ctx), { json: true });
    const byKey = Object.fromEntries(ctx.map(c => [c.key, c]));
    const suggestions = (out?.suggestions || []).filter(s => chunk.some(c => c.id === s.paraId)).map(s => ({ paraId: s.paraId, text: s.text, sources: (s.sources || []).map(k => byKey[k]).filter(Boolean).map(c => ({ label: c.label, docId: c.docId || null })) }));
    if (p.redo) for (const s of suggestions) { const old = v.get('replies', 'sg-' + s.paraId); if (old) await v.del('replies', old.id); }
    n += await applyResult(v, { type: 'suggest', caseId, suggestions, at });
  }
  return n;
}

// ---------- case story data ----------
export function storyData(v, caseId) {
  const procs = proceedingsOf(v, caseId).map(p => ({ number: p.number, title: p.title, court: p.court, status: p.status }));
  const events = eventsOf(v, caseId).map(e => ({ date: formatDate(e.date), title: e.title, account: e.account, verified: e.verified?.status === 'verified' }));
  const responses = allegationsOf(v, caseId).map(a => ({ allegation: a.title, consolidated: v.get('consolidated', a.id)?.text || null }));
  const filings = docsOf(v, caseId).map(d => ({ date: formatDate(d.date), title: d.title, filedBy: d.filedBy, summary: d.summary || '' }));
  const hearings = v.list('hearings', h => h.caseId === caseId).map(h => ({ date: formatDate(h.date), outcome: h.outcome, next: formatDate(h.nextDate) }));
  const openVer = v.list('verifications', x => x.caseId === caseId && x.status !== 'resolved').map(x => x.title);
  const unanswered = docsOf(v, caseId).filter(needsReply).flatMap(d => parasOf(v, d.id).filter(p => paraStatus(v, p) === 'open').map(p => docCite(v, d, p.ref)));
  return { case: v.get('cases', caseId)?.name, procs, filings, events, responses, hearings, openVerification: openVer, unanswered };
}

// ---------- reading new PDFs from the Drive inbox (urgent path, inside Claude) ----------
async function renderPages(blob, from, to) {
  const lib = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url'); lib.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const out = [];
  for (let i = from; i <= Math.min(to, doc.numPages); i++) {
    const pg = await doc.getPage(i); const vp = pg.getViewport({ scale: 1.5 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    out.push(await new Promise(r => c.toBlob(r, 'image/jpeg', 0.72)));
  }
  return { images: out, total: doc.numPages };
}
export function mergeChunks(chunks) {
  const out = { document: {}, paragraphs: [], events: [], allegations: [], verifications: [], directions: [] };
  for (const c of chunks) {
    for (const [k, val] of Object.entries(c.document || {})) if (val && (typeof val !== 'object' || Object.values(val).some(Boolean)) && !out.document[k]) out.document[k] = val;
    out.paragraphs.push(...(c.paragraphs || [])); out.events.push(...(c.events || [])); out.verifications.push(...(c.verifications || [])); out.directions.push(...(c.directions || []));
    for (const a of c.allegations || []) { const m = out.allegations.find(x => (a.existingId && x.existingId === a.existingId) || x.title.toLowerCase() === a.title.toLowerCase()); if (m) m.paraRefs = [...new Set([...m.paraRefs, ...(a.paraRefs || [])])]; else out.allegations.push({ ...a, paraRefs: [...(a.paraRefs || [])] }); }
    if (c.nextDate && !out.nextDate) { out.nextDate = c.nextDate; out.nextPurpose = c.nextPurpose; }
    if (c.caseId && !out.caseId) out.caseId = c.caseId;
  }
  // a paragraph cut across two chunks appears twice with the same ref: keep the longer text
  const seen = new Map(); for (const p of out.paragraphs) { const k = p.ref; if (!seen.has(k) || (p.text || '').length > (seen.get(k).text || '').length) seen.set(k, p); }
  out.paragraphs = [...seen.values()];
  return out;
}
async function processInbox(app, p) {
  const v = app.v; const a = v.adapter;
  if (!a?.listFolder || !a?.readBlob) throw new Error('Google Drive is not connected on this device');
  const files = (await a.listFolder('inbox')).filter(f => /pdf$/i.test(f.name) || /pdf/.test(f.mimeType || ''));
  const done = new Set(v.list('documents').map(d => d.fileId));
  const fresh = files.filter(f => !done.has(f.id));
  const cases = v.list('cases', c => !c.archived);
  let n = 0;
  for (const f of fresh) {
    app.toast(`Reading ${f.name}…`, 120000);
    const blob = await a.readBlob(f.id); await v.cacheFile(f.id, blob);
    const first = await renderPages(blob, 1, 4);
    const caseId = cases.length === 1 ? cases[0].id : null;
    const chunks = [];
    for (let s = 1; s <= first.total; s += 4) {
      const imgs = s === 1 ? first.images : (await renderPages(blob, s, s + 3)).images;
      const prompt = extractPrompt(v, caseId || cases[0]?.id, f.name, s, Math.min(s + 3, first.total), first.total) + (caseId ? '' : `\nAlso return "caseId": one of ${cases.map(c => `${c.id} (${c.name})`).join(', ')} — or "ask" if unsure.`);
      chunks.push(await ask(app, prompt, { json: true, images: imgs }));
      app.toast(`Reading ${f.name}: page ${Math.min(s + 3, first.total)} of ${first.total}`, 120000);
    }
    const merged = mergeChunks(chunks);
    const target = caseId || (cases.some(c => c.id === merged.caseId) ? merged.caseId : null);
    const result = { type: 'extract', fileId: f.id, fileName: f.name, caseId: target, ...merged, at: Date.now() };
    if (!target) { await v.put('jobs', { type: 'choose_case', status: 'needs_you', result, requestedAt: Date.now() }); continue; }
    await applyResult(v, result); n++;
    const docId = 'd-' + String(f.id).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
    if (v.get('documents', docId)?.filedBy === 'opponent') await suggest(app, { docId }, Date.now()).catch(() => {});
  }
  return n;
}

// ---------- results written by the scheduled cloud task ----------
export async function mergeRemoteResults(v) {
  const a = v.adapter; if (!a?.listFolder) return 0;
  // "patch-*.json" files are tracked separately, so a copy of the app that didn't know patches yet can't have used them up
  const seen = new Set((await v.setting('seenResults')) || []); const seenP = new Set((await v.setting('seenPatches')) || []);
  const isP = f => f.name.startsWith('patch-');
  const files = (await a.listFolder('vault/results')).filter(f => f.name.endsWith('.json') && !(isP(f) ? seenP : seen).has(f.name)).sort((x, y) => x.name.localeCompare(y.name));
  let n = 0;
  for (const f of files) {
    let text; try { text = await a.readText(f); } catch (e) { throw e; } // network/sign-in problem: retry on the next sync
    try { const r = JSON.parse(text); for (const one of (Array.isArray(r) ? r : [r])) { if (one.type === 'extract' && !one.caseId && v.list('cases').length > 1) await v.put('jobs', { type: 'choose_case', status: 'needs_you', result: one }); else n += await applyResult(v, one); } }
    catch (e) { console.warn('result', f.name, e); }
    (isP(f) ? seenP : seen).add(f.name);
  }
  await v.setting('seenResults', [...seen]); await v.setting('seenPatches', [...seenP]);
  return n;
}
export async function writeStateForClaude(v) {
  const a = v.adapter; if (!a?.replaceText) return;
  const last = (await v.setting('stateWrittenAt')) || 0; if (Date.now() - last < 10 * 60 * 1000) return;
  const s = toJSON(v.state); delete s.jobs;
  await a.replaceText('state.json', JSON.stringify({ writtenAt: Date.now(), state: s }), 'vault');
  await v.setting('stateWrittenAt', Date.now());
}
