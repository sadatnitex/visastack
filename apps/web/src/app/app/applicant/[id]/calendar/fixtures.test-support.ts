import type { CalendarItem } from '@visastack/services';

/** Made-up dated items in the server's order (earliest first) for the calendar page and route. */
export const CASE_TITLE = 'Japan Visit';
export const APPOINTMENT_KEY = 'appointment:0b6f1c2e-1111-4a8e-9d0c-000000000001';
export const TASK_KEY = 'task:0b6f1c2e-2222-4a8e-9d0c-000000000002';
export const REQUEST_KEY = 'evidence_request:0b6f1c2e-3333-4a8e-9d0c-000000000003';
export const DOCUMENT_KEY = 'document_expiry:0b6f1c2e-4444-4a8e-9d0c-000000000004';
/** Another person's task: never one of this person's items. */
export const FOREIGN_KEY = 'task:0b6f1c2e-9999-4a8e-9d0c-000000000009';

export const CALENDAR_ITEMS: CalendarItem[] = [
  {
    key: REQUEST_KEY,
    kind: 'evidence_request',
    when: { kind: 'date', date: '2026-11-01' },
    caseTitle: CASE_TITLE,
  },
  {
    key: APPOINTMENT_KEY,
    kind: 'appointment',
    when: { kind: 'local', localDateTime: '2026-11-03T09:30:00', timezone: 'Asia/Dhaka' },
    caseTitle: CASE_TITLE,
  },
  {
    key: TASK_KEY,
    kind: 'task',
    when: { kind: 'date', date: '2026-11-03' },
    caseTitle: CASE_TITLE,
  },
  {
    key: DOCUMENT_KEY,
    kind: 'document_expiry',
    when: { kind: 'date', date: '2027-04-30' },
    caseTitle: null,
  },
];

export function ownerProof() {
  return { ok: true, value: { actor: { kind: 'applicant_owner', applicantId: 'a1' } } };
}

export function sharedProof() {
  return { ok: true, value: { actor: { kind: 'grant_recipient', applicantId: 'a1' } } };
}
