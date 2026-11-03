/**
 * UMPE P12: the plain names on the Application Attempts card. Truthful by construction: a person's
 * own record is "Reported by You", an attached document is "Document Attached", and nothing is ever
 * called confirmed or verified, because VisaStack never sees what an authority does.
 */

export const ATTEMPT_CHANNEL_LABELS: Readonly<Record<string, string>> = {
  EMBASSY_PORTAL: 'Embassy or Consulate Website',
  EMAIL: 'Email',
  IN_PERSON: 'In Person',
  COURIER: 'Courier',
  VISA_APPLICATION_CENTER: 'Visa Application Centre',
  OTHER: 'Other Way',
};

export const ATTEMPT_DECISION_LABELS: Readonly<Record<string, string>> = {
  PENDING: 'Still Waiting',
  APPROVED: 'Approved',
  REFUSED: 'Refused',
  WITHDRAWN: 'Withdrawn',
  CANCELLED: 'Cancelled',
  OTHER: 'Other Decision',
};

export const ATTEMPT_DECISION_TONES: Readonly<Record<string, string>> = {
  PENDING: 'badge-warning',
  APPROVED: 'badge-success',
  REFUSED: 'badge-danger',
  WITHDRAWN: 'badge-neutral',
  CANCELLED: 'badge-neutral',
  OTHER: 'badge-neutral',
};

export const AUTHORITY_SOURCE_LABELS: Readonly<Record<string, string>> = {
  EMBASSY_OR_CONSULATE: 'Embassy or Consulate',
  VISA_APPLICATION_CENTER: 'Visa Application Centre',
  IMMIGRATION_AUTHORITY: 'Immigration Office',
  OTHER_AUTHORITY: 'Other Official Office',
};

export const ATTEMPT_EVENT_LABELS: Readonly<Record<string, string>> = {
  AUTHORITY_RECEIPT: 'They Received It',
  AUTHORITY_REQUEST: 'The Embassy Asked for More',
  DECISION: 'Decision',
};

/** What a record rests on, in plain words. */
export function basisLabel(documentSupplied: boolean): string {
  return documentSupplied ? 'Document Attached' : 'Reported by You';
}
