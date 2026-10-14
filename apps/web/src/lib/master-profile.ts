import {
  CATALOGUE_DOCUMENTS,
  CATALOGUE_DOCUMENT_GROUPS,
  CATALOGUE_FIELDS,
  CATALOGUE_LAYERS,
  CATALOGUE_MODULES,
  CATALOGUE_PURPOSE_FAMILIES,
  MODULE_FIELDS,
  type ModuleField,
  OTHER_OPTION,
  PROPOSED_PACKS,
  computeCompletion,
  knownFieldOptions,
} from '@visastack/core/catalogue';
import type {
  ChoiceGroup,
  EditorFieldDef,
  EditorGroup,
  EditorLayer,
  EditorSection,
  MasterProfileView,
} from './master-profile-types';
import { PACK_LABELS, PROFILE_FIELDS } from './profile-fields';

/**
 * Server-side only. Builds the sections of the profile screen from the catalogue, what the person
 * has saved, and what they have opened or marked as not applying. The catalogue is large, so nothing
 * in this file may be imported by browser code: the screen receives the plain result instead.
 */

const LIVE_BY_KEY = new Map(PROFILE_FIELDS.map((field) => [field.key, field] as const));
const CATALOGUE_BY_KEY = new Map(CATALOGUE_FIELDS.map((field) => [field.key, field] as const));

const FIELDS_BY_MODULE: ReadonlyMap<string, readonly ModuleField[]> = (() => {
  const byModule = new Map<string, ModuleField[]>();
  for (const field of MODULE_FIELDS) {
    byModule.set(field.module, [...(byModule.get(field.module) ?? []), field]);
  }
  return byModule;
})();

/** A field's label and shape, whether it is one of the live fields or one the catalogue added. */
function resolveBase(key: string): EditorFieldDef | undefined {
  const live = LIVE_BY_KEY.get(key);
  if (live) {
    return {
      key: live.key,
      label: live.label,
      sensitivity: live.sensitivity,
      ...(live.type ? { type: live.type } : {}),
      ...(live.placeholder ? { placeholder: live.placeholder } : {}),
      ...(live.options ? { options: live.options } : {}),
    };
  }
  const added = CATALOGUE_BY_KEY.get(key);
  if (!added) return undefined;
  return {
    key: added.key,
    label: added.label,
    sensitivity: added.sensitivity,
    type: added.type,
    ...(added.options ? { options: added.options } : {}),
  };
}

function withOther(field: EditorFieldDef, otherDetailKey: string | undefined): EditorFieldDef {
  if (!otherDetailKey) return field;
  const detail = resolveBase(otherDetailKey);
  const options = field.options
    ? field.options.includes(OTHER_OPTION)
      ? field.options
      : [...field.options, OTHER_OPTION]
    : undefined;
  return {
    ...field,
    ...(options ? { options } : {}),
    ...(detail ? { otherDetail: detail } : {}),
  };
}

function resolveEditorField(field: ModuleField): EditorFieldDef | undefined {
  const base = resolveBase(field.key);
  return base ? withOther(base, field.otherDetailKey) : undefined;
}

function groupLabelOf(groupKey: string, fields: readonly ModuleField[]): string {
  for (const field of fields) {
    const live = LIVE_BY_KEY.get(field.key)?.groupLabel;
    if (live) return live;
    const added = CATALOGUE_BY_KEY.get(field.key)?.groupLabel;
    if (added) return added;
  }
  return groupKey;
}

/** A profile entry reduced to what completion needs. */
export interface ProfileEntryLite {
  readonly fieldKey: string;
  readonly value: string | null;
  readonly status: string | null;
}

export interface MasterProfileInput {
  readonly entries: readonly ProfileEntryLite[];
  /** Sections the person opened on purpose. */
  readonly activated: ReadonlySet<string>;
  readonly notApplicable: ReadonlySet<string>;
  readonly noneDeclared: ReadonlySet<string>;
  /** A purpose family chosen to see suggestions for, or null. */
  readonly suggestFor: string | null;
}

/**
 * Every saved, non-empty value of each field, one entry per record. A protected value whose text is
 * not returned still counts as saved: the fact exists, which is all completion needs to know.
 */
