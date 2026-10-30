import { isOk, switchOn } from '@visastack/core';
import { and, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { type Db, first, schema } from './db';
import { requestAccountDeletion } from './deletion';
import { enqueueNotificationBothChannels } from './notifications';

/**
 * Inactive-account retention (PRV-02, master directive Part 7 §11): "wallet
 * original: until deletion/inactive-account policy." The directive names no
 * specific inactivity threshold (unlike "closed case: 12m with 30d notice"),
 * so this deliberately mirrors that exact, already-established shape --
 * same 12-month notice threshold, same 30-day notice-to-action window --
 * for internal consistency rather than inventing an unrelated number. Both
 * are env-overridable, matching every other numeric retention default in
 * this codebase (the directive's own table calls its numbers "PRD proposed
 * defaults -- not immutable legal facts").
 *
 * `accounts.lastActiveAt` (touched by `touchAccountActivity` from signed-in
 * requests, at most about once an hour per account, and at once when a
 * notice is pending) drives both sweeps below; see its schema comment
 * for why the column defaults every pre-existing account to "active now"
 * rather than "already inactive" the moment it ships.
 *
 * This is the NOTICE half. It sends a real, informational notification
 * through the existing outbox and records when it did -- never deletes
 * anything itself. `touchAccountActivity` clears `inactivityNoticeSentAt`
 * the moment the account is active again, so returning after this notice
 * (but before the follow-up sweep runs) takes the account out of the
 * at-risk state entirely; a later, separate inactivity period always gets
 * its own fresh notice rather than immediately re-triggering the next
 * stage from a stale flag.
 */
const DEFAULT_INACTIVE_ACCOUNT_NOTICE_MONTHS = 12;
const DEFAULT_INACTIVE_ACCOUNT_SWEEP_LIMIT = 200;

function envInt(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): number | undefined {
  const raw = env[name];
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function envRaw(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  return env[name];
}

function inactiveAccountNoticeMonths(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return envInt(env, 'INACTIVE_ACCOUNT_NOTICE_MONTHS') ?? DEFAULT_INACTIVE_ACCOUNT_NOTICE_MONTHS;
}

export interface InactiveAccountNoticeSweepResult {
  readonly checked: number;
  readonly notified: number;
}

export async function sweepInactiveAccountNotices(
  db: Db,
  limit = DEFAULT_INACTIVE_ACCOUNT_SWEEP_LIMIT,
): Promise<InactiveAccountNoticeSweepResult> {
  const months = inactiveAccountNoticeMonths();
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);

  const due = await db
    .select({ id: schema.accounts.id, email: schema.accounts.email })
    .from(schema.accounts)
    .where(
      and(
        lte(schema.accounts.lastActiveAt, cutoff),
        isNull(schema.accounts.inactivityNoticeSentAt),
      ),
    )
    .limit(limit);

  let notified = 0;
  for (const row of due) {
    const sent = await db.transaction(async (tx) => {
      // Compare-and-set on `inactivityNoticeSentAt` still being null: the
      // same idempotency discipline `sweepCaseRetentionNotices` uses for its
      // own status flip.
      const updated = first(
        await tx
          .update(schema.accounts)
          .set({ inactivityNoticeSentAt: new Date() })
          .where(
            and(eq(schema.accounts.id, row.id), isNull(schema.accounts.inactivityNoticeSentAt)),
          )
          .returning({ id: schema.accounts.id }),
      );
      if (!updated) return false;
      await enqueueNotificationBothChannels(tx, {
        eventType: 'INACTIVE_ACCOUNT_NOTICE',
        resourceId: row.id,
        recipientAccountId: row.id,
        payload: {
          subject: 'Your account has been inactive for a while',
          summary: `We haven't seen you sign in for ${months} months. If you don't sign in within 30 days, we'll begin the account deletion process (with its own final review period before anything is actually deleted). Sign in any time to cancel this.`,
          deepLinkPath: '/app',
        },
      });
      return true;
    });
    if (sent) notified++;
  }
  return { checked: due.length, notified };
}

/**
 * Inactive-account deletion PURGE half: 30 days after the notice above, if
 * STILL genuinely inactive (re-derived fresh against `lastActiveAt`, never
 * a frozen snapshot from notice time -- a returning user's touch already
 * cleared `inactivityNoticeSentAt`, which alone excludes them here), opens
 * a normal, cancellable deletion request via the EXISTING self-service
 * machinery (`requestAccountDeletion`, `method: 'SYSTEM'` so the audit
 * trail never misrepresents this as the account holder's own action).
 * Reuses that function's own grace window (7 days, its existing default)
 * rather than deleting immediately -- the request appears in the exact
 * same "pending deletion, cancel here" UI the privacy page already renders
 * for a self-requested one, since the row itself carries no marker
 * distinguishing how it was created. `requestAccountDeletion`'s own
 * pending-request and active-legal-hold checks apply unchanged; once the
 * request exists, `executeAccountDeletion` (unchanged, run by the existing
 * process-deletions cron) is the actual deletion.
 *
 * Off by default -- `INACTIVE_ACCOUNT_DELETION_ENABLED` must be literally
 * "true" before this sweep ever creates a request, matching
 * `sweepCaseRetentionPurge`'s own safety gating for a materially
 * consequential, hard-to-fully-reverse action (a cancellable request is
 * still a real step toward real deletion).
 */
const DEFAULT_INACTIVE_ACCOUNT_DELETION_GRACE_DAYS = 30;

function inactiveAccountDeletionEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return switchOn(envRaw(env, 'INACTIVE_ACCOUNT_DELETION_ENABLED'));
}

