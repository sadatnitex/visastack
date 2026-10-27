import {
  DESTINATIONS,
  type Destination,
  type DestinationSource,
  type EntryStatus,
  type Money,
} from '@visastack/core/destinations';

/** What each entry status means for a traveller, in plain words. */
export const ENTRY_LABEL: Readonly<Record<EntryStatus, string>> = {
  VISA_REQUIRED: 'Visa Needed Before You Travel',
  E_VISA: 'Online Visa (E-Visa)',
  VISA_ON_ARRIVAL: 'Visa on Arrival',
  ETA: 'Online Travel Permission (eTA)',
  VISA_FREE: 'No Visa Needed',
  NOT_FOUND: 'Not Yet Researched',
};

/** The shorter name used on filter buttons. */
export const ENTRY_SHORT_LABEL: Readonly<Record<EntryStatus, string>> = {
  VISA_REQUIRED: 'Visa Needed',
  E_VISA: 'E-Visa',
  VISA_ON_ARRIVAL: 'Visa on Arrival',
  ETA: 'eTA',
  VISA_FREE: 'No Visa Needed',
  NOT_FOUND: 'Not Yet Researched',
};

export const ENTRY_ORDER: readonly EntryStatus[] = [
  'VISA_REQUIRED',
  'E_VISA',
  'VISA_ON_ARRIVAL',
  'ETA',
  'VISA_FREE',
  'NOT_FOUND',
];

export function isEntryStatus(value: string): value is EntryStatus {
  return (ENTRY_ORDER as readonly string[]).includes(value);
}

/** True when the page behind a fact is not an official one (a government, embassy or application centre). */
export function isUnofficial(source: DestinationSource | null): boolean {
  return source !== null && source.type === 'other';
}

/** True when a person should look at a fact again before relying on it. */
export function needsChecking(source: DestinationSource | null): boolean {
  return source !== null && (source.needsCheck || source.confidence === 'LOW');
}

/** The warnings to show beside a fact, most important first. Empty when there is nothing to warn about. */
export function trustNotes(source: DestinationSource | null): readonly string[] {
  if (source === null) return ['No source is given for this.'];
  const notes: string[] = [];
  if (isUnofficial(source)) notes.push('Not from an official page.');
  if (needsChecking(source)) notes.push('Needs checking before you rely on it.');
  return notes;
}

/** "Checked on 14 Oct 2026", or "Check date not given". The same words for everyone, whatever their device language. */
export function checkedOnLabel(source: DestinationSource | null): string {
  if (!source?.checkedOn) return 'Check date not given';
  const day = new Date(source.checkedOn).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return `Checked on ${day}`;
}

/** An amount with its currency, such as "BDT 22,450", or null when none is given. */
export function moneyLabel(fee: Money | null): string | null {
  if (fee === null) return null;
  return `${fee.currency} ${fee.amount.toLocaleString('en-US')}`;
}

/** How long a stay the rule allows, for example "Up to 90 days". */
export function stayLabel(days: number | null): string | null {
  return days === null ? null : `Up to ${days} days`;
}

/** A route's list is not a full checklist unless it has at least this many items; say so rather than imply it is complete. */
export const THIN_LIST = 5;

/** The slim record the country list needs. Small on purpose: the full data stays on the server. */
export interface CountryListItem {
  readonly iso2: string;
  readonly name: string;
  readonly status: EntryStatus;
  readonly stay: string | null;
  readonly fee: string | null;
  readonly unconfirmed: boolean;
}

export function countryListItem(destination: Destination): CountryListItem {
  return {
    iso2: destination.iso2,
    name: destination.country,
    status: destination.entryStatus,
    stay: stayLabel(destination.maximumStayDays),
    fee: moneyLabel(destination.fee),
    unconfirmed:
      destination.researched &&
      (needsChecking(destination.source) || isUnofficial(destination.source)),
  };
}

export function countryListItems(): readonly CountryListItem[] {
  return [...DESTINATIONS].sort((a, b) => a.country.localeCompare(b.country)).map(countryListItem);
}
