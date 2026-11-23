// Date handling for Indian legal documents (day-first) and natural search queries.
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MON = Object.fromEntries(MONTHS.flatMap((m, i) => [[m, i + 1], [m.slice(0, 3), i + 1], ...(m.length > 4 ? [[m.slice(0, 4), i + 1]] : [])]));
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const fixYear = y => (y < 100 ? (y > 50 ? 1900 + y : 2000 + y) : y);

// A date value: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', precision: 'day'|'month'|'year' }
export function parseDate(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ');
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return day(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/))) return day(fixYear(+m[3]), +m[2], +m[1]);
  if ((m = s.match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/)) && MON[m[2]]) return day(+m[3], MON[m[2]], +m[1]);
  if ((m = s.match(/^([a-z]+)\.?\s+(\d{1,2})\s+(\d{4})$/)) && MON[m[1]]) return day(+m[3], MON[m[1]], +m[2]);
  if ((m = s.match(/^([a-z]+)\.?\s+(\d{4})$/)) && MON[m[1]]) return month(+m[2], MON[m[1]]);
  if ((m = s.match(/^(\d{1,2})[./-](\d{4})$/))) return month(+m[2], +m[1]);
  if ((m = s.match(/^(\d{4})-(\d{2})$/))) return month(+m[1], +m[2]);
  if ((m = s.match(/^(\d{4})$/))) return year(+m[1]);
  return null;
}
function day(y, mo, d) { if (mo < 1 || mo > 12 || d < 1 || d > lastDay(y, mo)) return null; const x = iso(y, mo, d); return { from: x, to: x, precision: 'day' }; }
function month(y, mo) { if (mo < 1 || mo > 12) return null; return { from: iso(y, mo, 1), to: iso(y, mo, lastDay(y, mo)), precision: 'month' }; }
function year(y) { return { from: iso(y, 1, 1), to: iso(y, 12, 31), precision: 'year' }; }

export function formatDate(v) {
  if (!v) return 'Date unknown';
  const d = typeof v === 'string' ? parseDate(v) : v; if (!d) return String(v);
  const [y, m, dd] = d.from.split('-').map(Number);
  if (d.precision === 'year') return String(y);
  if (d.precision === 'month') return `${MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1, 3)} ${y}`;
  return `${pad(dd)}.${pad(m)}.${y}`;
}
export const sortKey = v => (typeof v === 'string' ? (parseDate(v)?.from || '9999') : v?.from || '9999');

// Pull a date range + remaining topic words out of a free-text query.
// "between March and May 2026 keys" -> { from:'2026-03-01', to:'2026-05-31', text:'keys' }
export function parseQuery(q, today = new Date()) {
  let s = ' ' + q.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1') + ' ';
  let from = null, to = null;
  const DATE = String.raw`(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[a-z]+\.?\s+\d{4}|[a-z]+\.?\s+\d{4}|[a-z]+|\d{4})`;
  const take = (re, fn) => { const m = s.match(re); if (m) { const ok = fn(m); if (ok !== false) s = s.replace(m[0], ' '); } };
  const pd = (x, yearHint) => parseDate(x) || (yearHint && MON[x?.trim()] ? parseDate(x.trim() + ' ' + yearHint) : null);
  // between X and Y / from X to Y
  take(new RegExp(String.raw`\b(?:between|from)\s+${DATE}\s+(?:and|to|till|until|-)\s+${DATE}`), m => {
    const yh = (m[2].match(/\d{4}/) || [])[0];
    const a = pd(m[1], yh), b = pd(m[2]); if (!a || !b) return false; from = a.from; to = b.to;
  });
  take(new RegExp(String.raw`\b(?:after|since|from)\s+${DATE}`), m => { const a = pd(m[1]); if (!a) return false; from = a.to === a.from ? a.from : a.from; });
  take(new RegExp(String.raw`\b(?:before|until|till|upto|up to)\s+${DATE}`), m => { const a = pd(m[1]); if (!a) return false; to = a.from; });
  const Y = today.getFullYear();
  take(/\blast year\b/, () => { from = `${Y - 1}-01-01`; to = `${Y - 1}-12-31`; });
  take(/\bthis year\b/, () => { from = `${Y}-01-01`; to = `${Y}-12-31`; });
  take(/\blast month\b/, () => { const d = new Date(Y, today.getMonth() - 1, 1); const r = month(d.getFullYear(), d.getMonth() + 1); from = r.from; to = r.to; });
  take(/\bthis month\b/, () => { const r = month(Y, today.getMonth() + 1); from = r.from; to = r.to; });
  if (!from && !to) { // a bare date / month / year anywhere: "april 2026 keys", "03.04.2026", "2024"
    take(new RegExp(String.raw`(?:\bin\s+|\bon\s+)?(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[a-z]+\.?\s+\d{4}|[a-z]+\.?\s+\d{4}|\b(?:19|20)\d{2}\b)`), m => { const a = parseDate(m[1]); if (!a) return false; from = a.from; to = a.to; });
  }
  const text = s.replace(/\b(in|on|of|the|what|happened|did|find|show|me|any|anything|events?|between|and)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return { from, to, text };
}

export function overlaps(dv, from, to) {
  if (!from && !to) return true;
  const d = typeof dv === 'string' ? parseDate(dv) : dv; if (!d) return false;
  return (!from || d.to >= from) && (!to || d.from <= to);
}

// "23.11.2026, 4:49 pm" — day first, like everything else in the app
export function formatWhen(ms) {
  if (!ms) return '';
  const d = new Date(ms); const p = n => String(n).padStart(2, '0');
  let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${h}:${p(d.getMinutes())} ${ap}`;
}
export function formatTime(ms) { const w = formatWhen(ms); return w.slice(w.indexOf(', ') + 2); }
