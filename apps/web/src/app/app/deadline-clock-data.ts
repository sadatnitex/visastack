import {
  type Db,
  type DeadlineEntry,
  accountPrincipal,
  listDeadlineClock,
  requireAccess,
} from '@visastack/services';
import type { DeadlineLine } from '../../components/deadline-clock';
import { CHECK_THIS_DATE_WHY, DEADLINE_TONE_WORDS, deadlinePhrase } from '../../lib/deadline-words';
import { formatDateOnly } from '../../lib/format-date';
import { documentTypeLabel } from '../../lib/labels';
import { requestItemLabel } from './agency/[orgId]/do-next';

/**
 * The deadline clock's data for the pages (Growth G5): one person's next dates through the central
 * access gate as the owner, and the plain lines the card shows. Server-only: naming a request
 * reads the field catalogue, which never goes to the browser (the same reason `requestItemLabel`
 * lives beside the agency screens).
 */

/** How many dates the clock shows on Home and on a person's overview, and on the Expiry page. */
export const CLOCK_HOME_LIMIT = 3;
export const CLOCK_EXPIRY_PAGE_LIMIT = 5;

/**
 * The next dates for one of the person's own applicants, or null when they could not be read
 * (the gate refused, or the read failed). The caller shows "unavailable" for null, never an empty
 * state: not being able to read dates is not the same as having none.
 */
export async function loadDeadlineEntries(
  db: Db,
  accountId: string,
  applicantId: string,
  now: Date,
  limit: number,
): Promise<readonly DeadlineEntry[] | null> {
  const access = await requireAccess(
    db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { applicantId },
    { purpose: 'self' },
  );
  if (!access.ok || access.value.actor.kind !== 'applicant_owner') return null;
  const listed = await listDeadlineClock(access.value, { now, limit });
  return listed.ok ? listed.value.entries : null;
}

/** What a date is called: the document's type, the task's own words, what a request asks for. */
export function deadlineLabel(entry: DeadlineEntry): string {
  switch (entry.kind) {
    case 'document_expires':
      return entry.docType ? documentTypeLabel(entry.docType) : 'Document';
    case 'task_due':
      return entry.label ?? 'Task';
    case 'request_due':
      return entry.subject?.kind === 'request'
        ? requestItemLabel({
            kind: entry.subject.requestKind,
            fieldKey: entry.subject.fieldKey,
            docType: entry.subject.docType,
          })
        : 'Request';
    case 'appointment':
      return 'Appointment';
  }
}

/**
 * The lines the card shows. `showPerson` adds whose date it is (Home, when there is more than one
 * person on the account); a person's own pages leave it out.
 */
export function deadlineLines(
  entries: readonly DeadlineEntry[],
  options: { readonly showPerson: boolean },
): DeadlineLine[] {
  return entries.map((entry) => ({
    key: entry.key,
    label: deadlineLabel(entry),
    // A date the system is unsure of is never worded as certain.
    phrase:
      deadlinePhrase(entry.kind, entry.daysUntil) +
      (entry.doubt === null ? '' : ', if the date is right'),
    dateText: formatDateOnly(entry.date),
    isoDate: entry.date,
    person: options.showPerson ? entry.applicantName : null,
    urgency: entry.urgency,
    toneWord: DEADLINE_TONE_WORDS[entry.urgency],
    href: entry.href,
    check: entry.doubt === null ? null : CHECK_THIS_DATE_WHY[entry.doubt],
  }));
}
