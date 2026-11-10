/**
 * The shapes the asking picker draws from (plain data, safe to send to the browser). Built on the
 * server by `request-picker.ts` and `missing-for-case.ts`.
 */

/**
 * `[key, label, hint?, searchWords?]`: the catalogue key (the item's id is `<group kind>:<key>`),
 * its plain name, a context line only where the name is shared, and the plain names people search
 * by (`|` between them). Trailing empty parts are left off to keep the page light.
 */
export type RequestPickerItem = readonly [
  key: string,
  label: string,
  hint?: string,
  searchWords?: string,
];

/** What the form sends for one item, and what the server checks: `DOCUMENT:KEY` or `FIELD:key`. */
export function pickerItemId(kind: 'DOCUMENT' | 'FIELD', item: RequestPickerItem): string {
  return `${kind}:${item[0]}`;
}

export interface RequestPickerGroup {
  /** `DOCUMENT:<group key>` or `FIELD:<group key>`. */
  readonly id: string;
  readonly label: string;
  readonly kind: 'DOCUMENT' | 'FIELD';
  readonly items: readonly RequestPickerItem[];
}

export interface RequestPicker {
  /** Documents first, then details. */
  readonly groups: readonly RequestPickerGroup[];
}

/** Why a checklist item shows in "Missing for This Case" and whether it starts ticked. */
export type MissingState =
  | 'ask'
  | 'alternative'
  | 'optional'
  | 'conflict'
  | 'stale'
  | 'asked'
  | 'unlisted';

export interface MissingRow {
  /** The picker item id; empty when the checklist names something the list does not have. */
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly state: MissingState;
}

/** The checklist items the traveller has not provided yet, for one case. */
export interface MissingForCase {
  /** One row per missing item. */
  readonly rows: readonly MissingRow[];
  /** Items where any one of several is enough: never ticked for the agency. */
  readonly anyOf: readonly (readonly MissingRow[])[];
}

/** The most items one send may carry. The service holds the same number (a test keeps them equal). */
export const MAX_ASK_ITEMS = 25;

/** The ids that start ticked: required items never provided and not already asked. */
export function preticked(missing: MissingForCase | null): readonly string[] {
  return missing === null ? [] : missing.rows.filter((r) => r.state === 'ask').map((r) => r.id);
}
