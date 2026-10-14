import { CATALOGUE_DOCUMENTS } from './documents';
import type { CatalogueDocument } from './types';

function normaliseDocumentName(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
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
