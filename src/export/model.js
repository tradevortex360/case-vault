// Builds the content of an export as simple blocks, shared by the PDF and Word writers.
import { parasOf, allegationsOf, needsReply, paraStatus, eventsOf, proceedingsOf, docsOf, upcoming, docName, docLabel, docLong, paraWord, partyRoles } from '../domain.js';
import { formatDate } from '../search/dates.js';

const today = () => formatDate(new Date().toISOString().slice(0, 10));
const lines = t => (t || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
const unclearIn = t => [...(t || '').matchAll(/\[unclear:\s*([^\]]+)\]/g)].map(m => m[1]);

// Export 1: my response to one document
export function documentResponse(v, docId, { order = 'paragraph', includeOriginal = true } = {}) {
  const d = v.get('documents', docId); const c = v.get('cases', d.caseId); const proc = d.proceedingId && v.get('proceedings', d.proceedingId);
  const ps = parasOf(v, d.id); const als = Object.fromEntries(allegationsOf(v, d.caseId).map(a => [a.id, a]));
  const docAls = [...new Set(ps.flatMap(p => p.allegationIds || []))].map(id => als[id]).filter(Boolean).sort((a, b) => a.n - b.n);
  const B = []; const clar = [];
  const long = docLong(v, d, formatDate);
  B.push({ t: 'title', text: needsReply(d) ? 'Para-wise reply' : 'Notes on document' });
  B.push({ t: 'sub', text: (needsReply(d) ? 'Reply to ' : 'On ') + long });
  B.push({ t: 'small', text: [proc?.title, 'Prepared by ' + partyRoles(v, d).me].filter(Boolean).join('. ') });
  B.push({ t: 'note', text: `Prepared on ${today()} from my own instructions with the help of an AI drafting tool. Working notes for my advocate — not a pleading. Facts and dates are as stated by me and should be verified before use.${includeOriginal && d.fileId ? ' Page references link to the original document attached at the end.' : ''}` });
  if (docAls.length) {
    B.push({ t: 'h2', text: 'Summary of my response' });
    for (const a of docAls) {
      const cons = v.get('consolidated', a.id);
      B.push({ t: 'h3', text: `A${a.n} · ${a.title}` });
      if (cons) B.push({ t: 'summary', lines: lines(cons.text) }); else B.push({ t: 'small', text: 'No consolidated response yet.' });
      lines(cons?.text).filter(l => /^check:/i.test(l)).forEach(l => clar.push({ where: `A${a.n}`, text: l }));
    }
  }
  B.push({ t: 'h2', text: order === 'allegation' ? 'Paragraph-wise, grouped by allegation' : 'Paragraph-wise response' });
  const paraBlock = p => {
    const link = includeOriginal && d.fileId && p.page ? { anx: 'A', page: p.page } : null;
    B.push({ t: 'h3', text: paraWord(p.ref).replace(/^p/, 'P'), link, linkText: p.page ? `page ${p.page}` : null });
    B.push({ t: 'quote', text: p.text, lang: p.lang });
    if (p.translation) B.push({ t: 'quote', text: 'English translation: ' + p.translation });
    if (!needsReply(d)) return;
    const own = v.list('replies', r => r.paraId === p.id && r.status === 'accepted');
    own.forEach(r => { B.push({ t: 'reply', label: 'MY REPLY', lines: lines(r.text) }); unclearIn(r.text).forEach(u => clar.push({ where: paraWord(p.ref), text: 'Unclear: ' + u })); });
    if (!own.length) {
      const commons = (p.allegationIds || []).flatMap(aid => v.list('replies', r => r.allegationId === aid && !r.paraId && r.status === 'accepted').map(r => ({ r, a: als[aid] })));
      if (commons.length) commons.forEach(({ r, a }) => B.push({ t: 'reply', label: `COVERED BY MY COMMON REPLY ON A${a?.n} · ${a?.title}`, lines: lines(r.text) }));
      else B.push({ t: 'warn', text: paraStatus(v, p) === 'suggested' ? 'Not answered yet (a suggested reply is waiting for review).' : 'Not answered yet.' });
    }
  };
  if (order === 'allegation') {
    const done = new Set();
    for (const a of docAls) { B.push({ t: 'h2s', text: `A${a.n} · ${a.title}` }); ps.filter(p => (p.allegationIds || []).includes(a.id)).forEach(p => { done.add(p.id); paraBlock(p); }); }
    const rest = ps.filter(p => !done.has(p.id)); if (rest.length) { B.push({ t: 'h2s', text: 'Other paragraphs' }); rest.forEach(paraBlock); }
  } else ps.forEach(paraBlock);
  const ver = v.list('verifications', x => x.caseId === d.caseId && x.status !== 'resolved' && (x.variants || []).some(vr => (vr.sources || []).some(s => s.docId === d.id)));
  ver.forEach(x => clar.push({ where: 'For verification', text: `${x.title}: ${(x.variants || []).map(vr => vr.value).join(' vs ')}` }));
  if (clar.length) { B.push({ t: 'h2', text: 'Points to verify or clarify' }); clar.forEach(c2 => B.push({ t: 'bullet', text: `${c2.where} — ${c2.text}` })); }
  const annexures = includeOriginal && d.fileId ? [{ label: 'A', title: docLabel(v, d), fileId: d.fileId }] : [];
  return { title: `Reply — ${docLabel(v, d)}`, footer: `${docLabel(v, d)} — privileged & confidential`, blocks: B, annexures };
}

