import { CATALOGUE_FIELDS } from './fields';
import { LEGACY_FIELD_SNAPSHOT } from './legacy';
import { CATALOGUE_MODULES } from './modules';
import { CATALOGUE_PURPOSES } from './purposes';
import type { CatalogueField, CataloguePurpose, FieldRole, LayerKey } from './types';

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

/** One field as the completion calculation sees it, whether it is live today or added by the catalogue. */
export interface ModuleField {
  readonly key: string;
  readonly module: string;
  /** The repeating record it belongs to, if any. */
  readonly group?: string;
  /** The field holding the text for an "Other" choice, if this field offers one. */
  readonly otherDetailKey?: string;
  readonly role?: FieldRole;
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

/** Sections a person can open or close. Internal plumbing sections are never offered. */
export const OPENABLE_MODULE_KEYS: ReadonlySet<string> = new Set(
  CATALOGUE_MODULES.filter((module) => !module.internal).map((module) => module.key),
);

export function isOpenableModuleKey(key: string): boolean {
  return OPENABLE_MODULE_KEYS.has(key);
}

/** Repeating records a person can mark "none" (addresses, visas, and so on). */
export const RECORD_GROUP_KEYS: ReadonlySet<string> = new Set(
  MODULE_FIELDS.flatMap((field) => (field.group ? [field.group] : [])),
);

export function isKnownRecordGroupKey(key: string): boolean {
  return RECORD_GROUP_KEYS.has(key);
}

/** A field the admin screens may name, for pick-lists. Live fields come first. */
export interface KnownFieldOption {
  readonly key: string;
  readonly label: string;
}

/** Every real field a rule or a requirement can name, with a readable label. Other boxes are left out. */
export function knownFieldOptions(): readonly KnownFieldOption[] {
  return [
    ...LEGACY_FIELD_SNAPSHOT.map((field) => ({ key: field.key, label: field.label })),
    ...CATALOGUE_FIELDS.filter((field) => !field.role).map((field) => ({
      key: field.key,
      label: field.label,
    })),
  ];
}
