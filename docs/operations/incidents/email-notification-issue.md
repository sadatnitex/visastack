# Email or notifications fail

Read [README.md](./README.md) first.

## How notifications work

- When something happens that a person should hear about (an invitation, a share, a request, an
  acknowledgement, a deadline), the product writes a notification row in the same database
  transaction as the change. Each event creates an in-app notice and an email notice. Writing it in
  the same transaction means a crash cannot lose the notice.
- Right after the action, the product asks the worker to send it (`after()` in the request). A daily
  job (`/api/jobs/process-notifications`, 03:40 UTC) sends whatever that missed and retries failures
  with growing delays.
- Reminders that depend on dates (task deadlines, document and verification expiry) are written by a
  sweep (`/api/jobs/process-notification-sweeps`, 03:50 UTC). **That sweep runs once a day.** An
  earlier note in the requirements ledger says "hourly" and the requirement says "at least hourly";
  `apps/web/vercel.json` schedules it daily, which is what a plan that only allows daily jobs would
  force. The plan has not been verified. Treat date reminders as up to a day late until this is
  fixed (a plan that allows hourly jobs, or an outside scheduler calling the address with the
  `CRON_SECRET`).
- Email is sent by Resend when `EMAIL_PROVIDER=resend` is set. If it is unset the product uses a
  null sender that sends nothing and logs nothing about the recipient, and people only see in-app
  notices. Check the variable in Vercel before assuming email is on.
- Delivery, bounce and complaint results come back through a signed webhook
  (`/api/webhooks/resend`, secret `RESEND_WEBHOOK_SECRET`). The route refuses everything if the
  secret is missing.
- Rate limits exist on the flows that send email (invitations), so abuse of the product to send mail
  is bounded per person and per network.

## How you might find out

- `/app/admin` Operations, "Operational signals": "Notification backlog" (amber at 15 minutes, red at
  60 minutes for the oldest queued notice) and "Email failure and bounce" (amber at 5% and red at 20%
  of the last 24 hours, with at least three failures).
  Note: because the backstop job is daily, a notice that missed the instant send waits up to a day, so
  the backlog signal can be red for hours without anything being wrong beyond that delay.
- Failed rows in the database (the query under "Preserve evidence"). There is no screen that lists
  failed notices.
- People saying they never got an invitation or a link.
- Resend's dashboard (failures, bounces, complaints, a suspended account or a domain problem) and
  its status page.

## Contain

1. Declare and open the log. Late or failing email is SEV3. **Unexpected email going out** (phishing
   in the product's name, a flood of messages, messages to the wrong people) is SEV1 or SEV2.
2. **If the product is sending something it should not,** stop it now: in the Resend dashboard disable
   the API key (or pause sending), and then follow [secret-compromise.md](./secret-compromise.md) if a
   key may be in the wrong hands. In Vercel you can also unset `EMAIL_PROVIDER` and redeploy to fall
   back to the null sender; in-app notices keep working.
3. **If email is simply failing,** do not resend by hand to everyone. Find the cause first.
4. Tell people plainly if invitations or links are delayed, and offer a way round that does not
   depend on email (the invitation page link shared by the inviter directly).

## Preserve evidence

Follow the README. Also keep: the Resend log for the window (messages, recipients' domains, outcomes),
the failed notification rows (`select event_type, channel, status, last_error, created_at from
notifications where status = 'FAILED' and created_at >= '<start>'`), and the Vercel log lines for
`/api/webhooks/resend` and `/api/jobs/process-notifications`.

## Assess

| Question | How to check |
|---|---|
| Is it the provider? | Resend status page and dashboard (account standing, domain verification, sending limit reached) |
| Is it our domain? | DNS records for the sending domain (SPF, DKIM, DMARC) still in place; the verified sender in `RESEND_FROM_ADDRESS` still the verified one |
| Is it our configuration? | `EMAIL_PROVIDER`, `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` present in Vercel Production; Operations "Platform readiness detail" names anything missing |
| Is the backstop job running? | Vercel cron list: last run of `process-notifications`; `CRON_SECRET` set |
| Are bounces real people or us? | Group failures by recipient domain; a single domain failing points at that provider or a typo, many domains at us |
| Was email abused? | Resend log for messages the product did not generate; compare with `notifications` rows |

## Recover

1. Fix the cause (renew the key, restore the DNS records, raise the sending limit, put the variable back).
2. Queued notices are retried by the daily job, up to five attempts spread over about a day, then
   stay `FAILED`. **There is no retry button**: the service function exists (`retryNotification`)
   but no screen calls it. To get a person a failed message, repeat the action that caused it (issue
   the invitation again). Do not mass-resend: a stale reminder about something already resolved is
   worse than a late one (the product cancels queued notices for things that were cancelled or
   replaced, so leave that logic to do its work).
3. Confirm "Notification backlog" and "Email failure and bounce" return to OK and send one test
   invitation to an address you control.

## Notify and escalate

Delays need no formal notice. Email sent in the product's name to people who should not have received
it is a data and reputation incident; the legal reviewer decides who is told and how.

## After

Postmortem as in the README. Questions: should the date sweeps and the notification backstop run
hourly (needs a plan or scheduler that allows it)? Is an uptime alert on the Resend webhook and the
failure rate worth setting up? Is DMARC reporting turned on so abuse of the domain is seen?
