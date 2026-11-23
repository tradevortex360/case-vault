// Instructions Claude follows for each job. The same rules are written into
// README-for-Claude.md so the scheduled cloud task behaves identically.
import { formatDate } from '../search/dates.js';

export const STYLE = `Write in formal, court-appropriate English, third person: "the Respondent No. 1", "the Petitioner" (use the roles given in the case context). At most 3 numbered points (1., 2., 3.), each on its own line, one or two crisp sentences each, fewer if fewer real points exist. One idea = one point; merge overlaps. Keep every name, date, amount, place, document and case number exactly. Never invent facts, dates, documents or witnesses; never strengthen or soften. No boilerplate ("craves leave", "reserves the right"), no general denials, no legal argument the person did not make. Only if a document, recording, message or witness is actually mentioned, end with "Supporting material: …". Mark anything unclear as [unclear: …].`;

export function caseContext(v, caseId) {
  const c = v.get('cases', caseId) || {};
  return `Case: ${c.name || ''}. ${c.myRole ? 'The user is ' + c.myRole + '. ' : ''}${c.opponent ? 'Other side: ' + c.opponent + '. ' : ''}${c.description || ''}`;
}

export function polishPrompt(v, r) {
  const p = r.paraId && v.get('paragraphs', r.paraId); const a = r.allegationId && v.get('allegations', r.allegationId); const d = p && v.get('documents', p.docId);
  return `You turn a litigant's dictated note into a polished reply for an Indian court file.
${caseContext(v, r.caseId)}
${a ? `Allegation: ${a.title}${a.brief ? ' — ' + a.brief : ''}` : ''}
${p ? `Paragraph being answered (${d?.short || d?.title || ''} ${p.ref}): "${p.text}"` : r.paraId ? '' : 'This is a COMMON reply covering every paragraph of the allegation.'}
The note may be Bengali, Hindi, Banglish/Hinglish or English, informal, with speech-recognition errors.
${STYLE}
Output only the reply text.

NOTE:
${r.orig || r.text}`;
}

export function suggestPrompt(v, caseId, paras, context) {
  return `You draft suggested replies for an Indian litigant, using ONLY what he has already said or verified. He will review each draft.
${caseContext(v, caseId)}

HIS EARLIER REPLIES, VERIFIED FACTS AND OWN FILINGS (each has a [key]):
${context.map(c => `[${c.key}] (${c.label}) ${c.text}`).join('\n')}

PARAGRAPHS TO ANSWER:
${paras.map(p => `{${p.id}} ${p.docLabel} ${p.ref} — allegation: ${p.allegation || 'n/a'}\n"${p.text}"`).join('\n\n')}

For each paragraph write a reply in his style. ${STYLE}
Use only the material above; cite the [key]s you used. If the paragraph raises something he has never answered, write that part as "Needs your input: <what is missing>" instead of guessing. If two sources conflict, prefer the verified fact or the newer reply.
Return JSON only: {"suggestions":[{"paraId":"…","text":"…","sources":["key", …]}]}`;
}

export function consolidatePrompt(v, a, replies) {
  return `Write a BRIEF, HIGH-IMPACT consolidated response to one allegation — what the judge should take away in 20 seconds. It must condense, never expand.
${caseContext(v, a.caseId)}
ALLEGATION: ${a.title}${a.brief ? ' — ' + a.brief : ''}
HIS REPLIES (tagged with the paragraph they answer):
${replies.map(r => `- [${r.label}] ${r.text}`).join('\n')}
Format exactly: Line 1: one sentence stating his core position. Then at most 3 numbered points, each ONE sentence under 25 words, with short references in brackets e.g. (s.31 ¶5; s.25 ¶4). Total under 90 words. Formal court English, third person. Use ONLY what is in his replies. Only if two replies genuinely contradict, add a final line "Check: …".
Output only the response.`;
}

export function storyPrompt(v, caseId, length, data) {
  return `Write a ${length === 'snapshot' ? 'ONE-PAGE SNAPSHOT (max ~350 words)' : 'FULL CASE BRIEF for a new lawyer (clear, concise, impactful; max ~1500 words)'} telling the whole story of this case from the user's side, in date order.
${caseContext(v, caseId)}
Sections: 1. Parties and proceedings at a glance (number, court, status, next date). 2. The story — one or two lines per event: "dd.mm.yyyy — what happened"; for each filing against him add "Our response in brief: …" from his consolidated responses. 3. Overall response summary — his main lines of defence in 3–5 points. 4. Where things stand — pending matters, open verification points, unanswered paragraphs.
Use only the data below. Keep dates in dd.mm.yyyy. Mark verified facts with ✓. Do not invent anything; if something is unknown say so.
DATA (JSON):
${JSON.stringify(data)}`;
}

export function askSystem(v, caseId) {
  return `You are Claude, helping an Indian litigant understand his own case. Answer from his case vault using the tools; cite what you rely on as [doc ¶ref], [event dd.mm.yyyy] or [reply …]. Be direct and practical: where he stands, what is against him, what he may be missing, what to ask his advocate. Indian law (PWDVA 2005, BNS, BNSS, BSA, CrPC/IPC case law, HMA, Companies Act) — explain plainly, flag that your legal knowledge has a cutoff and that recent judgments or amendments should be checked in a normal Claude chat with web search and with his advocate. You are not his lawyer; do not tell him to mislead the court. ${caseContext(v, caseId)}`;
}

export const EXTRACT_SCHEMA = `{"document":{"title":"","short":"","date":"dd.mm.yyyy","filedBy":"opponent|me|court|police|other","language":"en|bn|mixed","summary":"2-3 sentences","proceeding":{"number":"","title":"","court":""}},
"paragraphs":[{"ref":"¶1 | Ground I | Prayer A | Q16","page":1,"text":"exact text as printed (Bengali stays Bengali)","translation":"English, only if not English"}],
"events":[{"date":"dd.mm.yyyy or Month yyyy","title":"short","desc":"","account":"theirs|mine|record","kind":"incident|filing|order|police|hearing","page":1,"ref":"¶5"}],
"allegations":[{"existingId":"id of an existing allegation if it is the same allegation, else omit","title":"short neutral title","brief":"one line","group":"","paraRefs":["¶5","Ground III"]}],
"verifications":[{"title":"what does not match","kind":"date|fact","variants":[{"value":"","ref":"","page":1}]}],
"directions":[{"text":"only for court orders: what the order requires of the user"}],
"nextDate":"dd.mm.yyyy if the order fixes one","nextPurpose":""}`;

export function extractPrompt(v, caseId, fileName, pageFrom, pageTo, total) {
  const als = v.list('allegations', a => a.caseId === caseId).map(a => `${a.id}: ${a.title}`).join('\n');
  const me = v.get('cases', caseId);
  return `Read these scanned pages (${pageFrom}–${pageTo} of ${total}) of "${fileName}" from an Indian court/police file. ${caseContext(v, caseId)}
Return JSON only, exactly this shape: ${EXTRACT_SCHEMA}
Rules: copy paragraph text EXACTLY as printed (fix only obvious scan noise; text hidden by a stamp → [illegible]). Number paragraphs as the document does. "filedBy" is from the user's point of view (${me?.myRole || 'the user'}): documents filed by the other side are "opponent". Only documents filed against the user get "allegations" — group paragraphs that make the same allegation even if worded differently; reuse an existing allegation id when it is the same allegation. Events: every dated happening the document states, with the page. If this chunk does not contain the title page, leave document fields empty.
EXISTING ALLEGATIONS IN THIS CASE:
${als || '(none yet)'}`;
}

export const fmtD = d => formatDate(d);
