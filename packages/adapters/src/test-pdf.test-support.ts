/**
 * Hand-built PDF files for the safe copy tests (S23). Each carries a marker string in every place
 * a real document can hide data: the visible text, the document information dictionary, an XMP
 * metadata stream, an attached file, a form field, a note annotation and a script that runs on
 * opening. A safe copy must carry none of them.
 */

const latin1 = (text: string): Uint8Array => Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);

/** Joins numbered objects into a PDF with a correct cross-reference table. */
export function assemblePdf(objects: readonly string[], trailerExtra = ''): Uint8Array {
  let body = '%PDF-1.7\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${xref}\n%%EOF\n`;
  return latin1(body);
}

function stream(dictionary: string, data: string): string {
  return `<< ${dictionary} /Length ${data.length} >>\nstream\n${data}\nendstream`;
}

export interface LoadedPdfOptions {
  readonly marker: string;
  readonly pages?: number;
  /** Page background colour as PDF "r g b" (0 to 1). */
  readonly background?: string;
}

/**
 * A US Letter PDF (612 by 792 points) whose pages are filled with `background`, with the marker
 * as text at (72, 700) in 24 point Helvetica on page 1, and the marker hidden in the information
 * dictionary, XMP, an attachment, a form field, an annotation and an opening script.
 */
export function loadedPdf({
  marker,
  pages = 1,
  background = '1 0 0',
}: LoadedPdfOptions): Uint8Array {
  // Fixed objects: 1 catalog, 2 page tree, 3 font, 4 page-one content, 5 other pages' content,
  // 6 XMP, 7 file spec, 8 embedded file, 9 script, 10 form field, 11 note, 12 info.
  const firstPageId = 13;
  const pageIds = Array.from({ length: pages }, (_, index) => firstPageId + index);
  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R /Metadata 6 0 R /Names << /EmbeddedFiles << /Names [(${marker}.txt) 7 0 R] >> >> /OpenAction 9 0 R /AcroForm << /Fields [10 0 R] >> >>`,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream(
      '',
      `${background} rg 0 0 612 792 re f 0 0 0 rg BT /F1 24 Tf 72 700 Td (${marker}) Tj ET`,
    ),
    stream('', `${background} rg 0 0 612 792 re f`),
    stream(
      '/Type /Metadata /Subtype /XML',
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${marker}</dc:title></rdf:Description></rdf:RDF></x:xmpmeta>`,
    ),
    `<< /Type /Filespec /F (${marker}.txt) /UF (${marker}.txt) /EF << /F 8 0 R >> >>`,
    stream('/Type /EmbeddedFile', `attached ${marker}`),
    `<< /S /JavaScript /JS (app.alert\\('${marker}'\\)) >>`,
    `<< /Type /Annot /Subtype /Widget /FT /Tx /T (${marker}Field) /V (${marker}) /Rect [72 600 300 630] /P ${firstPageId} 0 R /F 4 >>`,
    `<< /Type /Annot /Subtype /Text /Rect [20 20 40 40] /Contents (${marker}) /P ${firstPageId} 0 R >>`,
    `<< /Title (${marker}) /Author (${marker}) /Producer (${marker}) /Creator (${marker}) /Keywords (${marker}) >>`,
  ];
  pageIds.forEach((_, index) => {
    const extra = index === 0 ? ' /Annots [10 0 R 11 0 R]' : '';
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${index === 0 ? 4 : 5} 0 R${extra} >>`,
    );
  });
  return assemblePdf(objects, '/Info 12 0 R ');
}

/** A PDF that needs a password to open (a standard security handler with a user password set). */
export function passwordPdf(): Uint8Array {
  const filler = '\\000'.repeat(32);
  return assemblePdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
      `<< /Filter /Standard /V 1 /R 2 /O (${filler}) /U (${filler}) /P -4 >>`,
    ],
    '/Encrypt 4 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>] ',
  );
}
