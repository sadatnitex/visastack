import type { MemoryCase, MemoryEvent } from '@visastack/services';
import Link from 'next/link';
import { CollapsibleGroup } from '../../../../../components/collapsible-group';
import { ShowMore } from '../../../../../components/show-more';
import { eventKey, eventLine } from '../../../../../lib/application-memory-labels';
import { humanizeCode } from '../../../../../lib/format-code';
import { formatDateOnly, formatTimestampDate } from '../../../../../lib/format-date';
import { type SearchParamsRecord, TRAVELLER_LIST_STEP, nextShow } from '../../../../../lib/paging';

/** A reported submission date and a decision date are calendar dates the person gave. */
export function eventDate(event: MemoryEvent): string {
  return event.kind === 'reported_submitted' || event.kind === 'outcome'
    ? formatDateOnly(event.at)
    : formatTimestampDate(event.at);
}

/** The id of the n-th case on the page (from 1), so Show More can land on the first new one. */
const caseAnchor = (position: number) => `memory-case-${position}`;

/**
 * The cases on Case History (WP-SB1): each case is a group that opens and closes, the latest open
 * and the rest closed; a case's records scroll inside a panel of fixed height; and the end of the
 * list says how many cases show, with Show More asking the server for ten more.
 */
export function MemoryCaseList({
  applicantId,
  cases,
  totalCases,
  searchParams,
}: {
  readonly applicantId: string;
  readonly cases: readonly MemoryCase[];
  /** Every case of this person, of which `cases` are the most recently active. */
  readonly totalCases: number;
  readonly searchParams: SearchParamsRecord;
}) {
  const next =
    totalCases > cases.length ? nextShow(cases.length, { step: TRAVELLER_LIST_STEP }) : null;
  return (
    <div className="memory-cases">
      {cases.map((item, index) => {
        const meta = [
          item.purpose,
          item.agencyName ? `Managed by ${item.agencyName}` : null,
          humanizeCode(item.state),
          `Started ${formatTimestampDate(item.createdAt)}`,
        ].filter((part): part is string => Boolean(part));
        return (
          <CollapsibleGroup
            key={item.missionId}
            id={caseAnchor(index + 1)}
            title={item.title}
            count={item.events.length}
            noun={{ one: 'record', other: 'records' }}
            open={index === 0}
          >
            <article className="memory-case">
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
                  <Link href={`/app/applicant/${applicantId}/sharing`}>Manage Sharing</Link>
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
                <section
                  className="activity-log-scroll memory-events-scroll"
                  aria-label={`Records of ${item.title}`}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must take focus so the keyboard can scroll it
                  tabIndex={0}
                >
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
                                href={`/app/applicant/${applicantId}/memory/compare?snapshot=${event.snapshotId}`}
                              >
                                Compare with Today
                              </Link>
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}
            </article>
          </CollapsibleGroup>
        );
      })}
      {next === null && totalCases > cases.length ? (
        <p className="memory-case-note">
          Case History lists the {cases.length} most recently active cases. Every case is on{' '}
          <Link href={`/app/applicant/${applicantId}/missions`}>Cases</Link>.
        </p>
      ) : null}
      <ShowMore
        id="memory-cases-more"
        landOn={caseAnchor(cases.length + 1)}
        pathname={`/app/applicant/${applicantId}/memory`}
        searchParams={searchParams}
        next={next === null ? null : { show: next }}
        shown={cases.length}
        total={totalCases}
        noun={{ one: 'case', other: 'cases' }}
      />
    </div>
  );
}
