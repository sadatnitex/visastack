import { CATALOGUE_DOCUMENTS } from './documents';
import { CATALOGUE_FIELDS } from './fields';
import { LEGACY_FIELD_SNAPSHOT } from './legacy';
import { CATALOGUE_MODULES } from './modules';
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

/** One field as the completion calculation sees it, whether it is live today or added by the catalogue. */
export interface ModuleField {
  readonly key: string;
  readonly module: string;
  /** The repeating record it belongs to, if any. */
  readonly group?: string;
  /** The field holding the text for an "Other" choice, if this field offers one. */
  readonly otherDetailKey?: string;
  readonly role?: 'other_detail' | 'other_item';
}

const LEGACY_MODULE_BY_FIELD: ReadonlyMap<string, string> = new Map(
  CATALOGUE_MODULES.flatMap((module) =>
    (module.legacyFields ?? []).map((key) => [key, module.key] as const),
  ),
);
const LEGACY_MODULE_BY_GROUP: ReadonlyMap<string, string> = new Map(
  CATALOGUE_MODULES.flatMap((module) =>
    (module.legacyGroups ?? []).map((group) => [group, module.key] as const),
  ),
);

/** Which module a live field belongs to, or undefined when no module claims it (a test fails on that). */
export function moduleOfLegacyField(key: string): string | undefined {
  const field = LEGACY_FIELD_SNAPSHOT.find((candidate) => candidate.key === key);
  if (!field) return undefined;
  return field.group ? LEGACY_MODULE_BY_GROUP.get(field.group) : LEGACY_MODULE_BY_FIELD.get(key);
}

/** Every field, live or new, with the module it belongs to. */
export const MODULE_FIELDS: readonly ModuleField[] = [
  ...LEGACY_FIELD_SNAPSHOT.map(
    (field): ModuleField => ({
      key: field.key,
      module: moduleOfLegacyField(field.key) ?? '',
      ...(field.group ? { group: field.group } : {}),
      ...(field.otherDetailKey ? { otherDetailKey: field.otherDetailKey } : {}),
    }),
  ),
  ...CATALOGUE_FIELDS.map(
    (field): ModuleField => ({
      key: field.key,
      module: field.module,
      ...(field.group ? { group: field.group } : {}),
      ...(field.allowOther ? { otherDetailKey: `${field.key}_other` } : {}),
      ...(field.role ? { role: field.role } : {}),
    }),
  ),
];

export function fieldsInModule(moduleKey: string): readonly ModuleField[] {
  return MODULE_FIELDS.filter((field) => field.module === moduleKey);
}
