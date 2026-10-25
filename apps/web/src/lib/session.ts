import 'server-only';
import { createHash } from 'node:crypto';
import { isOk } from '@visastack/core';
import { createPooledDb, resolveDatabaseUrl } from '@visastack/db';
import {
  ACTIVITY_TOUCH_THROTTLE_MS,
  type Db,
  attributeInvitation,
  claimInvitation,
  provisionNeonAccount,
  releaseInvitationClaim,
  touchAccountActivity,
} from '@visastack/services';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { cache } from 'react';
import { NeonIdentityPort } from './identity-provider';
import { checkPilotAccess } from './pilot-access';
import { reportServerError } from './server-error';
import { enforceSessionAgeLimit, isStaffContext } from './session-age';

/**
 * A short, privacy-preserving reference for a subject, safe to write to logs.
 * We never log the raw email (Build Spec §14 / threat model: no PII in logs);
 * a truncated salt-free SHA-256 is enough to correlate a user's requests
 * without being reversible to the address in a log aggregator.
 */
function subjectRef(email: string): string {
  return `acct:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 12)}`;
}

/**
 * True for Next.js's internal `redirect()` control-flow signal (duck-typed
 * on its documented `digest` shape - Next does not export a stable public
 * detector). Lets the catch block below tell a genuine failure apart from
 * the routine, expected "not invited" redirect, which would otherwise log a
 * misleading `[withSession] failed` line for every denied sign-in attempt.
 */
function isNextRedirectSignal(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

/**
 * Best-effort wrapper around `releaseInvitationClaim`: this only ever runs
 * while already unwinding a provisioning failure, so a failure in the
 * release itself must never replace or mask the original error the caller
 * is about to throw/log.
 */
async function releaseClaimBestEffort(db: Db, invitationId: string): Promise<void> {
  try {
    await releaseInvitationClaim(db, invitationId);
  } catch (error) {
    reportServerError('withSession', error, {
      step: 'failed to release invitation claim after a failed provision',
    });
  }
}

/**
 * How often the "still active" timestamp is rewritten for one account: the same window the
 * database write itself already waits (ACTIVITY_TOUCH_THROTTLE_MS, imported from the service so
 * the two cannot drift apart). This check only skips writes the database would have ignored.
 *
 * Why an hour is safe for the inactive-account rules (account-retention.ts): the warning goes out
 * after 12 months without activity and deletion needs a further 30 days, so a timestamp that is
 * at most an hour old can never tip either decision. An account that has already been warned is
 * cleared straight away on its first request, before the page is shown (see `activityWriteNeeded`).
 */
export const ACTIVITY_WRITE_INTERVAL_MS = ACTIVITY_TOUCH_THROTTLE_MS;

export type ActivityWrite = 'none' | 'background' | 'now';

/**
 * Decides, from the account row we already read while signing the person in, whether the
 * "still active" bookkeeping needs a write on this request:
 * - `now`: an inactivity warning is pending. Clear it before the page is shown, so a person who
 *   comes back during the 30-day notice period leaves the at-risk state on their first request.
 * - `background`: the timestamp is over an hour old (or unreadable). Refresh it after the
 *   response has been sent, so it never slows the page.
 * - `none`: written within the last hour; nothing to do (the common case).
 *
 * This only decides whether to TRY. The database write keeps its own condition and stays the
 * authority, so two requests racing here can never write anything wrong.
 */
export function activityWriteNeeded(
  account: {
    readonly lastActiveAt?: Date | string | null;
    readonly inactivityNoticeSentAt?: Date | string | null;
  },
  now: number = Date.now(),
): ActivityWrite {
  if (account.inactivityNoticeSentAt) return 'now';
  const last = account.lastActiveAt ? new Date(account.lastActiveAt).getTime() : Number.NaN;
  if (!Number.isFinite(last)) return 'background';
  return now - last > ACTIVITY_WRITE_INTERVAL_MS ? 'background' : 'none';
}

type Pool = ReturnType<typeof createPooledDb>['pool'];

function openPool(connectionString: string, label: string): { db: Db; pool: Pool } {
  const { db, pool } = createPooledDb(connectionString);
  // A Neon/pg `Pool` emits an `error` event when an *idle* backend connection
  // fails (the WebSocket dropping mid-request is the common case on serverless).
  // With no listener attached, Node re-throws it as an uncaught exception that
  // crashes the whole invocation - surfacing as a bare "server-side exception"
  // digest with nothing actionable in the logs. Swallowing it here keeps the
  // request's own error handling authoritative.
  pool.on('error', (error) => {
    reportServerError(label, error, { step: 'idle pool connection error' });
  });
  return { db: db as unknown as Db, pool };
}

/** A database pool shared by the `withSession` calls that are running at the same time in one request. */
interface SharedPool {
  readonly db: Db;
  readonly pool: Pool;
  users: number;
}

interface SignedInAccount {
  readonly accountId: string;
}

interface RequestScope {
  shared: SharedPool | null;
  resolution: { readonly key: string; readonly promise: Promise<SignedInAccount> } | null;
}

/**
 * Per-request state. React `cache()` hands back the same object to every `withSession` call in
 * one page render (the workspace frame and the page both call it), and a brand-new object for
 * the next request: nothing here is ever shared between two requests or two people. Outside a
 * page render (server actions, route handlers, tests) `cache()` does no caching, so each call
 * gets its own fresh state, which is exactly the behaviour before this existed.
 */
const requestScope = cache((): RequestScope => ({ shared: null, resolution: null }));

function acquirePool(scope: RequestScope, connectionString: string): SharedPool {
  if (!scope.shared) {
    scope.shared = { ...openPool(connectionString, 'withSession'), users: 0 };
  }
  scope.shared.users += 1;
  return scope.shared;
}

/**
 * The last caller still using a pool closes it, exactly once, before its own call returns, so a
 * pool never outlives the work of the request that opened it (the same promise as before, when
 * every call closed its own pool). A later call in the same request simply opens a new one.
 */
async function releasePool(scope: RequestScope, shared: SharedPool): Promise<void> {
  shared.users -= 1;
  if (shared.users > 0) return;
  scope.shared = null;
  await shared.pool.end();
}

/**
 * Refreshes the "still active" timestamp after the response has been sent, on its own short-lived
 * pool that opens and closes inside this one task. A failure is logged and never reaches the
 * person; the next request simply tries again because the timestamp is still old.
 */
async function recordActivityAfterResponse(
  accountId: string,
  connectionString: string,
): Promise<void> {
  const { db, pool } = openPool(connectionString, 'withSession activity');
  try {
    await touchAccountActivity(db, accountId);
  } catch (error) {
    reportServerError('withSession', error, { step: 'background activity write failed' });
  } finally {
    await pool.end();
  }
}

async function scheduleActivityWrite(
  db: Db,
  accountId: string,
  connectionString: string,
): Promise<void> {
  try {
    after(() => recordActivityAfterResponse(accountId, connectionString));
  } catch {
    // `after()` only works inside a Next.js request. Anywhere else, write straight away as before.
    await touchActivitySafely(db, accountId, 'activity write failed');
  }
}

/**
 * The activity timestamp is retention bookkeeping, never a sign-in gate: a failed write is logged
 * and the request carries on. The next request retries, because the stored timestamp (or the
 * pending warning) is still there.
 */
async function touchActivitySafely(db: Db, accountId: string, step: string): Promise<void> {
  try {
    await touchAccountActivity(db, accountId);
  } catch (error) {
    reportServerError('withSession', error, { step });
  }
}

interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly displayName?: string;
}

