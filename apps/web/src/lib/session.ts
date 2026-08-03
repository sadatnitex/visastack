import 'server-only';
import { createHash } from 'node:crypto';
import { isOk } from '@visastack/core';
import { createPooledDb, resolveDatabaseUrl } from '@visastack/db';
import { type Db, markInvitationAccepted, provisionAccount } from '@visastack/services';
import { withAuth } from '@workos-inc/authkit-nextjs';
import { redirect } from 'next/navigation';
import { checkPilotAccess } from './pilot-access';

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
 * on its documented `digest` shape — Next does not export a stable public
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
 * The session→account bridge. WorkOS AuthKit owns authentication; this maps the
 * signed-in WorkOS user to the local VisaStack account (provisioning it on first
 * login, idempotently) and runs the given work on a transaction-capable pooled
 * connection, closing the pool afterwards. Unauthenticated callers are
 * redirected to sign-in by `ensureSignedIn`.
 */
export async function withSession<T>(
  fn: (ctx: { readonly db: Db; readonly accountId: string; readonly email: string }) => Promise<T>,
): Promise<T> {
  // Read-only: the middleware (with `middlewareAuth` enabled) has already
  // enforced sign-in and refreshed the token, so this never writes cookies
  // during the render. `ensureSignedIn` is intentionally NOT passed — forcing a
  // refresh here is what threw "Cookies can only be modified in a Server Action
  // or Route Handler" on protected pages.
  const { user } = await withAuth();
  // A signed-in visit already passed middleware's sign-in check; landing here
  // with no user means the session lapsed between that check and this render
  // (or this action's submission) — e.g. an expired/revoked WorkOS session.
  // That's routine, recoverable, and not a bug: send them back through the
  // existing sign-in flow instead of surfacing the generic error boundary,
  // which would misleadingly read as a server fault ("this is on our side").
  if (!user?.email) redirect('/app');

  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) throw new Error('database not configured');

  const { db, pool } = createPooledDb(connectionString);
  // A Neon/pg `Pool` emits an `error` event when an *idle* backend connection
  // fails (the WebSocket dropping mid-request is the common case on serverless).
  // With no listener attached, Node re-throws it as an uncaught exception that
  // crashes the whole invocation — surfacing as a bare "server-side exception"
  // digest with nothing actionable in the logs. Swallowing it here keeps the
  // request's own error handling (below) authoritative.
  pool.on('error', (error) => {
    console.error('[withSession] idle pool connection error', error);
  });
  const handle = db as unknown as Db;
  try {
    // Server-authoritative controlled-pilot access boundary (docs/audits/
    // post-programme-defect-register.md finding #2) — checked BEFORE
    // provisioning, every time. An authenticated-but-uninvited identity must
    // never receive a local account, regardless of how far WorkOS itself let
    // them get through sign-in.
    const access = await checkPilotAccess(handle, { email: user.email, workosUserId: user.id });
    if (!access.allowed) {
      redirect('/pilot-access-denied');
    }

    // Bind the local account to the immutable WorkOS user id from the trusted
    // server session (never a client-supplied id); email is mutable contact data.
    const provisioned = await provisionAccount(handle, {
      email: user.email,
      workosUserId: user.id,
      emailVerified: user.emailVerified,
    });
    if (!isOk(provisioned)) {
      throw new Error(`account provisioning failed: ${provisioned.error.message}`);
    }
    if (access.invitationId) {
      await markInvitationAccepted(handle, {
        invitationId: access.invitationId,
        accountId: provisioned.value.id,
      });
    }
    return await fn({ db: handle, accountId: provisioned.value.id, email: user.email });
  } catch (error) {
    // The routine "not invited" redirect above is expected control flow, not
    // a failure — logging it as one would misleadingly flag every denied
    // sign-in attempt as a server error.
    if (isNextRedirectSignal(error)) throw error;
    // Surface the real cause in the server logs. Next.js masks render-time
    // exceptions behind an opaque digest in production, so without this the
    // actual message (DB connectivity, a failing query, a WorkOS refresh) is
    // invisible. This is the single log line that turns a digest into a
    // diagnosis.
    console.error('[withSession] failed for', subjectRef(user.email), '—', error);
    throw error;
  } finally {
    await pool.end();
  }
}
