import { type EmailDeliveryRow, listEmailDeliveryProblems } from '@visastack/services';
import type { Metadata } from 'next';
import { ShowMore } from '../../../../components/show-more';
import { PageHeader } from '../../../../components/ui';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import { formatTimestamp, formatTimestampDate } from '../../../../lib/format-date';
import { type SearchParamsRecord, pagingHref, parseCursor } from '../../../../lib/paging';
import { withSession } from '../../../../lib/session';
import { AdminRestricted } from '../admin-restricted';
import { ResendEmailButton } from './forms';
import { emailKindLabel, emailProblemReason } from './labels';

export const metadata: Metadata = { title: 'Email Delivery' };

export const dynamic = 'force-dynamic';

function sentTo(row: EmailDeliveryRow): string {
  return row.recipientDomain
    ? `To an address at ${row.recipientDomain}`
    : 'To the email on their account';
}

function tries(attempts: number): string {
  return attempts === 1 ? '1 try' : `${attempts} tries`;
}

const EMAIL_PATH = '/app/admin/email';
const FAILED_PANEL = 'email-failed-panel';
const WAITING_PANEL = 'email-waiting-panel';
const EMAIL_NOUN = { one: 'email', other: 'emails' } as const;

/**
 * Application emails (invitations, reminders, case updates) that did not arrive, and ones still
 * waiting to go out. Staff can send a failed one again. Only the domain of the receiving address
 * is shown, never the full address or what the email said.
 *
 * WP-SB6: each list sits in its own fixed box that scrolls inside, 50 emails a load, and reads the
 * next 50 from the server with its own cursor, so a long outage never makes the page endless.
 */
