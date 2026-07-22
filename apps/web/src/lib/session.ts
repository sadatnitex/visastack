import 'server-only';
import { createHash } from 'node:crypto';
import { isOk } from '@visastack/core';
import { createPooledDb, resolveDatabaseUrl } from '@visastack/db';
import { type Db, provisionAccount } from '@visastack/services';
import { withAuth } from '@workos-inc/authkit-nextjs';

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
  if (!user?.email) throw new Error('no authenticated user');

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
    const provisioned = await provisionAccount(handle, { email: user.email });
    if (!isOk(provisioned)) {
      throw new Error(`account provisioning failed: ${provisioned.error.message}`);
    }
    return await fn({ db: handle, accountId: provisioned.value.id, email: user.email });
  } catch (error) {
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
