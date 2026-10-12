import 'server-only';
import { createHash } from 'node:crypto';
import { isOk } from '@visastack/core';
import { createPooledDb, resolveDatabaseUrl } from '@visastack/db';
import {
  type Db,
  attributeInvitation,
  claimInvitation,
  provisionAccount,
  provisionNeonAccount,
  releaseInvitationClaim,
  touchAccountActivity,
} from '@visastack/services';
import { withAuth } from '@workos-inc/authkit-nextjs';
import { redirect } from 'next/navigation';
import { NeonIdentityPort } from './identity-provider';
import { selectedIdentityProvider } from './identity-selection';
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
 * The session→account bridge. WorkOS AuthKit owns authentication; this maps the
 * signed-in WorkOS user to the local VisaStack account (provisioning it on first
 * login, idempotently) and runs the given work on a transaction-capable pooled
 * connection, closing the pool afterwards. Unauthenticated callers are
 * redirected to sign-in by `ensureSignedIn`.
 */
export async function withSession<T>(
  fn: (ctx: {
    readonly db: Db;
    readonly accountId: string;
    readonly email: string;
    readonly displayName?: string;
  }) => Promise<T>,
): Promise<T> {
  const neon = selectedIdentityProvider() === 'neon_auth';
  // Who is signed in, from the server-side session only. With Neon Auth, an address that has not
  // been confirmed yet is sent to the confirmation page and gets no account and no database work.
  let user: {
    readonly id: string;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly displayName?: string;
  };
  if (neon) {
    const identity = await new NeonIdentityPort().currentIdentity();
    if (!identity) redirect('/auth/sign-in');
    if (!identity.emailVerified) redirect('/auth/verify-email');
    user = {
      id: identity.providerId,
      email: identity.email,
      emailVerified: true,
      ...(identity.displayName ? { displayName: identity.displayName } : {}),
    };
  } else {
    // Read-only: the middleware (with `middlewareAuth` enabled) has already
    // enforced sign-in and refreshed the token, so this never writes cookies
    // during the render. `ensureSignedIn` is intentionally NOT passed - forcing a
    // refresh here is what threw "Cookies can only be modified in a Server Action
    // or Route Handler" on protected pages.
    const { user: workosUser } = await withAuth();
    // A signed-in visit already passed middleware's sign-in check; landing here
    // with no user means the session lapsed between that check and this render
    // (or this action's submission) - e.g. an expired/revoked WorkOS session.
    // That's routine, recoverable, and not a bug: send them back through the
    // existing sign-in flow instead of surfacing the generic error boundary,
    // which would misleadingly read as a server fault ("this is on our side").
    if (!workosUser?.email) redirect('/app');
    user = { id: workosUser.id, email: workosUser.email, emailVerified: workosUser.emailVerified };
  }

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
    reportServerError('withSession', error, { step: 'idle pool connection error' });
  });
  const handle = db as unknown as Db;
  try {
    // Server-authoritative controlled-pilot access boundary (docs/audits/
    // post-programme-defect-register.md finding #2) — checked BEFORE
    // provisioning, every time. An authenticated-but-uninvited identity must
    // never receive a local account, regardless of how far WorkOS itself let
    // them get through sign-in.
    const access = await checkPilotAccess(handle, {
      email: user.email,
      workosUserId: neon ? null : user.id,
    });
    if (!access.allowed) {
      redirect('/pilot-access-denied');
    }

    // Claim the invitation BEFORE provisioning, not after (Codex review, PR
    // #65): if an admin revokes it in the instant between `checkPilotAccess`
    // reading it as active and this claim, the claim now fails and this
    // sign-in must be denied — an admin's revoke must always win a race
    // against a provisioning already in flight. When the invitation was only
    // a best-effort dangling-row cleanup (an account already exists
    // independently — `mustClaimInvitation: false`), a failed claim is
    // harmless and never blocks access.
    let claimedInvitationId: string | null = null;
    if (access.invitationId) {
      const claimed = await claimInvitation(handle, access.invitationId);
      if (claimed) {
        claimedInvitationId = access.invitationId;
      } else if (access.mustClaimInvitation) {
        redirect('/pilot-access-denied');
      }
    }

    // Bind the local account to the immutable WorkOS user id from the trusted
    // server session (never a client-supplied id); email is mutable contact data.
    // If provisioning fails for ANY reason (an identity conflict, a transient
    // database/audit error) after the claim above already committed, the
    // claim must be released — otherwise the invitation is burned with no
    // account ever created, locking out a legitimate retry until an admin
    // issues another invitation (Codex review, PR #65).
    let provisioned: Awaited<ReturnType<typeof provisionAccount>>;
    try {
      provisioned = neon
        ? await provisionNeonAccount(handle, {
            email: user.email,
            neonUserId: user.id,
            emailVerified: user.emailVerified,
          })
        : await provisionAccount(handle, {
            email: user.email,
            workosUserId: user.id,
            emailVerified: user.emailVerified,
          });
    } catch (error) {
      if (claimedInvitationId) await releaseClaimBestEffort(handle, claimedInvitationId);
      throw error;
    }
    if (!isOk(provisioned)) {
      if (claimedInvitationId) await releaseClaimBestEffort(handle, claimedInvitationId);
      if (provisioned.error.code === 'identity_recovery_required') {
        redirect('/auth/account-recovery');
      }
      throw new Error(`account provisioning failed: ${provisioned.error.message}`);
    }
    if (claimedInvitationId) {
      await attributeInvitation(handle, {
        invitationId: claimedInvitationId,
        accountId: provisioned.value.id,
      });
    }

    // Absolute session-age cap (SEC-01; directive Part 2 §5): a stale
    // session must be denied on the very next authorized request, not
    // merely at the next sensitive action. See session-age.ts for the
    // staff/traveller threshold and per-account scoping rationale.
    const staffContext = await isStaffContext(handle, {
      accountId: provisioned.value.id,
      email: user.email,
    });
    const sessionAge = await enforceSessionAgeLimit(staffContext, '/app');
    if (!sessionAge.satisfied) redirect(sessionAge.reauthUrl);

    // Part 7 §11 inactive-account policy bookkeeping -- throttled to a no-op
    // write on most requests, see touchAccountActivity's own doc comment.
    await touchAccountActivity(handle, provisioned.value.id);

    return await fn({
      db: handle,
      accountId: provisioned.value.id,
      email: user.email,
      ...(user.displayName ? { displayName: user.displayName } : {}),
    });
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
    reportServerError('withSession', error, { subject: subjectRef(user.email) });
    throw error;
  } finally {
    await pool.end();
  }
}
