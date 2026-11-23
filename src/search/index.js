// Offline search over the whole vault: keyword (BM25 with fuzzy + legal synonyms)
// plus optional meaning-based ranking from an on-device embedding model.
import MiniSearch from 'minisearch';
import { parseQuery, overlaps, formatDate, sortKey } from './dates.js';

const SYN = [
  ['key', 'keys', 'duplicate', 'lock', 'entry', 'access'],
  ['residence', 'reside', 'shared', 'household', 'house', 'home', 'flat', 'stay', 'accommodation'],
  ['leave', 'left', 'vacate', 'vacated', 'evict', 'evicted', 'eviction', 'ousted', 'forced'],
  ['belongings', 'streedhan', 'stridhan', 'articles', 'jewellery', 'jewelry', 'ornaments', 'gold', 'gifts'],
  ['police', 'gde', 'diary', 'fir', 'ps', 'station', 'officer'],
  ['money', 'maintenance', 'amount', 'rupees', 'rs', 'lakh', 'income', 'salary', 'expenses'],
  ['company', 'director', 'shares', 'shareholder', 'business'],
  ['followed', 'surveillance', 'tracking', 'tracked', 'stalking'],
  ['divorce', 'matrimonial', 'suit', 'ms'],
  ['order', 'direction', 'directions', 'interim', 'ex parte'],
  ['abuse', 'violence', 'cruelty', 'harassment', 'humiliation', 'intimidation'],
];
const SYNMAP = new Map(); for (const g of SYN) for (const w of g) SYNMAP.set(w, g);
const STOP = new Set('the a an of to in on at for and or by with that this is was were be been it its as from her his she he i my me we our they them there their what when where which who did does do any about'.split(' '));
export const tokenize = t => (t || '').toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(w => w && !STOP.has(w));

// Flatten the vault into searchable items
export function buildItems(v, caseId) {
  const inCase = r => !caseId || r.caseId === caseId;
  const docs = Object.fromEntries(v.list('documents').map(d => [d.id, d]));
  const items = [];
  for (const e of v.list('events', inCase)) items.push({ id: 'ev:' + e.id, type: 'Event', ref: e.id, caseId: e.caseId, date: e.date, title: e.title, text: [e.title, e.desc].join(' '), verified: e.verified?.status === 'verified' });
  for (const p of v.list('paragraphs')) { const d = docs[p.docId]; if (!d || !inCase(d)) continue; items.push({ id: 'pa:' + p.id, type: 'Paragraph', ref: p.id, caseId: d.caseId, date: d.date, title: `${d.short || d.title} · ${p.ref}`, text: [p.text, p.translation].join(' '), page: p.page, docId: d.id }); }
  for (const r of v.list('replies', inCase)) items.push({ id: 're:' + r.id, type: r.status === 'suggested' ? 'Suggested reply' : 'My reply', ref: r.id, caseId: r.caseId, date: r.updatedAt ? new Date(r.updatedAt).toISOString().slice(0, 10) : null, title: 'Reply', text: r.text || '' });
  for (const c of v.list('consolidated', inCase)) items.push({ id: 'co:' + c.id, type: 'Consolidated response', ref: c.id, caseId: c.caseId, title: 'Consolidated response', text: c.text || '' });
  for (const x of v.list('evidence', inCase)) items.push({ id: 'ex:' + x.id, type: 'Evidence', ref: x.id, caseId: x.caseId, date: x.obtainedOn || x.date, title: x.title, text: [x.title, x.notes, x.originalLocation, x.text].join(' ') });
  for (const h of v.list('hearings')) items.push({ id: 'he:' + h.id, type: 'Hearing', ref: h.id, caseId: h.caseId, date: h.date, title: 'Hearing ' + formatDate(h.date), text: [h.purpose, h.outcome, h.directions, h.notes].join(' ') });
  for (const x of v.list('commlog', inCase)) items.push({ id: 'cl:' + x.id, type: 'Contact log', ref: x.id, caseId: x.caseId, date: x.date, title: x.with || 'Contact', text: [x.summary, x.offer].join(' ') });
  for (const x of v.list('notes', inCase)) items.push({ id: 'no:' + x.id, type: 'Note', ref: x.id, caseId: x.caseId, date: x.date, title: x.title || 'Note', text: x.text || '' });
  for (const x of v.list('qa', inCase)) items.push({ id: 'qa:' + x.id, type: 'Q&A', ref: x.id, caseId: x.caseId, date: x.at ? new Date(x.at).toISOString().slice(0, 10) : null, title: x.question, text: [x.question, x.answer].join(' ') });
  for (const x of v.list('verifications', inCase)) items.push({ id: 've:' + x.id, type: 'Verification', ref: x.id, caseId: x.caseId, title: x.title, text: [x.title, x.resolution?.note, x.resolution?.value].join(' ') });
  return items.filter(i => i.caseId || !caseId);
}

export class SearchIndex {
  constructor() { this.ms = null; this.items = new Map(); this.embedder = null; this.vecs = new Map(); }
  build(items) {
    this.items = new Map(items.map(i => [i.id, i]));
    this.ms = new MiniSearch({ fields: ['title', 'text'], storeFields: ['id'], tokenize, processTerm: t => t, searchOptions: { boost: { title: 2 }, fuzzy: 0.2, prefix: true } });
    this.ms.addAll(items);
    return this;
  }
  setEmbedder(e) { this.embedder = e; }
  async ensureVectors() {
    if (!this.embedder) return;
    for (const it of this.items.values()) if (!this.vecs.has(it.id)) this.vecs.set(it.id, await this.embedder.embed((it.title + '. ' + it.text).slice(0, 1200)));
  }
  async search(q, { caseId, types, limit = 40, today } = {}) {
    const pq = parseQuery(q, today);
    const ranged = !!(pq.from || pq.to);
    const pool = [...this.items.values()].filter(i => (!caseId || i.caseId === caseId) && (!types || types.includes(i.type)) && (!ranged || (i.date && overlaps(i.date, pq.from, pq.to))));
    const poolIds = new Set(pool.map(i => i.id));
    const scores = new Map();
    if (pq.text) {
      const terms = tokenize(pq.text).flatMap(t => SYNMAP.get(t) ? [t, ...SYNMAP.get(t).filter(x => x !== t)] : [t]);
      const res = this.ms.search(terms.join(' '), { combineWith: 'OR', filter: r => poolIds.has(r.id) });
      const max = res[0]?.score || 1;
      for (const r of res) scores.set(r.id, r.score / max);
      if (this.embedder) {
        await this.ensureVectors();
        const qv = await this.embedder.embed(pq.text);
        for (const i of pool) { const s = cos(qv, this.vecs.get(i.id)); if (s > 0.35) scores.set(i.id, (scores.get(i.id) || 0) * 0.5 + s); }
      }
      return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, score]) => ({ ...this.items.get(id), score }));
    }
    // date-only query: chronological
    return pool.sort((a, b) => sortKey(a.date).localeCompare(sortKey(b.date))).slice(0, limit * 3).map(i => ({ ...i, score: 1 }));
  }
}
function cos(a, b) { if (!a || !b) return 0; let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x * y) || 1); }

// Optional on-device model (multilingual, works for English + Bengali). Loaded on demand; cached for offline.
export async function loadEmbedder(onProgress) {
  const { pipeline, env } = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2');
  env.allowLocalModels = false;
  const fe = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', { quantized: true, progress_callback: onProgress });
  return { embed: async t => Array.from((await fe(t, { pooling: 'mean', normalize: true })).data) };
}
