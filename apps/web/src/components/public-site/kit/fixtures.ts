import type { CaseRow } from './cases-table';
import type { ChecklistCountry, ChecklistItem } from './country-checklist-panel';
import type { JourneyStage } from './journey-track';
import type { ScanField } from './scan-phone';

/**
 * One example of every state each kit part takes: plain data, no markup. The unit tests render the
 * parts from these, and the Home page reads the same lists, so what a part shows in a test is what
 * a page shows. Every name, date and count here is made up.
 */

export const FIXTURE_FIELDS: readonly ScanField[] = [
  { label: 'Surname', value: 'Rahman' },
  { label: 'Passport Ends', value: '14 Mar 2031' },
  { label: 'Nationality', value: 'Bangladeshi' },
];

export const FIXTURE_ITEMS: readonly ChecklistItem[] = [
  { kind: 'passport', label: 'Passport' },
  { kind: 'photo', label: 'Photo' },
  { kind: 'flight', label: 'Flights' },
  { kind: 'insurance', label: 'Insurance' },
  { kind: 'itinerary', label: 'Itinerary' },
  { kind: 'bank', label: 'Bank Statement' },
  { kind: 'hotel', label: 'Hotel Booking' },
  { kind: 'invitation', label: 'Invitation' },
];

export const FIXTURE_COUNTRIES: readonly ChecklistCountry[] = [
  { code: 'sg', name: 'Singapore', have: [true, true, true, true, true, false, false, false] },
  { code: 'de', name: 'Germany', have: [true, true, false, true, false, false, false, false] },
  { code: 'jp', name: 'Japan', have: [true, true, true, false, true, true, false, false] },
];

/** The stage words are the product's own (lib/case-stages.ts); the picture is tagged Example. */
export const FIXTURE_STAGES: readonly JourneyStage[] = [
  {
    name: 'Getting Started',
    icon: 'folder',
    actor: 'You',
    note: 'Add your documents. This part is yours.',
  },
  {
    name: 'Gathering Documents',
    icon: 'check',
    actor: 'You',
    note: 'Your papers come together in one record. Fix any gap that shows.',
  },
  {
    name: 'Being Checked',
    icon: 'search',
    actor: 'Agency',
    note: 'The agency is reviewing what you shared.',
  },
  {
    name: 'Needs You',
    icon: 'clock',
    actor: 'You',
    note: 'Something is missing. It waits for you.',
  },
  {
    name: 'Ready to Submit',
    icon: 'file',
    actor: 'Agency',
    note: 'The agency has what it needs and prepares to send.',
  },
  {
    name: 'Submitted',
    icon: 'plane',
    actor: 'Embassy',
    note: 'Your case has been sent. The embassy has it now.',
  },
  {
    name: 'Closed',
    icon: 'shield',
    actor: 'Embassy',
    note: 'The case is closed. Any decision is theirs, never ours.',
  },
];

export const FIXTURE_CASES: readonly CaseRow[] = [
  {
    name: 'Aisha K.',
    code: 'sg',
    country: 'Singapore',
    filled: 6,
    missing: 2,
    status: 'Being Checked',
  },
  {
    name: 'Rafi H.',
    code: 'de',
    country: 'Germany',
    filled: 3,
    missing: 5,
    status: 'Needs You',
  },
  {
    name: 'Nadia S.',
    code: 'jp',
    country: 'Japan',
    filled: 8,
    missing: 'Complete',
    status: 'Ready to Submit',
  },
];
