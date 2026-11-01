import { type EmailDeliveryRow, listEmailDeliveryProblems } from '@visastack/services';
import type { Metadata } from 'next';
import { PageHeader } from '../../../../components/ui';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import { formatTimestamp, formatTimestampDate } from '../../../../lib/format-date';
import { type SearchParamsRecord, parseCursor } from '../../../../lib/paging';
import { withSession } from '../../../../lib/session';
import { AdminRestricted } from '../admin-restricted';
import { ResendEmailButton } from './forms';
import { emailKindLabel, emailProblemReason } from './labels';
import { QueuePaging, QueuePastEnd } from './queue-paging';
import { QueuePanel } from './queue-panel';

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
}) {
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
                <QueuePastEnd
                  pathname={EMAIL_PATH}
                  search={search}
                  param="failedBefore"
                  landOn={FAILED_PANEL}
                  what="No older emails to show."
                />
              ) : (
                <p className="card-body">Every recent email arrived or is on its way.</p>
              )
            ) : (
              <>
                <QueuePanel
                  id={FAILED_PANEL}
                  label="Emails That Did Not Arrive"
                  pageKey={failedBefore ?? 'first'}
                  items={result.value.failed.map((row) => {
                    const kind = emailKindLabel(row.eventType);
                    const date = formatTimestampDate(row.createdAt);
                    const reason = emailProblemReason(row.status, row.lastError);
                    return {
                      id: row.id,
                      kind,
                      find: `${sentTo(row)} ${reason}`,
                      node: (
                        <>
                          <div>
                            <p className="row-key">{kind}</p>
                            <p className="muted u-fs-085">
                              {sentTo(row)}. Made {formatTimestamp(row.createdAt)}.{' '}
                              {tries(row.attempts)}.
                            </p>
                            <p className="card-body">{reason}</p>
                          </div>
                          <div className="row-end">
                            {row.status === 'BOUNCED' ? (
                              <span className="badge badge-danger">Address Refused It</span>
                            ) : (
                              <ResendEmailButton notificationId={row.id} kind={kind} date={date} />
                            )}
                          </div>
                        </>
                      ),
                    };
                  })}
                />
                <QueuePaging
                  pathname={EMAIL_PATH}
                  search={search}
                  param="failedBefore"
                  cursor={result.value.failedNext}
                  later={failedBefore !== undefined}
                  landOn={FAILED_PANEL}
                  shown={result.value.failed.length}
                  total={result.value.failedTotal}
                  noun={EMAIL_NOUN}
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
                <QueuePastEnd
                  pathname={EMAIL_PATH}
                  search={search}
                  param="waitingAfter"
                  landOn={WAITING_PANEL}
                  what="No more waiting emails to show."
                  direction="next"
                />
              ) : (
                <p className="card-body">Nothing has been waiting longer than 10 minutes.</p>
              )
            ) : (
              <>
                <QueuePanel
                  id={WAITING_PANEL}
                  label="Emails Still Waiting"
                  pageKey={waitingAfter ?? 'first'}
                  items={result.value.waiting.map((row) => {
                    const kind = emailKindLabel(row.eventType);
                    const state =
                      row.attempts === 0
                        ? 'Not tried yet.'
                        : `${tries(row.attempts)} so far. ${emailProblemReason(row.status, row.lastError)}`;
                    return {
                      id: row.id,
                      kind,
                      find: `${sentTo(row)} ${state}`,
                      node: (
                        <div>
                          <p className="row-key">{kind}</p>
                          <p className="muted u-fs-085">
                            {sentTo(row)}. Made {formatTimestamp(row.createdAt)}. Next try{' '}
                            {formatTimestamp(row.nextAttemptAt)}.
                          </p>
                          <p className="card-body">{state}</p>
                        </div>
                      ),
                    };
                  })}
                />
                <QueuePaging
                  pathname={EMAIL_PATH}
                  search={search}
                  param="waitingAfter"
                  cursor={result.value.waitingNext}
                  later={waitingAfter !== undefined}
                  landOn={WAITING_PANEL}
                  shown={result.value.waiting.length}
                  total={result.value.waitingTotal}
                  noun={EMAIL_NOUN}
                  direction="next"
                />
              </>
            )}
          </article>
        </>
      )}
    </section>
  );
}
