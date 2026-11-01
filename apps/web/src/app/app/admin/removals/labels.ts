import type { RemovalDeclineCode, RemovalRequestReason } from '@visastack/services';

/** The reason the person picked, as support reads it. */
export const REASON_LABELS: Readonly<Record<RemovalRequestReason, string>> = {
  WRONG_PERSON: "Someone Else's Document",
  UPLOADED_BY_MISTAKE: 'Added by Mistake',
  NO_LONGER_NEEDED: 'No Longer Needed',
  PRIVACY_CONCERN: 'Privacy Concern',
  OTHER: 'Another Reason',
};

/** Why support declines, as the decline list shows it. The person is told the matching plain reason. */
export const DECLINE_LABELS: Readonly<Record<RemovalDeclineCode, string>> = {
  LEGAL_HOLD: 'Legal Requirement',
  FINISHED_CASE_RECORD: 'Finished Case Record',
  AGENCY_REQUEST_ANSWER: 'Answered an Agency Request',
  RETENTION_REQUIRED: 'Must Be Kept for Now',
  OTHER: 'Another Reason',
};

/** "1 open case", "2 open cases". */
export function count(n: number, one: string, other: string): string {
  return `${n} ${n === 1 ? one : other}`;
}

/** Bytes in the units people use. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "Waiting 4 working days", with today's requests read plainly. */
export function waitingLabel(days: number): string {
  if (days === 0) return 'Asked today or on the last working day';
  return `Waiting ${count(days, 'working day', 'working days')}`;
}
