// Domain rules shared by screens, exports and the Claude side.
import { sortKey, parseDate } from './search/dates.js';

export const FILED_BY = {
  opponent: { label: 'Filed against me', short: 'Against me', tag: 'bad' },
  me: { label: 'Filed by me', short: 'Mine', tag: 'ok' },
  court: { label: 'Court order / record', short: 'Court', tag: '' },
  police: { label: 'Police record', short: 'Police', tag: '' },
  other: { label: 'Other', short: 'Other', tag: '' },
};
export const needsReply = d => d?.filedBy === 'opponent';

export const docsOf = (v, caseId) => v.list('documents', d => d.caseId === caseId).sort((a, b) => sortKey(a.date).localeCompare(sortKey(b.date)));
export const parasOf = (v, docId) => v.list('paragraphs', p => p.docId === docId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const allegationsOf = (v, caseId) => v.list('allegations', a => a.caseId === caseId).sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
export const eventsOf = (v, caseId) => v.list('events', e => e.caseId === caseId && !e.mergedInto).sort((a, b) => sortKey(a.date).localeCompare(sortKey(b.date)) || (a.order ?? 0) - (b.order ?? 0));
export const proceedingsOf = (v, caseId) => v.list('proceedings', p => p.caseId === caseId);

export const repliesFor = (v, { allegationId, paraId }) => v.list('replies', r =>
  (allegationId === undefined || r.allegationId === allegationId) && (paraId === undefined || (r.paraId || null) === (paraId || null)) && r.status !== 'rejected'
).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

// Is a paragraph answered? (own para-wise reply, or a common reply on one of its allegations)
export function paraStatus(v, p) {
  const own = v.list('replies', r => r.paraId === p.id && r.status !== 'rejected');
  if (own.some(r => r.status === 'accepted')) return 'answered';
  const common = (p.allegationIds || []).some(aid => v.list('replies', r => r.allegationId === aid && !r.paraId && r.status === 'accepted').length);
  if (common) return 'common';
  if (own.some(r => r.status === 'suggested')) return 'suggested';
  return 'open';
}
export function allegationProgress(v, a) {
  const ps = (a.paraIds || []).map(id => v.get('paragraphs', id)).filter(Boolean);
  const st = ps.map(p => paraStatus(v, p));
  return { total: ps.length, done: st.filter(s => s === 'answered' || s === 'common').length, suggested: st.filter(s => s === 'suggested').length };
}

// Dates mentioned inside a paragraph (for the side panel)
export function datesIn(text) {
  const out = new Set(); const re = /\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{4})\b/gi;
  let m; while ((m = re.exec(text || ''))) { const d = parseDate(m[1]); if (d) out.add(d.from); }
  return [...out];
}

export function nextAllegationNo(v, caseId) { return Math.max(0, ...allegationsOf(v, caseId).map(a => a.n || 0)) + 1; }

// Upcoming items for the overview / reminders
export function upcoming(v, caseId, today = new Date().toISOString().slice(0, 10)) {
  const procs = new Set(proceedingsOf(v, caseId).map(p => p.id));
  const hearings = v.list('hearings', h => procs.has(h.proceedingId) && (h.nextDate || h.date) >= today);
  const deadlines = v.list('deadlines', d => procs.has(d.proceedingId) && !d.done);
  return {
    hearings: hearings.map(h => ({ date: h.nextDate && h.nextDate >= today ? h.nextDate : h.date, h })).sort((a, b) => a.date.localeCompare(b.date)),
    deadlines: deadlines.sort((a, b) => (a.due || '').localeCompare(b.due || '')),
  };
}

// Google Calendar "add event" link (works without any connector)
export function calendarLink(title, dateISO, details = '') {
  const d = dateISO.replace(/-/g, ''); const next = new Date(dateISO + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
  const d2 = next.toISOString().slice(0, 10).replace(/-/g, '');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${d}/${d2}&details=${encodeURIComponent(details)}`;
}
export function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
