import { CATALOGUE_DOCUMENTS } from './documents';
import type { CatalogueDocument } from './types';

/** Longest name worth looking up; anything longer is not a document type. */
const MAX_NAME_LENGTH = 120;

function normaliseDocumentName(input: string): string {
  const joined = input
    .slice(0, MAX_NAME_LENGTH)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
  // Edge underscores are trimmed by index, not by pattern, so the time stays linear.
  let start = 0;
  let end = joined.length;
  while (start < end && joined.charAt(start) === '_') start += 1;
  while (end > start && joined.charAt(end - 1) === '_') end -= 1;
  return joined.slice(start, end);
}

const DOCUMENT_BY_NAME: ReadonlyMap<string, CatalogueDocument> = new Map(
  CATALOGUE_DOCUMENTS.flatMap((document) =>
    [document.key, ...document.aliases].map(
      (name) => [normaliseDocumentName(name), document] as const,
    ),
  ),
);

/**
 * Finds a document type by its key or any alias, ignoring case, spaces and punctuation, so
 * "Pay Slip", "payslip" and "SALARY_SLIP" all resolve to the Salary Slip entry. Returns undefined
 * when the name is not known, never a guess.
 */
export function resolveDocumentType(name: string): CatalogueDocument | undefined {
  return DOCUMENT_BY_NAME.get(normaliseDocumentName(name));
}

/** Document types embassies usually want handed in as the original (a scan on file keeps it ready). */
export const ORIGINAL_DOCUMENT_KEYS: ReadonlySet<string> = new Set(
  CATALOGUE_DOCUMENTS.filter((document) => document.handling.original === true).map(
    (document) => document.key,
  ),
);

const DOCUMENTS_BY_FIELD: ReadonlyMap<string, readonly CatalogueDocument[]> = (() => {
  const byField = new Map<string, CatalogueDocument[]>();
  for (const document of CATALOGUE_DOCUMENTS) {
    for (const field of document.supports) {
      const list = byField.get(field) ?? [];
      list.push(document);
      byField.set(field, list);
    }
  }
  return byField;
})();

/** The document types that back any of these fields, in catalogue order, each once. */
export function documentsSupportingFields(
  fieldKeys: Iterable<string>,
): readonly CatalogueDocument[] {
  const found = new Set<CatalogueDocument>();
  for (const key of fieldKeys)
    for (const document of DOCUMENTS_BY_FIELD.get(key) ?? []) found.add(document);
  return CATALOGUE_DOCUMENTS.filter((document) => found.has(document));
}

/** The plain name of a document type for display, or undefined when the catalogue does not know it. */
export function documentTypeName(name: string): string | undefined {
  return resolveDocumentType(name)?.label;
}

/**
 * The profile fields a document type is known to carry, or undefined when the catalogue has no
 * list for it (or does not know the type). Used to keep AI reading to the fields a document can
 * actually hold. Undefined means "no narrowing", never "nothing".
 */
export function supportedFieldKeys(name: string): readonly string[] | undefined {
  const document = resolveDocumentType(name);
  return document && document.supports.length > 0 ? document.supports : undefined;
}
