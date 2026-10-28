import {
  type MemoryEvent,
  accountPrincipal,
  getApplicationMemory,
  requireAccess,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import { eventKey, eventLine } from '../../../../../lib/application-memory-labels';
import { humanizeCode } from '../../../../../lib/format-code';
import { formatDateOnly, formatTimestampDate } from '../../../../../lib/format-date';
import { withSession } from '../../../../../lib/session';

export const metadata: Metadata = { title: 'Case History' };

export const dynamic = 'force-dynamic';

/** A reported submission date and a decision date are calendar dates the person gave. */
function eventDate(event: MemoryEvent): string {
  return event.kind === 'reported_submitted' || event.kind === 'outcome'
    ? formatDateOnly(event.at)
    : formatTimestampDate(event.at);
}

/**
 * v1.2 B08 (U06) Case History (once called Application Memory), WP-V3 part 3: every case of one person,
 * oldest record first within a case, with what was prepared, confirmed,
 * shared, reported as submitted and decided. Owner only.
 */
export default async function ApplicationMemoryPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const memory = await withSession(async ({ db, accountId }) => {
    const gate = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId: id },
      { purpose: 'application_memory' },
    );
    if (!gate.ok) return null;
    const read = await getApplicationMemory(gate.value);
    return read.ok ? read.value : null;
  });
  if (!memory) notFound();

  return (
    <>
      <PageHeader
        back={{ href: `/app/applicant/${id}/missions`, label: 'Cases' }}
        eyebrow="Cases"
        title="Case History"
        description="Every case for this person: what was prepared, what you confirmed, who it was shared with, and what you reported as submitted. A snapshot never changes after it is taken."
        as="h2"
      />

      {memory.recordShares.length > 0 ? (
        <article className="card memory-shares" aria-labelledby="memory-shares-heading">
          <h3 className="card-title" id="memory-shares-heading">
            Shared Outside a Case
          </h3>
          <p className="memory-case-meta">
            These shares are of this person's record, not of one case.
          </p>
          <ol className="memory-timeline">
            {memory.recordShares.map((share) => {
              const line = eventLine(share);
              return (
                <li className="memory-event memory-event-shared" key={eventKey(share)}>
                  <span className="memory-event-date">{eventDate(share)}</span>
                  <span className="memory-event-title">{line.title}</span>
                  {line.note ? <span className="memory-event-note">{line.note}</span> : null}
                </li>
              );
            })}
          </ol>
          <Link className="case-changes-all" href={`/app/applicant/${id}/sharing`}>
            Open Sharing
          </Link>
        </article>
      ) : null}

      {memory.cases.length === 0 ? (
        <article className="card">
          <EmptyState
            icon="briefcase"
            title="No Cases Yet"
            action={{ href: `/app/applicant/${id}/missions`, label: 'Open Cases' }}
          >
            When you prepare a case, each snapshot you take and confirm is kept here exactly as it
            was.
          </EmptyState>
        </article>
      ) : (
        <div className="memory-cases">
          {memory.cases.map((item) => {
            const meta = [
              item.purpose,
              item.agencyName ? `Managed by ${item.agencyName}` : null,
              humanizeCode(item.state),
              `Started ${formatTimestampDate(item.createdAt)}`,
            ].filter((part): part is string => Boolean(part));
            return (
              <article className="card memory-case" key={item.missionId}>
                <p className="card-kicker">{item.destination ?? 'Case'}</p>
                <h3 className="card-title">
                  <Link href={`/app/mission/${item.missionId}`}>{item.title}</Link>
                </h3>
                <p className="memory-case-meta">{meta.join(' · ')}</p>
                {item.notSharedWith && item.notSharedWith.length > 0 ? (
                  <p className="memory-case-note">
                    Not shared with{' '}
                    {item.notSharedWith
                      .map((e) => e.recipientName ?? 'a removed recipient')
                      .join(', ')}
                    , who can see your other cases.{' '}
                    <Link href={`/app/applicant/${id}/sharing`}>Manage Sharing</Link>
                  </p>
                ) : null}
                {item.removed ? (
                  <p className="memory-case-note">
                    This case's files were removed at the end of its keep period. The record of what
                    happened stays.
                  </p>
                ) : null}
                {item.events.length === 0 ? (
                  <p className="memory-case-note">Nothing has been prepared for this case yet.</p>
                ) : (
                  <ol className="memory-timeline">
                    {item.events.map((event) => {
                      const line = eventLine(event);
                      return (
                        <li
                          className={`memory-event memory-event-${event.kind}`}
                          key={eventKey(event)}
                        >
                          <span className="memory-event-date">{eventDate(event)}</span>
                          <span className="memory-event-title">{line.title}</span>
                          {line.note ? (
                            <span className="memory-event-note">{line.note}</span>
                          ) : null}
                          {event.kind === 'prepared' && !item.removed ? (
                            <span className="memory-event-actions">
                              <Link
                                className="btn btn-secondary"
                                href={`/app/mission/${item.missionId}/snapshots/${event.snapshotId}`}
                              >
                                View Snapshot {event.snapshotVersion}
                              </Link>
                              <Link
                                className="btn btn-secondary"
                                href={`/app/applicant/${id}/memory/compare?snapshot=${event.snapshotId}`}
                              >
                                Compare with Today
                              </Link>
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
