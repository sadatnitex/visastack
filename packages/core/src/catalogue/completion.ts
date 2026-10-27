import { CATALOGUE_MODULES } from './modules';
import { MODULE_FIELDS, type ModuleField } from './queries';
import { OTHER_OPTION } from './types';

/**
 * Profile completion, as the owner specified it (2026-10-14):
 *
 * - Only fields in OPEN sections count. A section is open when it is open by default, when the
 *   person ticked it, or when it already holds a saved value (so nothing entered is ever hidden).
 * - Opening a section adds its fields to the calculation at once. A person who has opened nothing is
 *   measured against the default sections only, so they can reach 100% without touching the rest.
 * - A field counts once. For a repeating record (addresses, visas) a field is answered when any
 *   record has a value for it, and the whole record is answered when the person says there is none.
 * - A field the person marks "does not apply" is answered.
 * - A choice set to "Other" is answered only once the text that goes with it is filled.
 * - "Other" text boxes and Other Items are optional by nature and never count.
 *
 * This is a pure function: callers pass what they loaded. It reads no database and decides nothing
 * about who may see a value.
 */
export interface CompletionInput {
  /** Sections the person opened on purpose. */
  readonly activated: ReadonlySet<string>;
  /** Every saved, non-empty, trimmed value of each field, one entry per record. */
  readonly values: Readonly<Record<string, readonly string[]>>;
  /** Field keys the person marked "does not apply". */
  readonly notApplicable?: ReadonlySet<string>;
  /** Repeating records the person marked "none". */
  readonly noneDeclared?: ReadonlySet<string>;
}

export type OpenReason = 'default' | 'opened' | 'has_data' | 'locked';

export interface ModuleCompletion {
  readonly key: string;
  readonly label: string;
  readonly open: boolean;
  readonly reason: OpenReason;
  readonly answered: number;
  readonly total: number;
}

export interface CompletionResult {
  /** Whole percent, 0 to 100. */
  readonly percent: number;
  readonly answered: number;
  readonly total: number;
  readonly modules: readonly ModuleCompletion[];
}

const hasValue = (values: Readonly<Record<string, readonly string[]>>, key: string): boolean =>
  (values[key]?.length ?? 0) > 0;

/**
 * Whether one field counts as answered, by the rules above. Exported so a screen that singles out a
 * few fields (the profile's Essentials First list) judges them exactly as completion does.
 */
export function isFieldAnswered(field: ModuleField, input: CompletionInput): boolean {
  if (input.notApplicable?.has(field.key)) return true;
  if (field.group && input.noneDeclared?.has(field.group)) return true;
  const own = input.values[field.key] ?? [];
  if (own.length === 0) return false;
  if (!field.otherDetailKey) return true;
  // "Other" alone is not an answer: it needs the words that say what the other thing is.
  return (
    own.some((value) => value !== OTHER_OPTION) || hasValue(input.values, field.otherDetailKey)
  );
}

const OTHER_ITEM_SECTION = /^other_item_[a-z_]+_section$/;

export function computeCompletion(input: CompletionInput): CompletionResult {
  const byModule = new Map<string, ModuleField[]>();
  for (const field of MODULE_FIELDS) {
    byModule.set(field.module, [...(byModule.get(field.module) ?? []), field]);
  }

  // Sections named by an Other Item are open too: the person wrote something inside them.
  const namedByOtherItem = new Set<string>();
  for (const [key, values] of Object.entries(input.values)) {
    if (OTHER_ITEM_SECTION.test(key)) for (const value of values) namedByOtherItem.add(value);
  }

  let answered = 0;
  let total = 0;
  const modules: ModuleCompletion[] = [];
  for (const module of CATALOGUE_MODULES) {
    if (module.internal) continue;
    const fields = byModule.get(module.key) ?? [];
    const hasData = fields.some((field) => hasValue(input.values, field.key));
    const reason: OpenReason = module.defaultOpen
      ? 'default'
      : input.activated.has(module.key)
        ? 'opened'
        : hasData || namedByOtherItem.has(module.key)
          ? 'has_data'
          : 'locked';
    const open = reason !== 'locked';
    const counted = fields.filter((field) => !field.role);
    const done = open ? counted.filter((field) => isFieldAnswered(field, input)).length : 0;
    modules.push({
      key: module.key,
      label: module.label,
      open,
      reason,
      answered: done,
      total: open ? counted.length : 0,
    });
    answered += done;
    total += open ? counted.length : 0;
  }
  return {
    percent: total === 0 ? 0 : Math.round((100 * answered) / total),
    answered,
    total,
    modules,
  };
}
