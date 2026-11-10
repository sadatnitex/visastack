import {
  CATALOGUE_FIELDS,
  CATALOGUE_MODULES,
  REQUEST_CONTEXT,
  REQUEST_SYNONYMS,
} from '@visastack/core/catalogue';
import { evidenceDocumentGroups, evidenceFieldGroups } from './master-profile';
import {
  type RequestPicker,
  type RequestPickerGroup,
  type RequestPickerItem,
  pickerItemId,
} from './request-picker-types';
import { toTitleCase } from './title-case';

/**
 * The list an agency picks from when it asks a traveller for documents and details, built once on
 * the server from the catalogue and sent to the browser as plain, compact data (the catalogue
 * itself never ships). Every item is one real document type or detail; documents come first.
 *
 * An item is `[id, label, hint, searchWords]`:
 * - `id` is `DOCUMENT:KEY` or `FIELD:key` (what the form sends back, and what the server checks);
 * - `hint` is filled only where two items share one label (for example Date of Birth for the
 *   traveller and for a dependant), so the screen can tell them apart in plain words;
 * - `searchWords` are the plain names people use (see request-synonyms), `|` between them.
 */

/** The name of the section a detail sits in; the plain fallback for a context line. */
const MODULE_LABEL: ReadonlyMap<string, string> = new Map(
  CATALOGUE_MODULES.map((module) => [module.key, module.label] as const),
);
const LIVE_MODULE_LABEL: ReadonlyMap<string, string> = new Map(
  CATALOGUE_MODULES.flatMap((module) =>
    (module.legacyFields ?? []).map((key) => [key, module.label] as const),
  ),
);

/**
 * The plain context line for a detail whose name is shared: the explicit wording first, then the
 * record it belongs to (Family Member), then the block it sits in, then its section.
 */
const FIELD_CONTEXT_BY_KEY: ReadonlyMap<string, string> = new Map([
  ...[...LIVE_MODULE_LABEL].map(([key, label]) => [key, label] as const),
  ...CATALOGUE_FIELDS.flatMap((field) => {
    const context = field.groupLabel ?? field.sectionLabel ?? MODULE_LABEL.get(field.module);
    return context ? [[field.key, context] as const] : [];
  }),
]);

const SEARCH_WORDS: ReadonlyMap<string, string> = new Map(
  REQUEST_SYNONYMS.map((entry) => [`${entry.kind}:${entry.key}`, entry.terms.join('|')] as const),
);

/** The name as the picker shows it: Title Case, whatever case the catalogue wrote it in. */
const named = (label: string) => toTitleCase(label.trim());
/** An item with its empty trailing parts left off. */
function item(key: string, label: string, hint: string, words: string): RequestPickerItem {
  if (words !== '') return [key, label, hint, words];
  return hint !== '' ? [key, label, hint] : [key, label];
}

const sameLabel = (label: string) => named(label).toLowerCase();

function build(): RequestPicker {
  const documents = evidenceDocumentGroups();
  const fields = evidenceFieldGroups();

  const uses = new Map<string, number>();
  for (const group of [...documents, ...fields]) {
    for (const choice of group.choices) {
      const label = sameLabel(choice.label);
      uses.set(label, (uses.get(label) ?? 0) + 1);
    }
  }
  const shared = (label: string) => (uses.get(sameLabel(label)) ?? 0) > 1;

  const groups: RequestPickerGroup[] = [
    ...documents.map((group) => ({
      id: `DOCUMENT:${group.key}`,
      label: named(group.label),
      kind: 'DOCUMENT' as const,
      items: group.choices.map((choice) =>
        item(
          choice.key,
          named(choice.label),
          shared(choice.label) ? named(group.label) : '',
          SEARCH_WORDS.get(`DOCUMENT:${choice.key}`) ?? '',
        ),
      ),
    })),
    ...fields.map((group) => ({
      id: `FIELD:${group.key}`,
      label: named(group.label),
      kind: 'FIELD' as const,
      items: group.choices.map((choice) =>
        item(
          choice.key,
          named(choice.label),
          shared(choice.label)
            ? named(REQUEST_CONTEXT[choice.key] ?? FIELD_CONTEXT_BY_KEY.get(choice.key) ?? '')
            : '',
          SEARCH_WORDS.get(`FIELD:${choice.key}`) ?? '',
        ),
      ),
    })),
  ];
  return { groups };
}

let built: RequestPicker | undefined;

/** The picker data. The catalogue is fixed for the life of the process, so it is built once. */
export function buildRequestPicker(): RequestPicker {
  built ??= build();
  return built;
}

/** Every item by id, for the code that turns pack requirements into picker rows. */
export function requestPickerIndex(
  picker: RequestPicker,
): ReadonlyMap<string, { readonly label: string; readonly hint: string }> {
  return new Map(
    picker.groups.flatMap((group) =>
      group.items.map(
        (entry) =>
          [pickerItemId(group.kind, entry), { label: entry[1], hint: entry[2] ?? '' }] as const,
      ),
    ),
  );
}
