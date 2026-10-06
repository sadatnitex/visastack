/**
 * Builds a valid, text-bearing PDF with a chosen number of pages, with no outside tools.
 * Each page carries about 45 lines of made-up text, like a typed letter or statement.
 */
export function buildPdf(pages: number, linesPerPage = 45): Uint8Array {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 catalog, 2 pages tree, 3 font, then (page, contents) pairs
  const fontId = 3;
  for (let p = 0; p < pages; p++) pageIds.push(4 + p * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`;
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  for (let p = 0; p < pages; p++) {
    const pageId = 4 + p * 2;
    const contentId = pageId + 1;
    const lines: string[] = ['BT', '/F1 11 Tf', '14 TL', '56 740 Td'];
    for (let l = 0; l < linesPerPage; l++) {
      lines.push(
        `(Page ${p + 1} line ${l + 1}: made up statement text for the load test reference file.) Tj T*`,
      );
    }
    lines.push('ET');
    const stream = lines.join('\n');
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
