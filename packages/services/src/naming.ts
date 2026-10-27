import { MAX_DOCUMENT_NAME_LENGTH } from '@visastack/core';
import { documentTypeName } from '@visastack/core/catalogue/documents';

/**
 * Automatic document naming (master directive §11):
 *
 *   Document Type - Primary Subject - Issuer or Context - Relevant Date or Period[ -vN].ext
 *
 * Components that were not deterministically established (issuer, date) are
 * simply omitted rather than invented — the human reviewer fills them in
 * before approving. The applicant's own display name is a legitimate,
 * non-invented default for "Primary Subject" (the document is already
 * scoped to that applicant, not guessed).
 */

const DOC_TYPE_LABELS: Readonly<Record<string, string>> = {
  PASSPORT: 'Passport',
  BANK_STATEMENT: 'Bank Statement',
  EMPLOYMENT_CERTIFICATE: 'Employment Certificate',
};

/** Acronyms that must survive title-casing unchanged. */
const GOVERNED_ACRONYMS = ['NID', 'TIN', 'VAT', 'IELTS', 'TOEFL'];

export interface NameComponentsInput {
  readonly classifiedType: string | null;
  readonly primarySubject: string;
  readonly issuerOrContext?: string;
  readonly relevantDateOrPeriod?: string;
  readonly extension: string;
}

/** Normalize Unicode, strip path-traversal/control characters, cap length. */
export function sanitizeNameComponent(raw: string): string {
  const normalized = raw.normalize('NFC');
  const stripped = normalized
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally stripping control chars.
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\.\./g, '')
    .replace(/[/\\:*?"<>|]/g, '')
    .trim();
  let out = stripped;
  for (const acronym of GOVERNED_ACRONYMS) {
    out = out.replace(new RegExp(`\\b${acronym}\\b`, 'gi'), acronym);
  }
  return out.slice(0, 120);
}

/**
 * The plain name of a kind of document for a filename: the fixed labels above first, then the
 * catalogue's own label (so every one of its kinds reads as words, never as a key), then the
 * value itself for a kind neither knows.
 */
export function documentKindLabel(classifiedType: string): string {
  return DOC_TYPE_LABELS[classifiedType] ?? documentTypeName(classifiedType) ?? classifiedType;
}

/** Build the proposed filename from deterministic components. Never invents a missing part. */
export function buildProposedName(input: NameComponentsInput): string {
  const typeLabel = input.classifiedType ? documentKindLabel(input.classifiedType) : 'Document';

  const parts = [sanitizeNameComponent(typeLabel), sanitizeNameComponent(input.primarySubject)];
  if (input.issuerOrContext) parts.push(sanitizeNameComponent(input.issuerOrContext));
  if (input.relevantDateOrPeriod) parts.push(sanitizeNameComponent(input.relevantDateOrPeriod));

  const base = parts.filter((p) => p.length > 0).join(' - ');
  const ext = input.extension
    .replace(/^\./, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return ext.length > 0 ? `${base}.${ext}` : base;
}

/** Extract a file extension from an original filename, defaulting to empty. */
export function extensionOf(originalName: string): string {
  const dot = originalName.lastIndexOf('.');
  return dot === -1 ? '' : originalName.slice(dot + 1);
}

/** The longest name a person can give a document (one value, shared with the rename form). */
export { MAX_DOCUMENT_NAME_LENGTH };

/**
 * Control characters (C0, DEL and C1) and the bidirectional overrides and isolates that can make
 * a name read differently from what it is ("txt.exe" shown as "exe.txt").
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are removed on purpose.
const UNSAFE_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/**
 * A name as a person typed it, made safe to show and to use as a download name: no control or
 * text-direction characters, no path separators, single spaces, at most
 * `MAX_DOCUMENT_NAME_LENGTH` characters.
 */
export function cleanDocumentName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(UNSAFE_NAME_CHARACTERS, '')
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DOCUMENT_NAME_LENGTH)
    .trim();
}

// --- Document titles (UX-B) -------------------------------------------------------------------
//
// The name a newly added document is listed under, before anyone renames it: the kind and the
// person's first name ("Passport, Nazmus"), or, when the kind is not known yet, a plain
// "Document" with the first name and the day it was added ("Document, Nazmus, 27 Oct 2026").
// Never built from the file's own name ("MHM.png", "IMG_2041.HEIC"), which says nothing to the
// person and can carry details they never meant to share.

/** Recorded on every name version written by `buildDocumentTitle`, so a later kind can replace it. */
export const AUTOMATIC_TITLE_REASON =
  'automatic title from the kind of document and the first name';

/**
 * Short forms that come before a first name ("Md. Nazmus Sadat", "Dr Anna Eriksson"), skipped so
 * the title uses the name itself. A token ending in a full stop is always treated as one.
 */
const NAME_PREFIXES = new Set(['md', 'mohd', 'mst', 'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sk']);

/** The first name in a display name: its first word that is not a short form or initial. */
export function firstNameOf(displayName: string): string {
  const words = displayName.normalize('NFC').trim().split(/\s+/).filter(Boolean);
  const name = words.find((word, i) => {
    if (i === words.length - 1) return true;
    const bare = word.replace(/\.$/, '').toLowerCase();
    return !(word.endsWith('.') || NAME_PREFIXES.has(bare));
  });
  return cleanDocumentName(sanitizeNameComponent(name ?? '')).replace(/[,.]+$/, '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The day a moment fell on in the traveller's time zone, as "27 Oct 2026". Built from its parts so
 * the text is the same on every server (some runtimes write "Sept"). An unknown zone falls back to
 * UTC rather than to the server's own.
 */
export function titleDate(at: Date, timeZone: string): string {
  const parts = (zone: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(at);
  let found: Intl.DateTimeFormatPart[];
  try {
    found = parts(timeZone);
  } catch {
    found = parts('UTC');
  }
  const part = (type: string) => Number(found.find((p) => p.type === type)?.value);
  return `${part('day')} ${MONTHS[part('month') - 1] ?? ''} ${part('year')}`;
}

export interface DocumentTitleInput {
  /** The catalogue key of the kind of document, when it is known. */
  readonly docType: string | null;
  /** The person's own name for an "Other" kind ("Marriage Certificate"). */
  readonly subject: string | null;
  /** The traveller's display name; only the first name is used. */
  readonly displayName: string;
  /** When the document was added, for the title of a document whose kind is not known. */
  readonly addedAt: Date;
  /** The traveller's time zone, so the day in the title is their day. */
  readonly timeZone: string;
}

/**
 * The title a document is listed under until someone renames it. An "Other" kind uses the
 * person's own name for it when there is one ("Marriage Certificate"), and the kind's own label
 * otherwise ("Other Letter or Statement").
 */
export function buildDocumentTitle(input: DocumentTitleInput): string {
  const isOther =
    input.docType !== null && (input.docType === 'OTHER' || input.docType.startsWith('OTHER_'));
  const named = isOther && input.subject ? sanitizeNameComponent(input.subject) : '';
  const kind =
    input.docType === null
      ? ''
      : named.length > 0
        ? named
        : sanitizeNameComponent(documentKindLabel(input.docType));
  const firstName = firstNameOf(input.displayName);
  const parts =
    kind.length > 0
      ? [kind, firstName]
      : ['Document', firstName, titleDate(input.addedAt, input.timeZone)];
  return cleanDocumentName(parts.filter((part) => part.length > 0).join(', '));
}