/**
 * Everything that turns a signed-in identity into a local account the request may act as. It
 * runs once per request (see `resolveOncePerRequest`) and, in order: the pilot-access check,
 * the invitation claim, account provisioning, the staff check and the session-age limit.
 */
async function resolveSignedInAccount(
  db: Db,
  user: SessionUser,
  connectionString: string,
): Promise<SignedInAccount> {
  // Server-authoritative controlled-pilot access boundary (docs/audits/
  // post-programme-defect-register.md finding #2) - checked BEFORE
  // provisioning, on every request. An authenticated-but-uninvited identity must
  // never receive a local account, regardless of how far the sign-in provider itself let
  // them get through sign-in.
  const access = await checkPilotAccess(db, {
    email: user.email,
    workosUserId: null,
  });
  if (!access.allowed) {
    redirect('/pilot-access-denied');
  }

  // Claim the invitation BEFORE provisioning, not after (Codex review, PR
  // #65): if an admin revokes it in the instant between `checkPilotAccess`
  // reading it as active and this claim, the claim now fails and this
  // sign-in must be denied - an admin's revoke must always win a race
  // against a provisioning already in flight. When the invitation was only
  // a best-effort dangling-row cleanup (an account already exists
  // independently - `mustClaimInvitation: false`), a failed claim is
  // harmless and never blocks access.
  let claimedInvitationId: string | null = null;
  if (access.invitationId) {
    const claimed = await claimInvitation(db, access.invitationId);
    if (claimed) {
      claimedInvitationId = access.invitationId;
    } else if (access.mustClaimInvitation) {
      redirect('/pilot-access-denied');
    }
  }

  // Bind the local account to the immutable Neon Auth user id from the trusted
  // server session (never a client-supplied id); email is mutable contact data.
  // If provisioning fails for ANY reason (an identity conflict, a transient
  // database/audit error) after the claim above already committed, the
  // claim must be released - otherwise the invitation is burned with no
  // account ever created, locking out a legitimate retry until an admin
  // issues another invitation (Codex review, PR #65).
  let provisioned: Awaited<ReturnType<typeof provisionNeonAccount>>;
  try {
    provisioned = await provisionNeonAccount(db, {
      email: user.email,
      neonUserId: user.id,
      emailVerified: user.emailVerified,
    });
  } catch (error) {
    if (claimedInvitationId) await releaseClaimBestEffort(db, claimedInvitationId);
    throw error;
  }
  if (!isOk(provisioned)) {
    if (claimedInvitationId) await releaseClaimBestEffort(db, claimedInvitationId);
    if (provisioned.error.code === 'identity_recovery_required') {
      redirect('/auth/account-recovery');
    }
    throw new Error(`account provisioning failed: ${provisioned.error.message}`);
  }
  if (claimedInvitationId) {
    await attributeInvitation(db, {
      invitationId: claimedInvitationId,
      accountId: provisioned.value.id,
    });
  }

  // Absolute session-age cap (SEC-01; directive Part 2 §5): a stale
  // session must be denied on the very next authorized request, not
  // merely at the next sensitive action. See session-age.ts for the
  // staff/traveller threshold and per-account scoping rationale.
  const staffContext = await isStaffContext(db, {
    accountId: provisioned.value.id,
    email: user.email,
  });
  const sessionAge = await enforceSessionAgeLimit(staffContext, '/app');
  if (!sessionAge.satisfied) redirect(sessionAge.reauthUrl);

  // Part 7 §11 inactive-account policy bookkeeping, decided from the row we already have.
  const activity = activityWriteNeeded(provisioned.value);
  if (activity === 'now') {
    await touchActivitySafely(
      db,
      provisioned.value.id,
      'clearing a pending inactivity warning failed',
    );
  } else if (activity === 'background') {
    await scheduleActivityWrite(db, provisioned.value.id, connectionString);
  }

  return { accountId: provisioned.value.id };
}

