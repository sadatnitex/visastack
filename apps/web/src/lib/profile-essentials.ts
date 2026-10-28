/**
 * Essentials First: the short list of profile details most visa forms ask for first. A new person
 * starts here instead of facing every section at once; everything else stays one click away behind
 * "Show All Sections".
 *
 * This is the only place the list is defined. The profile screen, its progress ("4 of 12
 * essentials") and the traveller overview all read it through `essentialsOf` in master-profile.ts,
 * and a test pins that every entry is a live detail in a section that is open for everyone, so each
 * one can always be filled in.
 *
 * How it was chosen: the identity and passport details application forms start with (every
 * detail of a case's identity basics, plus the passport number and dates; most of them are also
 * suggested from a passport's machine-readable lines), then the contact details and the home
 * address that forms ask for next. Order follows the order forms usually use.
 */

export interface ProfileEssential {
  /** A live field key, or for a repeating record (`record`), the record's group key. */
  readonly key: string;
  readonly kind: 'field' | 'record';
  /** A name for the essential when it differs from the field's own label. */
  readonly label?: string;
  /** One short line on what to enter, when the field name alone is not enough. */
  readonly hint?: string;
}

export const PROFILE_ESSENTIALS: readonly ProfileEssential[] = [
  { key: 'given_name', kind: 'field', hint: 'As printed on your passport.' },
  { key: 'family_name', kind: 'field', hint: 'As printed on your passport.' },
  { key: 'date_of_birth', kind: 'field' },
  { key: 'sex', kind: 'field' },
  { key: 'place_of_birth', kind: 'field' },
  { key: 'nationality', kind: 'field' },
  { key: 'passport_number', kind: 'field' },
  { key: 'passport_issue_date', kind: 'field' },
  { key: 'passport_expiry', kind: 'field' },
  { key: 'email', kind: 'field' },
  { key: 'phone', kind: 'field' },
  {
    key: 'address',
    kind: 'record',
    label: 'Home Address',
    hint: 'Where you live now. Earlier addresses can wait.',
  },
];
