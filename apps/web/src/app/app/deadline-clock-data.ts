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

/** The proof the access gate gives for one person, as the dates read takes it. */
type Proof = Parameters<typeof listDeadlineClock>[0];

/**
 * The next dates for a person, with a proof the caller already holds from the gate (Home takes one
 * proof per person for both its reads). Null when they could not be read, whether the service
 * refused or the read failed: the card is a secondary part of the page, so a failed read says
 * "unavailable" in the card and never takes the page down with it.
 */
export async function readDeadlineEntries(
  proof: Proof,
  now: Date,
  limit: number,
): Promise<readonly DeadlineEntry[] | null> {
  try {
    const listed = await listDeadlineClock(proof, { now, limit });
    return listed.ok ? listed.value.entries : null;
  } catch {
    return null;
  }
}

/**
 * The next dates for one of the person's own applicants, through the central access gate as the
 * owner, or null when they could not be read (the gate refused, or the read failed). The caller
 * shows "unavailable" for null, never an empty state: not being able to read dates is not the same
 * as having none.
 */
export async function loadDeadlineEntries(
  db: Db,
  accountId: string,
  applicantId: string,
  now: Date,
  limit: number,
): Promise<readonly DeadlineEntry[] | null> {
  try {
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'self' },
    );
    if (!access.ok || access.value.actor.kind !== 'applicant_owner') return null;
    return await readDeadlineEntries(access.value, now, limit);
  } catch {
    return null;
  }
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

/**
 * One calm fact for an all-clear (CCD section 6): the soonest document date still ahead that the
 * system is sure of: "Karim Hossain's Passport is valid until 14 Jan 2027." on Home, "Passport:
 * valid until 14 Jan 2027." on a person's own page. Null when there
 * is none among the dates read, so nothing is ever made up to fill the space.
 */
export function validUntilLine(
  entries: readonly DeadlineEntry[],
  options: { readonly showPerson: boolean },
): string | null {
  const entry = entries.find(
    // Only a date well ahead: one due soon belongs on the clock as a date to act on, not here.
    (e) => e.kind === 'document_expires' && e.doubt === null && e.urgency === 'later',
  );
  if (!entry) return null;
  const what = deadlineLabel(entry);
  const until = formatDateOnly(entry.date);
  return options.showPerson
    ? `${entry.applicantName}'s ${what} is valid until ${until}.`
    : `${what}: valid until ${until}.`;
}