/**
 * Runs the account checks once per request and lets every other `withSession` call in the same
 * request wait for that same answer, including a refusal: a redirect thrown by the checks is
 * thrown again in every waiting call. The answer is tied to the identity it was worked out for,
 * so a different identity can never pick it up.
 */
function resolveOncePerRequest(
  scope: RequestScope,
  db: Db,
  user: SessionUser,
  connectionString: string,
): Promise<SignedInAccount> {
  const key = JSON.stringify([user.id, user.email]);
  if (scope.resolution?.key !== key) {
    scope.resolution = { key, promise: resolveSignedInAccount(db, user, connectionString) };
  }
  return scope.resolution.promise;
}

/**
 * The session→account bridge. Neon Auth owns authentication; this maps the signed-in user to the
 * local VisaStack account (provisioning it on first login, idempotently) and runs the given work
 * on a transaction-capable pooled connection, closing the pool afterwards. Unauthenticated callers
 * are sent to sign-in; an unconfirmed address is sent to the confirmation page.
 *
 * Within one page render the workspace frame and the page share one identity read, one run of
 * the account checks and, while they overlap, one pool. Every new request starts from nothing.
 */
export async function withSession<T>(
  fn: (ctx: {
    readonly db: Db;
    readonly accountId: string;
    readonly email: string;
    readonly displayName?: string;
  }) => Promise<T>,
): Promise<T> {
  // Who is signed in, from the server-side session only. An address that has not been confirmed
  // yet is sent to the confirmation page and gets no account and no database work.
  const identity = await new NeonIdentityPort().currentIdentity();
  if (!identity) redirect('/auth/sign-in');
  if (!identity.emailVerified) redirect('/auth/verify-email');
  const user: SessionUser = {
    id: identity.providerId,
    email: identity.email,
    emailVerified: true,
    ...(identity.displayName ? { displayName: identity.displayName } : {}),
  };

  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) throw new Error('database not configured');

  const scope = requestScope();
  const shared = acquirePool(scope, connectionString);
  try {
    const account = await resolveOncePerRequest(scope, shared.db, user, connectionString);
    return await fn({
      db: shared.db,
      accountId: account.accountId,
      email: user.email,
      ...(user.displayName ? { displayName: user.displayName } : {}),
    });
  } catch (error) {
    // The routine "not invited" redirect above is expected control flow, not
    // a failure - logging it as one would misleadingly flag every denied
    // sign-in attempt as a server error.
    if (isNextRedirectSignal(error)) throw error;
    // Surface the real cause in the server logs. Next.js masks render-time
    // exceptions behind an opaque digest in production, so without this the
    // actual message (DB connectivity, a failing query, a sign-in session refresh) is
    // invisible. This is the single log line that turns a digest into a
    // diagnosis.
    reportServerError('withSession', error, { subject: subjectRef(user.email) });
    throw error;
  } finally {
    await releasePool(scope, shared);
  }
}
