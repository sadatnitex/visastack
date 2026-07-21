import 'server-only';
import { isOk } from '@visastack/core';
import { createPooledDb, resolveDatabaseUrl } from '@visastack/db';
import { type Db, provisionAccount } from '@visastack/services';
import { withAuth } from '@workos-inc/authkit-nextjs';

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
  const handle = db as unknown as Db;
  try {
    const provisioned = await provisionAccount(handle, { email: user.email });
    if (!isOk(provisioned)) throw new Error('account provisioning failed');
    return await fn({ db: handle, accountId: provisioned.value.id, email: user.email });
  } finally {
    await pool.end();
  }
}