function savedValues(entries: readonly ProfileEntryLite[]): Record<string, string[]> {
  const values: Record<string, string[]> = {};
  for (const entry of entries) {
    const text = entry.value === null ? (entry.status ? '[protected]' : '') : entry.value.trim();
    if (text === '') continue;
    const list = values[entry.fieldKey] ?? [];
    list.push(text);
    values[entry.fieldKey] = list;
  }
  return values;
}

export interface SectionChoices {
  readonly activated: ReadonlySet<string>;
  readonly notApplicable: ReadonlySet<string>;
  readonly noneDeclared: ReadonlySet<string>;
}

/** The one completion number used everywhere: only open sections count, and opening one adds it at once. */
export function completionOf(
  entries: readonly ProfileEntryLite[],
  choices: SectionChoices,
): { readonly percent: number; readonly answered: number; readonly total: number } {
  const result = computeCompletion({
    activated: choices.activated,
    values: savedValues(entries),
    notApplicable: choices.notApplicable,
    noneDeclared: choices.noneDeclared,
  });
  return { percent: result.percent, answered: result.answered, total: result.total };
}

export function buildMasterProfileView(input: MasterProfileInput): MasterProfileView {
  const values = savedValues(input.entries);
  const completion = computeCompletion({
    activated: input.activated,
    values,
    notApplicable: input.notApplicable,
    noneDeclared: input.noneDeclared,
  });
  const completionByModule = new Map(
    completion.modules.map((entry) => [entry.key, entry] as const),
  );
  const familyKeys = new Set(CATALOGUE_PURPOSE_FAMILIES.map((family) => family.key as string));
  const suggestFor = input.suggestFor && familyKeys.has(input.suggestFor) ? input.suggestFor : null;

  let suggestedLockedCount = 0;
  const layers: EditorLayer[] = CATALOGUE_LAYERS.map((layer) => {
    const sections: EditorSection[] = [];
    for (const module of CATALOGUE_MODULES) {
      if (module.internal || module.layer !== layer.key) continue;
      const status = completionByModule.get(module.key);
      const open = status?.open ?? false;
      const reason = status?.reason ?? 'locked';
      const fields = FIELDS_BY_MODULE.get(module.key) ?? [];
      const counted = fields.filter((field) => !field.role);
      const hasData = counted.some((field) => (values[field.key]?.length ?? 0) > 0);
      const suggested =
        !open &&
        suggestFor !== null &&
        (module.suggestedFor ?? []).some((key) => key === suggestFor);
      if (suggested) suggestedLockedCount += 1;

      const singles: EditorFieldDef[] = [];
      const groupFields = new Map<string, ModuleField[]>();
      if (open) {
        for (const field of counted) {
          if (field.group) {
            groupFields.set(field.group, [...(groupFields.get(field.group) ?? []), field]);
            continue;
          }
          const resolved = resolveEditorField(field);
          if (resolved) singles.push(resolved);
        }
      }
      const groups: EditorGroup[] = [...groupFields.entries()].map(([groupKey, members]) => ({
        key: groupKey,
        label: groupLabelOf(groupKey, members),
        fields: members.flatMap((member) => resolveEditorField(member) ?? []),
        noneDeclared: input.noneDeclared.has(groupKey),
      }));
      const previewLabels = open
        ? []
        : counted.flatMap((field) => {
            const base = resolveBase(field.key);
            return base ? [base.label] : [];
          });

      const itemFieldKey = (suffix: string) => `other_item_${module.pack}_${suffix}`;
      const otherItemFields = ['title', 'details', 'date', 'note'].flatMap((suffix) => {
        const resolved = resolveBase(itemFieldKey(suffix));
        return resolved ? [resolved] : [];
      });

      sections.push({
        key: module.key,
        label: module.label,
        description: module.description,
        layer: module.layer,
        open,
        reason,
        canClose: reason === 'opened' && !hasData,
        ...(module.extends ? { extendsLabel: module.extends } : {}),
        suggested,
        detailCount: counted.length,
        answered: status?.answered ?? 0,
        total: status?.total ?? 0,
        singles,
        groups,
        notApplicable: counted.filter((f) => input.notApplicable.has(f.key)).map((f) => f.key),
        previewLabels,
        otherItem: {
          pack: module.pack,
          sectionFieldKey: itemFieldKey('section'),
          fields: otherItemFields,
        },
      });
    }
    return {
      key: layer.key,
      label: layer.label,
      description: layer.description,
      sections,
      openCount: sections.filter((section) => section.open).length,
    };
  });

  return {
    percent: completion.percent,
    answered: completion.answered,
    total: completion.total,
    openSections: completion.modules.filter((entry) => entry.open).length,
    totalSections: completion.modules.length,
    layers,
    families: CATALOGUE_PURPOSE_FAMILIES.map((family) => ({
      key: family.key,
      label: family.label,
    })),
    suggestedFamily: suggestFor,
    suggestedLockedCount,
  };
}

