import { type EmailDeliveryRow, listEmailDeliveryProblems } from '@visastack/services';
import type { Metadata } from 'next';
import { PageHeader } from '../../../../components/ui';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import { formatTimestamp, formatTimestampDate } from '../../../../lib/format-date';
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

/**
 * Application emails (invitations, reminders, case updates) that did not arrive, and ones still
 * waiting to go out. Staff can send a failed one again. Only the domain of the receiving address
 * is shown, never the full address or what the email said.
 */
export default async function EmailDeliveryPage() {
  const result = await withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'PROCESSING_JOB_RETRY',
    );
    if (!staff.ok) return null;
    return listEmailDeliveryProblems(db, staff.value);
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
              <p className="card-body">Every recent email arrived or is on its way.</p>
            ) : (
              <ul className="rows u-mt-050">
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
                        <p className="card-body">{emailProblemReason(row.status, row.lastError)}</p>
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
            )}
          </article>

          <article className="card u-mt-150">
            <h2 className="card-title">Emails Still Waiting</h2>
            <p className="card-body">
              Emails not sent more than 10 minutes after they were made. They are tried again on
              their own.
            </p>
            {result.value.waiting.length === 0 ? (
              <p className="card-body">Nothing has been waiting longer than 10 minutes.</p>
            ) : (
              <ul className="rows u-mt-050">
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
            )}
          </article>
        </>
      )}
    </section>
  );
}
