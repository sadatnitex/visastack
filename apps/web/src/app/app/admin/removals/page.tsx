import { type RemovalQueueRow, listRemovalQueue } from '@visastack/services';
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
import { REASON_LABELS, count, sizeLabel, waitingLabel } from './labels';

const PATHNAME = '/app/admin/removals';
/** A request waiting longer than this many working days is shown as overdue (lanes/D.md item 6). */
const OVERDUE_AFTER = 3;

export const metadata: Metadata = { title: 'Removal Requests' };

export const dynamic = 'force-dynamic';

/** What approving one request changes, in one plain line. */
function impactLine(row: RemovalQueueRow): string {
  const parts = [
    row.openCases === 0
      ? 'No open case uses it'
      : `${count(row.openCases, 'open case', 'open cases')} will ask for another document`,
    `${count(row.finishedCases, 'finished case keeps', 'finished cases keep')} its record`,
    `${count(row.agencies, 'agency', 'agencies')} told without the document name`,
    `${count(row.sharesAffected, 'share names', 'shares name')} it`,
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
  const { show: showParam } = query;
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
                  {row.waitingWorkingDays > OVERDUE_AFTER ? (
                    <StatusBadge tone="warning">Overdue</StatusBadge>
                  ) : null}
                  {row.legalHold ? (
                    <StatusBadge tone="warning">Kept (Legal Requirement)</StatusBadge>
                  ) : null}
                </div>
                <p className="lc-removal-meta">
                  {REASON_LABELS[row.reason]}. Asked on {formatTimestampDate(row.requestedAt)}.{' '}
                  {waitingLabel(row.waitingWorkingDays)}.
                </p>
                <p className="lc-removal-impact">{impactLine(row)}</p>
                {row.legalHold ? (
                  <p className="notice notice-warn">
                    A legal hold covers this document, so it cannot be removed. Decline the request
                    with the legal requirement reason.
                  </p>
                ) : null}
                <DecideRemovalForm
                  requestId={row.id}
                  documentCode={row.documentCode}
                  legalHold={row.legalHold}
                />
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