/** The plain name of any field, live or added, for pages that only need to name a saved detail. */
export function fieldLabel(key: string): string | undefined {
  return LIVE_BY_KEY.get(key)?.label ?? CATALOGUE_BY_KEY.get(key)?.label;
}

/** The shape a save needs for any field, live or added. Live definitions always win. */
export interface SavableField {
  readonly key: string;
  readonly label: string;
  readonly sensitivity: 'STANDARD' | 'SENSITIVE' | 'RESTRICTED';
  readonly type: 'text' | 'date';
  readonly repeating: boolean;
  readonly packId: string;
}

export function savableField(key: string): SavableField | undefined {
  const live = LIVE_BY_KEY.get(key);
  if (live) {
    return {
      key: live.key,
      label: live.label,
      sensitivity: live.sensitivity,
      type: live.type === 'date' ? 'date' : 'text',
      repeating: live.group !== undefined,
      packId: live.pack,
    };
  }
  const added = CATALOGUE_BY_KEY.get(key);
  if (!added) return undefined;
  return {
    key: added.key,
    label: added.label,
    sensitivity: added.sensitivity,
    type: added.type,
    repeating: added.group !== undefined,
    packId: added.pack,
  };
}

const NEW_CATEGORIES = new Map(
  PROPOSED_PACKS.map((pack) => [pack.key as string, pack.label] as const),
);

/** The plain name of a sharing category, live or new. An unknown name is shown as it is, never hidden. */
export function categoryLabel(key: string): string {
  return (PACK_LABELS as Readonly<Record<string, string>>)[key] ?? NEW_CATEGORIES.get(key) ?? key;
}

/**
 * New sharing categories (study, settle and so on) that already hold a saved detail for this person.
 * A grant screen offers only these, so nobody is shown a category with nothing in it.
 */
export function newCategoriesWithData(
  entries: readonly ProfileEntryLite[],
): readonly { readonly key: string; readonly label: string }[] {
  const found = new Set<string>();
  for (const entry of entries) {
    const hasValue = entry.value === null ? Boolean(entry.status) : entry.value.trim() !== '';
    if (!hasValue) continue;
    const pack = savableField(entry.fieldKey)?.packId;
    if (pack && NEW_CATEGORIES.has(pack)) found.add(pack);
  }
  return [...NEW_CATEGORIES.entries()]
    .filter(([key]) => found.has(key))
    .map(([key, label]) => ({ key, label }));
}

/**
 * Every detail an agency can ask for, grouped by the part of the profile it belongs to: the live details
 * and every one the catalogue added. Details that only exist to hold "Other" text are left out.
 */
export function evidenceFieldGroups(): readonly ChoiceGroup[] {
  const groups = new Map<string, { key: string; label: string }[]>();
  for (const option of knownFieldOptions()) {
    const pack = savableField(option.key)?.packId ?? 'universal';
    const list = groups.get(pack) ?? [];
    list.push({ key: option.key, label: fieldLabel(option.key) ?? option.label });
    groups.set(pack, list);
  }
  return [...groups.entries()].map(([pack, choices]) => ({
    key: pack,
    label: categoryLabel(pack),
    choices,
  }));
}

/** Every document type an agency can ask for, grouped as the catalogue groups them. "Other" types stay in. */
export function evidenceDocumentGroups(): readonly ChoiceGroup[] {
  return CATALOGUE_DOCUMENT_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    choices: CATALOGUE_DOCUMENTS.filter((document) => document.group === group.key).map(
      (document) => ({ key: document.key, label: document.label }),
    ),
  })).filter((group) => group.choices.length > 0);
}
