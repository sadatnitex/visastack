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

/** Build the proposed filename from deterministic components. Never invents a missing part. */
export function buildProposedName(input: NameComponentsInput): string {
  const typeLabel = input.classifiedType
    ? (DOC_TYPE_LABELS[input.classifiedType] ?? input.classifiedType)
    : 'Document';

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
