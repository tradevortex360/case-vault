// Word writer (runs offline in the browser). Word shapes Bengali itself.
import { Document, Packer, Paragraph, TextRun, BorderStyle, ShadingType, Footer, AlignmentType, PageNumber, HeadingLevel } from 'docx';

const ACC = '24456B', MUT = '5D636B', OK = '22543D', BAD = '8B2F2F', LINE = 'CFC9BD', ACC2 = 'E7EDF5';
const bar = c => ({ left: { style: BorderStyle.SINGLE, size: 18, color: c, space: 8 } });
const P = (runs, o = {}) => new Paragraph({ spacing: { after: o.after ?? 100 }, indent: o.indent, border: o.border, shading: o.shading, keepNext: o.keepNext, heading: o.heading, children: runs });
const R = (text, o = {}) => new TextRun({ text, ...o });

export async function buildDocx(model) {
  const kids = [];
  for (const b of model.blocks) {
    switch (b.t) {
      case 'title': kids.push(P([R(b.text, { bold: true, size: 40, color: ACC })], { heading: HeadingLevel.TITLE, after: 120 })); break;
      case 'sub': kids.push(P([R(b.text, { size: 27 })])); break;
      case 'small': kids.push(P([R(b.text, { size: 19, color: MUT })])); break;
      case 'note': kids.push(P([R(b.text, { size: 20 })], { shading: { type: ShadingType.CLEAR, fill: ACC2 }, after: 200 })); break;
      case 'h2': kids.push(P([R(b.text, { bold: true, size: 30, color: ACC })], { heading: HeadingLevel.HEADING_1, keepNext: true, after: 120, border: { top: { style: BorderStyle.SINGLE, size: 8, color: ACC, space: 6 } } })); break;
      case 'h2s': kids.push(P([R(b.text, { bold: true, size: 25, color: ACC })], { heading: HeadingLevel.HEADING_2, keepNext: true })); break;
      case 'h3': kids.push(P([R(b.text, { bold: true, size: 23 }), ...(b.linkText ? [R(`   (${b.link ? 'original ' : ''}${b.linkText}${b.link ? ', Annexure ' + b.link.anx + ' in the PDF version' : ''})`, { size: 18, color: MUT })] : [])], { keepNext: true, heading: HeadingLevel.HEADING_3 })); break;
      case 'quote': kids.push(P([R('“' + b.text + '”', { italics: true, size: 20, color: '3A3F46' })], { border: bar(LINE), indent: { left: 200 } })); break;
      case 'reply': kids.push(P([R(b.label, { bold: true, size: 16, color: OK })], { border: bar(OK), indent: { left: 200 }, after: 40, keepNext: true })); b.lines.forEach((l, i) => kids.push(P([R(l)], { border: bar(OK), indent: { left: 200 }, after: i === b.lines.length - 1 ? 160 : 40 }))); break;
      case 'summary': b.lines.forEach((l, i) => kids.push(P([R(l, { bold: i === 0 && !/^\d/.test(l) })], { shading: { type: ShadingType.CLEAR, fill: ACC2 }, after: i === b.lines.length - 1 ? 160 : 0 }))); break;
      case 'warn': kids.push(P([R(b.text, { italics: true, color: BAD, size: 20 })], { indent: { left: 200 } })); break;
      case 'bullet': kids.push(P([R('•  ' + b.text)], { indent: { left: 240, hanging: 200 } })); break;
      case 'event': kids.push(P([R(b.date + '   ', { bold: true, color: ACC }), R(b.text), ...(b.sub ? [R('  — ' + b.sub, { color: MUT, size: 19 })] : [])], { after: 60 })); break;
      default: kids.push(P([R(b.text || '')]));
    }
  }
  const doc = new Document({
    creator: 'Case Vault', title: model.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [R((model.footer || '') + '    Page ', { size: 16, color: MUT }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUT })] })] }) },
      children: kids }],
  });
  return Packer.toBlob(doc);
}
