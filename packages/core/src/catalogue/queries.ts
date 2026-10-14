import { CATALOGUE_DOCUMENTS } from './documents';
import { CATALOGUE_FIELDS } from './fields';
import { LEGACY_FIELD_SNAPSHOT } from './legacy';
import { CATALOGUE_PURPOSES } from './purposes';
import type { CatalogueDocument, CatalogueField, CataloguePurpose, LayerKey } from './types';

/** Every field key that is live today or added by the catalogue. */
export const ALL_FIELD_KEYS: ReadonlySet<string> = new Set([
  ...LEGACY_FIELD_SNAPSHOT.map((field) => field.key),
  ...CATALOGUE_FIELDS.map((field) => field.key),
]);

export function isKnownFieldKey(key: string): boolean {
  return ALL_FIELD_KEYS.has(key);
}

export function catalogueFieldsInLayer(layer: LayerKey): readonly CatalogueField[] {
  return CATALOGUE_FIELDS.filter((field) => field.layer === layer);
}

export function purposesInFamily(family: CataloguePurpose['family']): readonly CataloguePurpose[] {
  return CATALOGUE_PURPOSES.filter((purpose) => purpose.family === family);
}

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
