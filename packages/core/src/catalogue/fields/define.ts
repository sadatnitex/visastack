import { LEGACY_CURRENCY_CODES } from '../legacy';
import {
  type CatalogueField,
  type CataloguePack,
  type CountryScope,
  type FieldDataType,
  type FieldKind,
  type FieldRole,
  type LayerKey,
  OTHER_OPTION,
  PROTECTION_FLOOR,
  type Provenance,
  type PurposeFamilyKey,
} from '../types';

/**
 * A tiny, typed way to write the field catalogue. One row is one field:
 * [key suffix, label, data type, kind, options].
 *
 * Protection is NOT written per field. It follows from the kind (see PROTECTION_FLOOR), so a
 * national identifier is always RESTRICTED and a guard test proves no field can be lower than its
 * kind allows.
 */
export type FieldRow = readonly [
  suffix: string,
  label: string,
  type: FieldDataType,
  kind: FieldKind,
  options?: readonly string[],
];

export const YES_NO: readonly string[] = ['Yes', 'No'];
export const CURRENCY_CODES: readonly string[] = LEGACY_CURRENCY_CODES;

export const text = (suffix: string, label: string, kind: FieldKind = 'general'): FieldRow => [
  suffix,
  label,
  'text',
  kind,
];

export const date = (suffix: string, label: string, kind: FieldKind = 'general'): FieldRow => [
  suffix,
  label,
  'date',
  kind,
];

export const choice = (
  suffix: string,
  label: string,
  options: readonly string[],
  kind: FieldKind = 'general',
): FieldRow => [suffix, label, 'text', kind, options];

export const yesNo = (suffix: string, label: string, kind: FieldKind = 'general'): FieldRow =>
  choice(suffix, label, YES_NO, kind);

/** A decimal amount and its ISO currency code, as two fields (PRO-01 "decimal + ISO currency"). */
export const money = (
  amountSuffix: string,
  amountLabel: string,
  currencySuffix: string,
  currencyLabel: string,
): readonly FieldRow[] => [
  text(amountSuffix, amountLabel, 'amount'),
  choice(currencySuffix, currencyLabel, CURRENCY_CODES),
];

export interface FieldBlock {
  readonly layer: LayerKey;
  readonly pack: CataloguePack;
  readonly origin: Provenance;
  readonly sourceRef: string;
  readonly appliesTo?: 'all' | readonly PurposeFamilyKey[];
  readonly countries?: readonly CountryScope[];
  /** Added to every row's suffix as "<prefix>_<suffix>". Empty means the suffix is the whole key. */
  readonly prefix?: string;
  /**
   * A repeating record. New records need a label. A record that already exists today (for example
   * prior_visa) is extended by key only and keeps its live label.
   */
  readonly group?: { readonly key: string; readonly label?: string };
  /** A named block of single fields, for layout only. */
  readonly section?: { readonly key: string; readonly label: string };
  /** Marks every row as part of the "Other" mechanism, so none of it counts toward completion. */
  readonly role?: FieldRole;
  readonly rows: readonly (FieldRow | readonly FieldRow[])[];
}

function isRowList(value: FieldRow | readonly FieldRow[]): value is readonly FieldRow[] {
  return Array.isArray(value[0]);
}

/** A field before it is placed in a module. */
export type UnplacedField = Omit<CatalogueField, 'module'>;

const ONLY_YES_NO = (options: readonly string[]): boolean =>
  options.length === 2 && options.includes('Yes') && options.includes('No');

/** Kinds that carry over to the free-text box beside an "Other" choice, so it is as protected as its parent. */
const COMPANION_KIND_KEEPS = new Set<FieldKind>([
  'identifier',
  'national_identifier',
  'health_admin',
  'health_detail',
  'legal_history',
  'special_category',
  'biometric',
]);

export function buildFields(blocks: readonly FieldBlock[]): readonly UnplacedField[] {
  const out: UnplacedField[] = [];
  for (const block of blocks) {
    const rows = block.rows.flatMap((entry): readonly FieldRow[] =>
      isRowList(entry) ? entry : [entry as FieldRow],
    );
    const place = (
      suffix: string,
      label: string,
      type: FieldDataType,
      kind: FieldKind,
      options: readonly string[] | undefined,
      extra: { readonly role?: UnplacedField['role']; readonly allowOther?: boolean } = {},
    ): UnplacedField => ({
      key: block.prefix ? `${block.prefix}_${suffix}` : suffix,
      label,
      type,
      kind,
      sensitivity: PROTECTION_FLOOR[kind],
      pack: block.pack,
      layer: block.layer,
      ...(block.group ? { group: block.group.key } : {}),
      ...(block.group?.label ? { groupLabel: block.group.label } : {}),
      ...(block.section ? { section: block.section.key, sectionLabel: block.section.label } : {}),
      ...(options ? { options } : {}),
      appliesTo: block.appliesTo ?? 'all',
      ...(block.countries ? { countries: block.countries } : {}),
      origin: block.origin,
      sourceRef: block.sourceRef,
      ...(extra.role ? { role: extra.role } : {}),
      ...(extra.allowOther ? { allowOther: true } : {}),
    });
    for (const [suffix, label, type, kind, options] of rows) {
      // Every real choice ends with "Other", with a text box that opens beside it.
      const wantsOther = options !== undefined && !ONLY_YES_NO(options);
      const finalOptions =
        wantsOther && options
          ? [...options.filter((option) => option !== OTHER_OPTION), OTHER_OPTION]
          : options;
      out.push(
        place(suffix, label, type, kind, finalOptions, {
          ...(wantsOther ? { allowOther: true } : {}),
          ...(block.role ? { role: block.role } : {}),
        }),
      );
      if (wantsOther) {
        out.push(
          place(
            `${suffix}_other`,
            `Other ${label}`,
            'text',
            COMPANION_KIND_KEEPS.has(kind) ? kind : 'general',
            undefined,
            { role: 'other_detail' },
          ),
        );
      }
    }
  }
  return out;
}
