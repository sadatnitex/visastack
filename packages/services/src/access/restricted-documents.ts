import { resolveDocumentType } from '@visastack/core/catalogue/documents';
import { type Db, schema } from '../db';

/**
 * The restricted-document rule as data: which documents need a recent
 * identity confirmation (a step-up) before anyone previews or downloads them.
 * The built-in defaults are the lists in require-access.ts
 * (`DEFAULT_DOCUMENT_PROTECTION`); platform admins can switch any part of the
 * rule on or off (document-protection.ts), and `requireAccess` decides with
 * the effective settings: the defaults with the admins' switches applied.
 */

/** One admin switch, as stored: an absent switch means the default. */
export interface DocumentProtectionOverride {
  readonly scope: 'CATEGORY' | 'DOCUMENT_TYPE' | 'UNKNOWN_TYPE';
  readonly key: string;
  readonly restricted: boolean;
}

/** The rule `requireAccess` applies. */
export interface DocumentProtectionSettings {
  /** Catalogue categories (document group, or sharing pack) whose types are restricted. */
  readonly restrictedCategories: ReadonlySet<string>;
  /** Types restricted whatever their category says (a default, or switched on). */
  readonly restrictedTypes: ReadonlySet<string>;
  /** Types an admin switched off one by one: not restricted, whatever their category says. */
  readonly unrestrictedTypes: ReadonlySet<string>;
  /** Whether a document whose type is not known yet is restricted. */
  readonly unknownTypesRestricted: boolean;
}

/**
 * Applies admin switches to `defaults`. A document type switch beats its
 * category, so an admin can make one exception either way. Later entries for
 * the same switch win (the table holds one row per switch anyway).
 */
export function applyDocumentProtectionOverrides(
  defaults: DocumentProtectionSettings,
  overrides: readonly DocumentProtectionOverride[],
): DocumentProtectionSettings {
  const categories = new Set(defaults.restrictedCategories);
  const restrictedTypes = new Set(defaults.restrictedTypes);
  const unrestrictedTypes = new Set(defaults.unrestrictedTypes);
  let unknownTypesRestricted = defaults.unknownTypesRestricted;
  for (const override of overrides) {
    switch (override.scope) {
      case 'CATEGORY':
        if (override.restricted) categories.add(override.key);
        else categories.delete(override.key);
        break;
      case 'DOCUMENT_TYPE':
        if (override.restricted) {
          restrictedTypes.add(override.key);
          unrestrictedTypes.delete(override.key);
        } else {
          restrictedTypes.delete(override.key);
          unrestrictedTypes.add(override.key);
        }
        break;
      case 'UNKNOWN_TYPE':
        unknownTypesRestricted = override.restricted;
        break;
    }
  }
  return Object.freeze({
    restrictedCategories: categories,
    restrictedTypes,
    unrestrictedTypes,
    unknownTypesRestricted,
  });
}

/**
 * Whether a document of this type needs a step-up under `settings`. A type
 * that is missing or not in the catalogue follows the unknown-type switch.
 * Matched on the catalogue's standard key, so an alias follows its type.
 */
export function documentTypeRestricted(
  docType: string | null,
  settings: DocumentProtectionSettings,
): boolean {
  if (!docType) return settings.unknownTypesRestricted;
  const known = resolveDocumentType(docType);
  if (!known) return settings.unknownTypesRestricted;
  if (settings.restrictedTypes.has(known.key)) return true;
  if (settings.unrestrictedTypes.has(known.key)) return false;
  return [known.pack, known.group].some(
    (category) => typeof category === 'string' && settings.restrictedCategories.has(category),
  );
}

/** Every stored admin switch. Throws if the read fails. */
export async function readDocumentProtectionOverrides(
  db: Db,
): Promise<DocumentProtectionOverride[]> {
  const rows = await db
    .select({
      scope: schema.documentProtectionSettings.scope,
      key: schema.documentProtectionSettings.key,
      restricted: schema.documentProtectionSettings.restricted,
    })
    .from(schema.documentProtectionSettings);
  return rows;
}

/**
 * The effective rule, read inside the caller's transaction. The read runs in
 * its own savepoint, so a failure cannot spoil the caller's transaction, and
 * a failure falls back to `defaults` (fail closed: never "nothing is
 * restricted").
 */
export async function loadDocumentProtectionSettings(
  tx: Db,
  defaults: DocumentProtectionSettings,
): Promise<DocumentProtectionSettings> {
  try {
    const overrides = await tx.transaction(async (inner) => readDocumentProtectionOverrides(inner));
    return applyDocumentProtectionOverrides(defaults, overrides);
  } catch {
    return defaults;
  }
}
