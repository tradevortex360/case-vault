// PDF writer (runs fully offline in the browser): flowing text with pdf-lib,
// page links into the original scans attached at the end.
import { PDFDocument, rgb, PDFName, PDFArray } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const W = 595.28, H = 841.89, M = 54, CW = W - 2 * M;
const C = { ink: rgb(0.11, 0.12, 0.14), mut: rgb(0.39, 0.42, 0.45), acc: rgb(0.14, 0.27, 0.42), acc2: rgb(0.91, 0.93, 0.96), ok: rgb(0.13, 0.33, 0.24), bad: rgb(0.55, 0.18, 0.18), line: rgb(0.85, 0.83, 0.79), link: rgb(0.1, 0.31, 0.55) };
const COMPLEX = /[ऀ-෿]/; // Indic scripts: shaped by the browser, embedded as an image

export async function buildPdf(model, { fonts, loadAnnexure, renderComplex }) {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  pdf.setTitle(model.title); pdf.setCreator('Case Vault');
  const F = { r: await pdf.embedFont(fonts.regular, { subset: false, features: { liga: false, clig: false, dlig: false } }), b: await pdf.embedFont(fonts.bold, { subset: false, features: { liga: false, clig: false, dlig: false } }), i: await pdf.embedFont(fonts.italic, { subset: false, features: { liga: false, clig: false, dlig: false } }) };
  const has = {}; for (const k of Object.keys(F)) has[k] = new Set(F[k].getCharacterSet());
  const clean = (s, f = 'r') => String(s ?? '').replace(/✓/g, '(verified)').replace(/✕|×/g, 'x').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").split('').map(ch => (has[f].has(ch.codePointAt(0)) || ch === '\n') ? ch : '?').join('');
  let page, y; const links = []; const pages = [];
  const newPage = () => { page = pdf.addPage([W, H]); pages.push(page); y = H - M; };
  newPage();
  const ensure = h => { if (y - h < M + 20) newPage(); };
  const wrap = (text, font, size, width) => {
    const out = []; for (const para of String(text).split('\n')) {
      let line = ''; for (const w of para.split(/(\s+)/)) {
        const t = line + w; if (font.widthOfTextAtSize(t, size) <= width || !line.trim()) { line = t; continue; }
        out.push(line.trimEnd()); line = w.trimStart();
        while (font.widthOfTextAtSize(line, size) > width) { let k = line.length; while (k > 1 && font.widthOfTextAtSize(line.slice(0, k), size) > width) k--; out.push(line.slice(0, k)); line = line.slice(k); }
      }
      out.push(line.trimEnd());
    } return out;
  };
  const text = async (str, { f = 'r', size = 10.5, color = C.ink, x = M, width = CW, lead = 1.38, bar = null, bg = null, pad = 0 } = {}) => {
    if (COMPLEX.test(str) && renderComplex) {
      const img = await renderComplex(str, width - 2 * pad, size, f === 'i');
      const png = await pdf.embedPng(img.png); const h = img.height * (width - 2 * pad) / img.width;
      ensure(h + 2 * pad); if (bg) page.drawRectangle({ x: x - 4, y: y - h - 2 * pad, width: width + 8, height: h + 2 * pad, color: bg });
      if (bar) page.drawRectangle({ x: x - 8, y: y - h - pad, width: 2.5, height: h + pad, color: bar });
      page.drawImage(png, { x: x + pad, y: y - h - pad, width: width - 2 * pad, height: h }); y -= h + 2 * pad + 3; return;
    }
    const font = F[f]; const ls = wrap(clean(str, f), font, size, width - 2 * pad); const lh = size * lead;
    let i = 0;
    while (i < ls.length) {
      ensure(lh + pad); const room = Math.max(1, Math.floor((y - M - 20 - pad) / lh)); const chunk = ls.slice(i, i + room); const h = chunk.length * lh;
      if (bg) page.drawRectangle({ x: x - 4, y: y - h - 2 * pad + 2, width: width + 8, height: h + 2 * pad, color: bg });
      if (bar) page.drawRectangle({ x: x - 8, y: y - h - pad + 2, width: 2.5, height: h + pad, color: bar });
      chunk.forEach((l, j) => page.drawText(l, { x: x + pad, y: y - pad - size - j * lh + 2, size, font, color }));
      y -= h + 2 * pad; i += chunk.length;
    }
    y -= 3;
  };
  const gap = n => { y -= n; };
  for (const b of model.blocks) {
    switch (b.t) {
      case 'title': await text(b.text, { f: 'b', size: 22, color: C.acc }); break;
      case 'sub': await text(b.text, { size: 13.5 }); break;
      case 'small': await text(b.text, { size: 9.5, color: C.mut }); break;
      case 'note': gap(4); await text(b.text, { size: 9.8, bg: C.acc2, pad: 6 }); gap(6); break;
      case 'h2': ensure(70); gap(10); page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: C.acc }); gap(6); await text(b.text, { f: 'b', size: 15, color: C.acc }); break;
      case 'h2s': ensure(60); gap(6); await text(b.text, { f: 'b', size: 12.5, color: C.acc }); break;
      case 'h3': {
        ensure(70); gap(6); const t = clean(b.text, 'b'); page.drawText(t, { x: M, y: y - 11.5, size: 11.5, font: F.b, color: C.ink });
        if (b.linkText) { const lx = M + F.b.widthOfTextAtSize(t, 11.5) + 10; const lt = clean(b.link ? `open ${b.linkText} of the original` : b.linkText); const lw = F.r.widthOfTextAtSize(lt, 9.5);
          page.drawText(lt, { x: lx, y: y - 11.5, size: 9.5, font: F.r, color: b.link ? C.link : C.mut });
          if (b.link) { page.drawLine({ start: { x: lx, y: y - 13 }, end: { x: lx + lw, y: y - 13 }, thickness: 0.5, color: C.link }); links.push({ ...b.link, from: page, rect: [lx, y - 14, lx + lw, y - 2] }); } }
        y -= 17; break; }
      case 'quote': await text(b.text, { f: 'i', size: 10, color: C.mut, x: M + 10, width: CW - 10, bar: C.line }); gap(2); break;
      case 'reply': ensure(40); await text(b.label, { f: 'b', size: 8.5, color: C.ok, x: M + 10, width: CW - 10 }); for (const l of b.lines) await text(l, { x: M + 10, width: CW - 10, bar: C.ok }); gap(4); break;
      case 'summary': { for (const [k, l] of b.lines.entries()) await text(l, { f: k === 0 && !/^\d/.test(l) ? 'b' : 'r', bg: C.acc2, pad: 3 }); gap(4); break; }
      case 'warn': await text(b.text, { f: 'i', size: 10, color: C.bad, x: M + 10, width: CW - 10 }); break;
      case 'bullet': await text('•  ' + b.text, { x: M + 6, width: CW - 6 }); break;
      case 'event': { ensure(18); page.drawText(clean(b.date, 'b'), { x: M, y: y - 10.5, size: 10.5, font: F.b, color: C.acc }); const y0 = y; await text(b.text + (b.sub ? '  — ' + b.sub : ''), { x: M + 78, width: CW - 78 }); if (y > y0 - 15) y = y0 - 15; break; }
      default: await text(b.text || '');
    }
  }
  const bodyCount = pages.length;
  // annexures
  const starts = {};
  for (const a of model.annexures || []) {
    const bytes = await loadAnnexure(a.fileId); if (!bytes) continue;
    let src; try { src = await PDFDocument.load(bytes, { ignoreEncryption: true }); } catch { continue; }
    newPage(); await text('Annexure ' + a.label, { f: 'b', size: 20, color: C.acc }); await text(a.title, { size: 13 }); await text('Original document as filed — ' + src.getPageCount() + ' pages follow.', { size: 10, color: C.mut });
    const copied = await pdf.copyPages(src, src.getPageIndices());
    starts[a.label] = pdf.getPageCount();
    copied.forEach((p, k) => { pdf.addPage(p); const { width } = p.getSize(); p.drawText(clean(`Annexure ${a.label} · page ${k + 1}`), { x: width - 150, y: 12, size: 8, font: F.r, color: C.mut }); });
  }
  // links into annexures
  for (const l of links) {
    const target = starts[l.anx] !== undefined ? pdf.getPage(starts[l.anx] + l.page - 1) : null; if (!target) continue;
    const annot = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: l.rect, Border: [0, 0, 0], Dest: [target.ref, PDFName.of('Fit')] });
    const ref = pdf.context.register(annot);
    const node = l.from.node; let arr = node.lookupMaybe(PDFName.of('Annots'), PDFArray); if (!arr) { arr = pdf.context.obj([]); node.set(PDFName.of('Annots'), arr); } arr.push(ref);
  }
  // footers
  pages.slice(0, bodyCount).forEach((p, k) => { p.drawText(clean(model.footer || ''), { x: M, y: 24, size: 8, font: F.r, color: C.mut }); const t = `Page ${k + 1} of ${bodyCount}`; p.drawText(t, { x: W - M - F.r.widthOfTextAtSize(t, 8), y: 24, size: 8, font: F.r, color: C.mut }); });
  return pdf.save();
}

// Browser renderer for Bengali/Hindi text: the device font shapes the script correctly.
export function canvasRenderer() {
  return async (str, widthPt, sizePt, italic) => {
    const scale = 3, w = Math.round(widthPt * scale), fs = sizePt * scale;
    const c = document.createElement('canvas'); const g = c.getContext('2d');
    const font = `${italic ? 'italic ' : ''}${fs}px "Noto Sans Bengali","Noto Sans Devanagari","Nirmala UI","Vrinda",sans-serif`;
    g.font = font; const words = str.split(/\s+/); const ls = []; let line = '';
    for (const wd of words) { const t = line ? line + ' ' + wd : wd; if (g.measureText(t).width <= w || !line) line = t; else { ls.push(line); line = wd; } } ls.push(line);
    const lh = fs * 1.5; c.width = w; c.height = Math.ceil(ls.length * lh + fs * 0.4);
    g.font = font; g.fillStyle = italic ? '#555b61' : '#1d1f23'; g.textBaseline = 'top'; ls.forEach((l, i) => g.fillText(l, 0, i * lh));
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return { png: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height };
  };
}