export default async function EmailDeliveryPage({
  searchParams,
}: {
  readonly searchParams?: Promise<SearchParamsRecord>;
} = {}) {
  const search = (await searchParams) ?? {};
  const param = (name: string) => search[name];
  const failedBefore = parseCursor(param('failedBefore'));
  const waitingAfter = parseCursor(param('waitingAfter'));
  const result = await withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'PROCESSING_JOB_RETRY',
    );
    if (!staff.ok) return null;
    return listEmailDeliveryProblems(db, staff.value, new Date(), {
      ...(failedBefore ? { failedBefore } : {}),
      ...(waitingAfter ? { waitingAfter } : {}),
    });
  });
  if (!result) return <AdminRestricted />;

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Platform Operations"
        title="Email Delivery"
        description="Emails VisaStack sends for people, such as invitations and reminders, that did not arrive or are still waiting to go out."
        back={{ href: '/app/admin', label: 'Platform Operations' }}
      />
      {!result.ok ? (
        <p className="notice notice-warn">This page could not be loaded. Try again in a moment.</p>
      ) : (
        <>
          <div className="admin-operational-summary">
            <article className="card admin-summary-metric">
              <span>Sent Today</span>
              <strong>{result.value.counts.sentToday}</strong>
              <small>In the last 24 hours</small>
            </article>
            <article className="card admin-summary-metric">
              <span>Arrived Today</span>
              <strong>{result.value.counts.deliveredToday}</strong>
              <small>Confirmed as received in the last 24 hours</small>
            </article>
            <article className="card admin-summary-metric">
              <span>Did Not Arrive Today</span>
              <strong>{result.value.counts.failedToday}</strong>
              <small>Failed or refused in the last 24 hours</small>
            </article>
            <article className="card admin-summary-metric">
              <span>Waiting Now</span>
              <strong>{result.value.counts.waitingNow}</strong>
              <small>Not sent yet, including ones just made</small>
            </article>
          </div>

          <article className="card u-mt-150">
            <h2 className="card-title">Emails That Did Not Arrive</h2>
            {result.value.failed.length === 0 ? (
              failedBefore ? (
                <p className="card-body">
                  No older emails to show.{' '}
                  <a href={pagingHref(EMAIL_PATH, search, { failedBefore: null }, FAILED_PANEL)}>
                    Show Newest Entries
                  </a>
                </p>
              ) : (
                <p className="card-body">Every recent email arrived or is on its way.</p>
              )
            ) : (
              <>
                <section
                  className="activity-log-scroll staff-queue-panel"
                  id={FAILED_PANEL}
                  aria-label="Emails That Did Not Arrive"
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must take focus so the keyboard can scroll it
                  tabIndex={0}
                >
                  <ul className="rows">
                    {result.value.failed.map((row) => {
                      const kind = emailKindLabel(row.eventType);
                      const date = formatTimestampDate(row.createdAt);
                      return (
                        <li className="row" key={row.id}>
                          <div>
                            <p className="row-key">{kind}</p>
                            <p className="muted u-fs-085">
                              {sentTo(row)}. Made {formatTimestamp(row.createdAt)}.{' '}
                              {tries(row.attempts)}.
                            </p>
                            <p className="card-body">
                              {emailProblemReason(row.status, row.lastError)}
                            </p>
                          </div>
                          <div className="row-end">
                            {row.status === 'BOUNCED' ? (
                              <span className="badge badge-danger">Address Refused It</span>
                            ) : (
                              <ResendEmailButton notificationId={row.id} kind={kind} date={date} />
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
                <ListPaging
                  id="email-failed-more"
                  panel={FAILED_PANEL}
                  search={search}
                  param="failedBefore"
                  cursor={result.value.failedNext}
                  paged={failedBefore !== undefined}
                  shown={result.value.failed.length}
                  total={result.value.failedTotal}
                />
              </>
            )}
          </article>

          <article className="card u-mt-150">
            <h2 className="card-title">Emails Still Waiting</h2>
            <p className="card-body">
              Emails not sent more than 10 minutes after they were made. They are tried again on
              their own.
            </p>
            {result.value.waiting.length === 0 ? (
              waitingAfter ? (
                <p className="card-body">
                  No more waiting emails to show.{' '}
                  <a href={pagingHref(EMAIL_PATH, search, { waitingAfter: null }, WAITING_PANEL)}>
                    Back to the First Emails
                  </a>
                </p>
              ) : (
                <p className="card-body">Nothing has been waiting longer than 10 minutes.</p>
              )
            ) : (
              <>
                <section
                  className="activity-log-scroll staff-queue-panel"
                  id={WAITING_PANEL}
                  aria-label="Emails Still Waiting"
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must take focus so the keyboard can scroll it
                  tabIndex={0}
                >
                  <ul className="rows">
                    {result.value.waiting.map((row) => (
                      <li className="row" key={row.id}>
                        <div>
                          <p className="row-key">{emailKindLabel(row.eventType)}</p>
                          <p className="muted u-fs-085">
                            {sentTo(row)}. Made {formatTimestamp(row.createdAt)}. Next try{' '}
                            {formatTimestamp(row.nextAttemptAt)}.
                          </p>
                          <p className="card-body">
                            {row.attempts === 0
                              ? 'Not tried yet.'
                              : `${tries(row.attempts)} so far. ${emailProblemReason(row.status, row.lastError)}`}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
                <ListPaging
                  id="email-waiting-more"
                  panel={WAITING_PANEL}
                  search={search}
                  param="waitingAfter"
                  cursor={result.value.waitingNext}
                  paged={waitingAfter !== undefined}
                  shown={result.value.waiting.length}
                  total={result.value.waitingTotal}
                />
              </>
            )}
          </article>
        </>
      )}
    </section>
  );
}

/**
 * The end of one email list: how many are showing, the next 50 from the server, and a way back to
 * the first 50 once a later load is open. The other list's position is kept in the address.
 */
function ListPaging({
  id,
  panel,
  search,
  param,
  cursor,
  paged,
  shown,
  total,
}: {
  readonly id: string;
  readonly panel: string;
  readonly search: SearchParamsRecord;
  readonly param: 'failedBefore' | 'waitingAfter';
  readonly cursor: string | null;
  readonly paged: boolean;
  readonly shown: number;
  readonly total: number;
}) {
  return (
    <div className="staff-queue-paging">
      <ShowMore
        id={id}
        landOn={panel}
        pathname={EMAIL_PATH}
        searchParams={search}
        next={cursor ? { [param]: cursor } : null}
        shown={shown}
        total={total}
        noun={EMAIL_NOUN}
        label={param === 'failedBefore' ? 'Show Older Entries' : 'Show More'}
      />
      {paged ? (
        <a
          className="btn btn-secondary u-btn-sm"
          href={pagingHref(EMAIL_PATH, search, { [param]: null }, panel)}
        >
          {param === 'failedBefore' ? 'Show Newest Entries' : 'Back to the First Emails'}
        </a>
      ) : null}
    </div>
  );
}
