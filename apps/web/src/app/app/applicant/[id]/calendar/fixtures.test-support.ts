import type { CalendarItem } from '@visastack/services';

/** Made-up dated items in the server's order (earliest first) for the calendar page and route. */
export const CASE_TITLE = 'Japan Visit';
export const IDS = {
  appointment: '0b6f1c2e-1111-4a8e-9d0c-000000000001',
  task: '0b6f1c2e-2222-4a8e-9d0c-000000000002',
  request: '0b6f1c2e-3333-4a8e-9d0c-000000000003',
  document: '0b6f1c2e-4444-4a8e-9d0c-000000000004',
} as const;
export const APPOINTMENT_KEY = `appointment:${IDS.appointment}`;
export const TASK_KEY = `task_due:${IDS.task}`;
export const REQUEST_KEY = `request_due:${IDS.request}`;
export const DOCUMENT_KEY = `document_expires:${IDS.document}`;
/** Another person's task: never one of this person's items. */
export const FOREIGN_KEY = 'task_due:0b6f1c2e-9999-4a8e-9d0c-000000000009';

const UPDATED = '2026-10-20T08:00:00.000Z';

export const CALENDAR_ITEMS: CalendarItem[] = [
  {
    key: REQUEST_KEY,
    kind: 'request_due',
    resourceId: IDS.request,
    when: { kind: 'date', date: '2026-11-01' },
    caseTitle: CASE_TITLE,
    updatedAt: UPDATED,
  },
  {
    key: APPOINTMENT_KEY,
    kind: 'appointment',
    resourceId: IDS.appointment,
    when: { kind: 'local', localDateTime: '2026-11-03T09:30:00', timeZone: 'Asia/Dhaka' },
    caseTitle: CASE_TITLE,
    updatedAt: UPDATED,
  },
  {
    key: TASK_KEY,
    kind: 'task_due',
    resourceId: IDS.task,
    when: { kind: 'date', date: '2026-11-03' },
    caseTitle: CASE_TITLE,
    updatedAt: UPDATED,
  },
  {
    key: DOCUMENT_KEY,
    kind: 'document_expires',
    resourceId: IDS.document,
    when: { kind: 'date', date: '2027-04-30' },
    caseTitle: null,
    updatedAt: UPDATED,
  },
];

export function ownerProof() {
  return { ok: true, value: { actor: { kind: 'applicant_owner', applicantId: 'a1' } } };
}

export function sharedProof() {
  return { ok: true, value: { actor: { kind: 'grant_recipient', applicantId: 'a1' } } };
}

/** A same-site form POST to the download route, as the page's form sends it. */
export function downloadRequest(
  fields: readonly (readonly [string, string])[],
  headers: Record<string, string> = { origin: 'https://vs.example.test', host: 'vs.example.test' },
): Request {
  const body = new URLSearchParams(fields.map(([name, value]) => [name, value]));
  return new Request('https://vs.example.test/app/applicant/a1/calendar/download', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body,
  });
}
