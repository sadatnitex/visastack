/**
 * Country entry and visa-route facts for Bangladeshi ordinary-passport holders.
 *
 * The data is used as the owner supplied it. Every fact carries the page it came from and the date it was
 * checked, so a screen can always show "Source" and "Checked on". A country with no stated entry status
 * has not been researched yet and must be shown as such, never as "no visa needed".
 */
export type EntryStatus =
  | 'VISA_FREE'
  | 'VISA_ON_ARRIVAL'
  | 'ETA'
  | 'E_VISA'
  | 'VISA_REQUIRED'
  | 'NOT_FOUND';

export type DestinationSource = {
  readonly url: string;
  readonly title: string | null;
  readonly publisher: string | null;
  readonly type: string | null;
  readonly language: string | null;
  /** Date the page was checked, YYYY-MM-DD. */
  readonly checkedOn: string | null;
  readonly exactWords: string | null;
  readonly translation: string | null;
  readonly where: string | null;
  readonly confidence: string | null;
  /** The sheet's own flag that a person should look at this fact again. */
  readonly needsCheck: boolean;
  readonly note: string | null;
};

export type Money = { readonly amount: number; readonly currency: string };

export type DestinationRequirement = {
  readonly kind: string;
  readonly text: string;
  readonly optional: boolean;
  readonly onlyWhen: string | null;
  readonly maxAgeDays: number | null;
  readonly source: DestinationSource | null;
};

export type DestinationRoute = {
  readonly key: string;
  readonly country: string;
  readonly issuingNote: string | null;
  readonly name: string;
  readonly code: string | null;
  readonly purpose: string;
  readonly description: string | null;
  readonly appliesTo: string | null;
  readonly appliesFrom: string | null;
  readonly rulesTakeEffectOn: string | null;
  readonly fee: Money | null;
  readonly channelName: string | null;
  readonly channelUrl: string | null;
  readonly fraudReportingUrl: string | null;
  readonly source: DestinationSource | null;
  readonly requirements: readonly DestinationRequirement[];
};

export type Destination = {
  readonly country: string;
  readonly iso2: string;
  /** False when the sheet holds only an official link and no stated facts yet. */
  readonly researched: boolean;
  readonly entryStatus: EntryStatus;
  readonly maximumStayDays: number | null;
  readonly stayPeriodRule: string | null;
  readonly passportValidityRule: string | null;
  readonly howToApply: string | null;
  readonly applyUrl: string | null;
  readonly bangladeshLocation: string | null;
  readonly fee: Money | null;
  readonly routeTypes: readonly string[];
  readonly source: DestinationSource | null;
};

export type DestinationBatch = {
  readonly batch: string;
  readonly countries: readonly Destination[];
  readonly routes: readonly DestinationRoute[];
};