// Export 2: the whole case story
export function caseStory(v, caseId, length = 'full') {
  const c = v.get('cases', caseId); const B = [];
  const story = v.get('stories', caseId + '-' + length);
  B.push({ t: 'title', text: length === 'snapshot' ? 'Case snapshot' : 'Case brief' });
  B.push({ t: 'sub', text: c.name });
  B.push({ t: 'small', text: [c.opponent && 'Other side: ' + c.opponent, c.myRole && 'Me: ' + c.myRole, 'Prepared ' + today()].filter(Boolean).join(' · ') });
  if (story) {
    B.push({ t: 'note', text: `Written by Claude from the case vault on ${new Date(story.at).toLocaleDateString()}. Verify facts before relying on them.` });
    for (const l of lines(story.text)) {
      if (/^#{1,3}\s/.test(l)) B.push({ t: 'h2', text: l.replace(/^#+\s*/, '') });
      else if (/^\d\.\s+[A-Z][^.]{2,60}$/.test(l)) B.push({ t: 'h2', text: l.replace(/^\d\.\s*/, '') });
      else if (/^[-•*]\s/.test(l)) B.push({ t: 'bullet', text: l.replace(/^[-•*]\s*/, '').replace(/\*\*/g, '') });
      else B.push({ t: 'p', text: l.replace(/\*\*/g, '') });
    }
    return { title: (length === 'snapshot' ? 'Snapshot — ' : 'Case brief — ') + c.name, footer: c.name + ' · Privileged & confidential', blocks: B, annexures: [] };
  }
  B.push({ t: 'note', text: 'Structured chronology generated on this device. For a written narrative, use "Write with Claude".' });
  B.push({ t: 'h2', text: 'Proceedings' });
  const up = upcoming(v, caseId);
  proceedingsOf(v, caseId).forEach(p => B.push({ t: 'bullet', text: `${p.number}${p.title ? ' — ' + p.title : ''}${p.court ? ' · ' + p.court : ''} · ${p.status || ''}` }));
  if (up.hearings[0]) B.push({ t: 'p', text: 'Next date: ' + formatDate(up.hearings[0].date) });
  B.push({ t: 'h2', text: 'Chronology' });
  const evs = eventsOf(v, caseId); const docs = docsOf(v, caseId);
  for (const e of evs) B.push({ t: 'event', date: formatDate(e.date), text: e.title + (e.verified?.status === 'verified' ? ' ✓' : ''), sub: e.account === 'theirs' ? 'their account' : e.account === 'both' ? 'versions differ' : '' });
  if (length !== 'snapshot') {
    B.push({ t: 'h2', text: 'My response, allegation by allegation' });
    for (const a of allegationsOf(v, caseId)) { const cons = v.get('consolidated', a.id); B.push({ t: 'h3', text: `A${a.n} · ${a.title}` }); B.push(cons ? { t: 'summary', lines: lines(cons.text) } : { t: 'small', text: 'Not summarised yet.' }); }
  }
  const openVer = v.list('verifications', x => x.caseId === caseId && x.status !== 'resolved');
  const unans = docs.filter(needsReply).reduce((n, d) => n + parasOf(v, d.id).filter(p => paraStatus(v, p) === 'open').length, 0);
  B.push({ t: 'h2', text: 'Where things stand' });
  B.push({ t: 'bullet', text: `${openVer.length} point(s) awaiting verification${openVer.length ? ': ' + openVer.map(x => x.title).join('; ') : ''}` });
  B.push({ t: 'bullet', text: `${unans} paragraph(s) filed against me not yet answered` });
  up.deadlines.slice(0, 5).forEach(dl => B.push({ t: 'bullet', text: `Deadline ${formatDate(dl.due)}: ${dl.what}` }));
  return { title: (length === 'snapshot' ? 'Snapshot — ' : 'Case brief — ') + c.name, footer: c.name + ' · Privileged & confidential', blocks: B, annexures: [] };
}
