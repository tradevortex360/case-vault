// Plain-language explanations for Indian legal shorthand, shown when you tap an underlined term.
const ACTS = {
  PWDVA: 'the Protection of Women from Domestic Violence Act, 2005',
  BNS: 'the Bharatiya Nyaya Sanhita, 2023 (the criminal code that replaced the IPC)',
  BNSS: 'the Bharatiya Nagarik Suraksha Sanhita, 2023 (criminal procedure, replaced the CrPC)',
  IPC: 'the Indian Penal Code, 1860',
  CrPC: 'the Code of Criminal Procedure, 1973',
  HMA: 'the Hindu Marriage Act, 1955',
};
const SECTIONS = {
  PWDVA: { 12: 'application to the Magistrate for relief', 18: 'protection order', 19: 'residence order (right to live in the shared household)', 20: 'monetary relief (maintenance, expenses)', 21: 'custody order', 22: 'compensation order', 23: 'interim and ex parte orders', '23(2)': 'ex parte interim order — passed on her affidavit without first hearing the husband', 25: 'how long orders last, and changing or cancelling them', 28: 'procedure', 29: 'appeal to the Sessions Court', 31: 'penalty for breaching a protection order' },
  BNS: { '3(5)': 'acts done by several persons with a common intention', 61: 'criminal conspiracy', '61(2)': 'punishment for criminal conspiracy', 85: 'cruelty to a wife by the husband or his relatives', 316: 'criminal breach of trust', '316(2)': 'punishment for criminal breach of trust', 318: 'cheating', '318(4)': 'cheating and dishonestly inducing delivery of property', 338: 'forgery of a valuable security, will, etc.', 340: 'forged documents', '340(2)': 'using a forged document as genuine' },
};
const TERMS = {
  'ex parte': 'without hearing the other side',
  'ex-parte': 'without hearing the other side',
  'r/w': 'read with (taken together with)',
  'Ld.': 'Learned — the courtesy title for a judge or advocate',
  'JM': 'Judicial Magistrate',
  'CJM': 'Chief Judicial Magistrate',
  'ADJ': 'Additional District Judge',
  'Crl.': 'Criminal',
  'MS': 'Matrimonial Suit (a family case such as divorce)',
  'GR': 'General Register number — the court number given to a police case',
  'FIR': 'First Information Report — the complaint that starts a police case',
  'PS': 'Police Station',
  'OC': 'Officer-in-Charge of the police station',
  'WS': 'Written Statement — the reply filed by the other party in a suit',
  'DV': 'domestic violence',
  'u/s': 'under section',
  'ss.': 'sections',
  'Pvt Ltd': 'Private Limited company',
  'interim': 'temporary, until the case is finally decided',
  'prima facie': 'at first sight, before full proof',
};
for (const [k, v] of Object.entries(ACTS)) TERMS[k] = v.replace(/^the /, 'The ');

const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const NEEDS_NUMBER = new Set(['MS', 'GR', 'PS', 'WS', 'OC']); // only when followed by a number, e.g. 'MS 123/2023', 'PS Case 45/2024'
const termRe = Object.keys(TERMS).sort((a, b) => b.length - a.length).map(t => (/^[A-Za-z]/.test(t) && /[A-Za-z]$/.test(t) ? `\\b${esc(t)}\\b` : /^[A-Za-z]/.test(t) ? `\\b${esc(t)}` : esc(t)) + (NEEDS_NUMBER.has(t) ? '(?=\\s*(?:Case\\s*)?\\d|,)' : '')).join('|');
// a section reference: s.23(2) / u/s 31 / ss. 19 & 23 / Section 25, or "BNS 85, 316(2), 3(5)"
const secRe = String.raw`(?:\bu\/s\s*|\bss?\.\s*|\b[Ss]ections?\s+)\d+[A-Z]?(?:\(\d+\))?(?:\s*(?:,|&|and)\s*\d+[A-Z]?(?:\(\d+\))?)*|\b(?:PWDVA|BNS)\s+\d+[A-Z]?(?:\(\d+\))?(?:\s*,\s*\d+[A-Z]?(?:\(\d+\))?)*`;
const RE = new RegExp(`(${secRe})|(${termRe})`, 'gi');

function actNear(text, at) { // the Act named closest after (or before) the reference
  const after = text.slice(at).match(/\b(PWDVA|BNS|BNSS|IPC|CrPC|HMA)\b/); if (after) return after[1];
  const before = [...text.slice(0, at).matchAll(/\b(PWDVA|BNS|BNSS|IPC|CrPC|HMA)\b/g)].pop(); return before?.[1] || null;
}
export function explainSection(ref, text, at) {
  const lead = ref.match(/^(PWDVA|BNS)\b/); const act = lead ? lead[1] : actNear(text, at + ref.length);
  const nums = [...ref.replace(/^(PWDVA|BNS)\s+/, '').matchAll(/\d+[A-Z]?(?:\(\d+\))?/g)].map(m => m[0]);
  const lines = nums.map(n => { const map = act && SECTIONS[act]; const m = map && (map[n] || map[n.replace(/\(.*/, '')]); return `Section ${n}${m ? ': ' + m : ''}`; });
  return (act ? `${ACTS[act].replace(/^the /, 'The ')}\n` : '') + lines.join('\n');
}
// Split text into plain strings and { term, tip } pieces
export function glossParts(text = '') {
  const out = []; let last = 0; RE.lastIndex = 0; let m;
  while ((m = RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push({ term: m[1], tip: explainSection(m[1], text, m.index) });
    else { const key = Object.keys(TERMS).find(k => k.toLowerCase() === m[2].toLowerCase()) || m[2]; out.push({ term: m[2], tip: TERMS[key] }); }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
export const GLOSSARY = TERMS;
