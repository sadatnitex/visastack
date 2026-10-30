import { CATALOGUE_FIELDS } from './fields';
import { LEGACY_FIELD_SNAPSHOT } from './legacy';
import type { FieldDataType, FieldSensitivity } from './types';

/**
 * The one shape a saved field gets in the field registry, whoever saves it first: the profile
 * editor, a section's extra items, an AI reading, or an AI app's suggestion (S21). Field
 * definitions are registered lazily and the first writer wins, so every writer must build the
 * same entry, or a field's protection, pack or repeating flag would depend on where it was first
 * saved. Live fields come first, then the catalogue; a live key is never redefined by the
 * catalogue.
 */
export interface SavableFieldDefinition {
  readonly key: string;
  readonly label: string;
  readonly sensitivity: FieldSensitivity;
  readonly type: FieldDataType;
  readonly repeating: boolean;
  readonly packId: string;
}

/** What the field registry stores for a field (see `SavableFieldDefinition`). */
export interface FieldRegistryInput {
  readonly key: string;
  readonly dataType: 'date' | 'string';
  readonly sensitivity: FieldSensitivity;
  readonly repeating: boolean;
  readonly packId: string;
}

const LIVE_BY_KEY = new Map(LEGACY_FIELD_SNAPSHOT.map((field) => [field.key, field] as const));
const ADDED_BY_KEY = new Map(CATALOGUE_FIELDS.map((field) => [field.key, field] as const));

/** Any savable field, live or added by the catalogue, or undefined for an unknown key. */
export function savableFieldDefinition(key: string): SavableFieldDefinition | undefined {
  const field = LIVE_BY_KEY.get(key) ?? ADDED_BY_KEY.get(key);
  if (!field) return undefined;
  return {
    key: field.key,
    label: field.label,
    sensitivity: field.sensitivity,
    type: field.type === 'date' ? 'date' : 'text',
    repeating: field.group !== undefined,
    packId: field.pack,
  };
}

/** The registry entry for a savable field, or undefined for an unknown key. */
export function fieldRegistryInput(key: string): FieldRegistryInput | undefined {
  const field = savableFieldDefinition(key);
  return field ? fieldRegistryInputOf(field) : undefined;
}

/** The registry entry for a field already looked up with `savableFieldDefinition`. */
export function fieldRegistryInputOf(field: SavableFieldDefinition): FieldRegistryInput {
  return {
    key: field.key,
    dataType: field.type === 'date' ? 'date' : 'string',
    sensitivity: field.sensitivity,
    repeating: field.repeating,
    packId: field.packId,
  };
}