function inactiveAccountDeletionGraceDays(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return (
    envInt(env, 'INACTIVE_ACCOUNT_DELETION_GRACE_DAYS') ??
    DEFAULT_INACTIVE_ACCOUNT_DELETION_GRACE_DAYS
  );
}

export interface InactiveAccountDeletionSweepResult {
  readonly enabled: boolean;
  readonly checked: number;
  readonly requested: number;
  readonly skipped: number;
}

export async function sweepInactiveAccountDeletionRequests(
  db: Db,
  limit = DEFAULT_INACTIVE_ACCOUNT_SWEEP_LIMIT,
): Promise<InactiveAccountDeletionSweepResult> {
  if (!inactiveAccountDeletionEnabled()) {
    return { enabled: false, checked: 0, requested: 0, skipped: 0 };
  }
  const noticeMonths = inactiveAccountNoticeMonths();
  const noticeCutoff = new Date();
  noticeCutoff.setUTCMonth(noticeCutoff.getUTCMonth() - noticeMonths);
  const graceDays = inactiveAccountDeletionGraceDays();
  const graceCutoff = new Date();
  graceCutoff.setUTCDate(graceCutoff.getUTCDate() - graceDays);

  // No separate "no pending request already" filter here --
  // `requestAccountDeletion`'s own existing pending-request check already
  // refuses cleanly (counted below as `skipped`, never thrown) if one
  // exists, the same check every self-service call already relies on.
  const due = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(
      and(
        lte(schema.accounts.lastActiveAt, noticeCutoff),
        isNotNull(schema.accounts.inactivityNoticeSentAt),
        lte(schema.accounts.inactivityNoticeSentAt, graceCutoff),
      ),
    )
    .limit(limit);

  let requested = 0;
  let skipped = 0;
  for (const row of due) {
    const result = await requestAccountDeletion(db, {
      actorAccountId: row.id,
      accountId: row.id,
      method: 'SYSTEM',
      reason: `inactive account policy: no activity for ${noticeMonths}+ months`,
    });
    if (isOk(result)) requested++;
    else skipped++;
  }
  return { enabled: true, checked: due.length, requested, skipped };
}
