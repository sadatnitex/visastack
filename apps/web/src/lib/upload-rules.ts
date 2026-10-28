/**
 * What a traveller may upload, in one place for the browser and the server (UX-B). Pure: no
 * server code, so the upload form can check a file before sending it and say why in plain words,
 * and the server applies the very same list.
 */

export const PDF_TYPE = 'application/pdf';
export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** How iPhones (and some other phones) save photos. Converted to JPEG on the server. */
export const HEIC_TYPES: readonly string[] = [
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
];

/**
 * The file types stored as they are: the one list the upload form checks a chosen file against
 * and the server checks the bytes against (upload-preflight.ts builds its own check from it).
 */
export const STORED_UPLOAD_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  PDF_TYPE,
  DOCX_TYPE,
  'text/plain',
  'text/markdown',
];

const TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: PDF_TYPE,
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  docx: DOCX_TYPE,
  txt: 'text/plain',
  md: 'text/markdown',
};

const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  [PDF_TYPE]: 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  [DOCX_TYPE]: 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
};

export function isHeicType(type: string): boolean {
  return HEIC_TYPES.includes(type.toLowerCase());
}

/** The `accept` list for the file picker: every type the server takes. */
export function acceptAttribute(pdfAccepted: boolean): string {
  const types = [...STORED_UPLOAD_TYPES, ...HEIC_TYPES].filter(
    (t) => pdfAccepted || t !== PDF_TYPE,
  );
  const extensions = Object.keys(TYPE_BY_EXTENSION)
    .filter((ext) => pdfAccepted || ext !== 'pdf')
    .map((ext) => `.${ext}`);
  return [...extensions, ...types].join(',');
}

/** Why PDF files are missing from the list while they cannot be added (decision D5). */
export const PDF_NEEDS_SCAN_TEXT =
  'PDF files can be added only while our virus scan is switched on.';

/**
 * The limits as people read them, shown before they choose a file: the per-file size the server
 * enforces, the kinds it accepts and, while PDF files are refused, why (decision D5).
 */
export function uploadLimitsText(limitLabel: string, pdfAccepted: boolean): string {
  const base = uploadKindsText(limitLabel, pdfAccepted);
  return pdfAccepted ? base : `${base} ${PDF_NEEDS_SCAN_TEXT}`;
}

/** The size and the kinds alone. */
function uploadKindsText(limitLabel: string, pdfAccepted: boolean): string {
  const kinds = pdfAccepted ? 'PDF, JPG, PNG, HEIC' : 'JPG, PNG, HEIC';
  return `Up to ${limitLabel} per file; ${kinds}, Word or text files.`;
}

export type FileCheck =
  | { readonly ok: true; readonly contentType: string }
  | { readonly ok: false; readonly reason: string };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Whether a chosen file can be sent, and the type to send it as. Browsers often leave the type of
 * an iPhone photo, a Word file or a text file empty, so the name's extension fills it in. The
 * server still checks the bytes themselves; this only saves a wasted upload.
 */
export function checkChosenFile(
  file: { readonly name: string; readonly size: number; readonly type: string },
  rules: {
    readonly limitBytes: number;
    readonly limitLabel: string;
    readonly pdfAccepted: boolean;
  },
): FileCheck {
  if (file.size === 0) return { ok: false, reason: 'This file is empty. Choose another copy.' };
  const declared = file.type.toLowerCase();
  const contentType =
    declared && declared !== 'application/octet-stream'
      ? declared
      : (TYPE_BY_EXTENSION[extensionOf(file.name)] ?? '');
  const known = STORED_UPLOAD_TYPES.includes(contentType) || isHeicType(contentType);
  if (!known) {
    return {
      ok: false,
      // The kinds and size only: the PDF reason belongs to PDF files, not to a picture in another format.
      reason: `This kind of file cannot be added. ${uploadKindsText(rules.limitLabel, rules.pdfAccepted)}`,
    };
  }
  if (contentType === PDF_TYPE && !rules.pdfAccepted) {
    return {
      ok: false,
      reason: `${PDF_NEEDS_SCAN_TEXT} Add a photo or scan of each page as a JPG or PNG instead.`,
    };
  }
  if (file.size > rules.limitBytes) {
    return {
      ok: false,
      reason: `This file is larger than ${rules.limitLabel}. Choose a smaller copy, or take a photo of it instead.`,
    };
  }
  return { ok: true, contentType };
}

/**
 * A file name without its file extension, counting only an extension this list knows ("Scan.pdf"
 * is "Scan", "IMG_1.HEIC" is "IMG_1"). Anything else after a last dot is part of the name
 * ("Payslip v1.2026", "J.Smith" stay whole). The one rule every name below uses.
 */
export function fileNameBase(name: string): string {
  const current = extensionOf(name);
  if (current === '' || !Object.hasOwn(TYPE_BY_EXTENSION, current)) return name;
  return name.slice(0, name.length - current.length - 1);
}

/** The base of a name, or "document" when nothing is left of it (a name that was only ".png"). */
function baseOrDocument(name: string): string {
  return fileNameBase(name).trim() || 'document';
}

/** A stored file's name with the extension of what is actually stored ("IMG_1.HEIC" stored as JPEG is "IMG_1.jpg"). */
export function storedFileName(name: string, contentType: string): string {
  const extension = EXTENSION_BY_TYPE[contentType];
  const base = baseOrDocument(name);
  return extension ? `${base}.${extension}` : base;
}

/**
 * A download name that ends in the stored file's extension. A name already ending in a known
 * extension for the stored type keeps it ("Scan.jpeg" for a JPEG); one ending in another known
 * extension has it replaced ("IMG_1.HEIC" stored as a JPEG is "IMG_1.jpg"); anything else after a
 * last dot is part of the name, so the stored file's extension is added ("Payslip v1.2026.pdf").
 */
export function withFileExtension(name: string, contentType: string): string {
  const extension = EXTENSION_BY_TYPE[contentType];
  if (!extension) return name;
  if (TYPE_BY_EXTENSION[extensionOf(name)] === contentType && fileNameBase(name).trim() !== '') {
    return name;
  }
  return `${baseOrDocument(name)}.${extension}`;
}

/**
 * The name of a preview made in another format than the stored file ("passport.pdf" shown as a
 * picture is "passport-preview.png"), with the same rule for what counts as an extension.
 */
export function previewName(name: string, extension: string): string {
  return `${baseOrDocument(name)}-preview.${extension}`;
}
