import {
  REMOVAL_ALERT_WORKING_DAYS,
  type RemovalQueueRow,
  listRemovalQueue,
} from '@visastack/services';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ShowMore } from '../../../../components/show-more';
import { PageHeader, StatusBadge } from '../../../../components/ui';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import { documentRemovalRequestsOn } from '../../../../lib/env';
import { formatTimestampDate } from '../../../../lib/format-date';
import {
  type SearchParamsRecord,
  TEAM_LIST_STEP,
  nextShow,
  parseShow,
} from '../../../../lib/paging';
import { withSession } from '../../../../lib/session';
import { AdminRestricted } from '../admin-restricted';
import { DecideRemovalForm } from './decide-form';
import { DecisionStatus } from './decision-status';
import { REASON_LABELS, count, sizeLabel, waitingLabel } from './labels';

const PATHNAME = '/app/admin/removals';
/** The outcome line after a decision (the decided request has left the list). */
const DECISION_MESSAGES: Readonly<Record<string, string>> = {
  approved: 'Approved. The file is being removed securely, and the person has been told.',
  removed: 'Approved. The document had no stored file and is gone. The person has been told.',
  declined: 'Declined. The person has been told why.',
};

export const metadata: Metadata = { title: 'Removal Requests' };

export const dynamic = 'force-dynamic';

/** What approving one request changes, in one plain line. */
function impactLine(row: RemovalQueueRow): string {
  const parts = [
    row.openCases === 0
      ? 'No open case uses it'
      : `${count(row.openCases, 'open case', 'open cases')} will ask for another document`,
    count(row.finishedCases, 'finished case keeps its record', 'finished cases keep their records'),
    `${count(row.agencies, 'agency', 'agencies')} told without the document name`,
    count(row.sharesAffected, 'share includes it', 'shares include it'),
    `frees ${sizeLabel(row.storageBytes)}`,
  ];
  return `${parts.join('. ')}.`;
}

/**
 * Removal requests waiting for support (resource lifecycle lane D). Oldest first, each with what
 * approving would change. Read with privacy access; deciding needs the compliance role and a
 * fresh sign-in check. Hidden entirely while the owner keeps `DOCUMENT_REMOVAL_REQUESTS` off.
 */
export default async function RemovalRequestsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<SearchParamsRecord>;
}) {
  if (!documentRemovalRequestsOn()) notFound();
  const query: SearchParamsRecord = (await searchParams) ?? {};
  const { show: showParam, done: doneParam } = query;
  const done = DECISION_MESSAGES[typeof doneParam === 'string' ? doneParam : ''];
  const shown = parseShow(showParam, { step: TEAM_LIST_STEP });
  const data = await withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'APPLICANT_DIRECTORY_VIEW',
    );
    if (!staff.ok) return { kind: 'restricted' as const };
    const queue = await listRemovalQueue(staff.value, { db, limit: shown });
    if (!queue.ok) return { kind: 'restricted' as const };
    return { kind: 'ready' as const, queue: queue.value };
  });

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Privacy"
        title="Removal Requests"
        description="Travellers ask us to remove a file for good. Check what approving would change, then approve or decline. Try to decide within 3 working days."
      />
      <DecisionStatus
        id="removal-requests-status"
        message={data.kind === 'ready' ? done : undefined}
      />
      {data.kind === 'restricted' ? (
        <AdminRestricted />
      ) : data.queue.rows.length === 0 ? (
        <p className="notice">No removal requests are waiting.</p>
      ) : (
        <>
          <ul className="lc-removal-list">
            {data.queue.rows.map((row) => (
              <li key={row.id} id={`removal-${row.id}`} className="card lc-removal-row">
                <div className="lc-removal-head">
                  <h2 className="card-title lc-removal-code">Document {row.documentCode}</h2>
                  {row.waitingWorkingDays > REMOVAL_ALERT_WORKING_DAYS ? (
                    <StatusBadge tone="warning">Overdue</StatusBadge>
                  ) : null}
                  {row.legalHold ? (
                    <StatusBadge tone="warning">Kept (Legal Requirement)</StatusBadge>
                  ) : null}
                </div>
                <p className="lc-removal-meta">
                  Reason: {REASON_LABELS[row.reason]}. Asked on{' '}
                  {formatTimestampDate(row.requestedAt)}. {waitingLabel(row.waitingWorkingDays)}.
                </p>
                <p className="lc-removal-impact">
                  {row.documentGone
                    ? 'The document already left VisaStack. This request closes at the next daily check, and the person is told.'
                    : impactLine(row)}
                </p>
                {row.legalHold ? (
                  <p className="notice notice-warn">
                    A legal hold covers this document, so it cannot be removed. Decline the request
                    with the legal requirement reason.
                  </p>
                ) : null}
                {row.documentGone ? null : (
                  <DecideRemovalForm
                    requestId={row.id}
                    documentCode={row.documentCode}
                    legalHold={row.legalHold}
                  />
                )}
              </li>
            ))}
          </ul>
          <ShowMore
            id="removal-requests-more"
            pathname={PATHNAME}
            searchParams={query}
            next={
              data.queue.hasMore
                ? (() => {
                    const show = nextShow(shown, { step: TEAM_LIST_STEP });
                    return show ? { show } : null;
                  })()
                : null
            }
            shown={data.queue.rows.length}
            noun={{ one: 'request', other: 'requests' }}
          />
        </>
      )}
    </section>
  );
}
