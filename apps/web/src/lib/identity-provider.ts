import 'server-only';
import type { IdentityPort, ResolvedIdentity } from '@visastack/services';
import { withAuth } from '@workos-inc/authkit-nextjs';

/**
 * The pilot's identity provider: WorkOS AuthKit (master directive §7 "PR 11"
 * pilot provider list). Wraps `withAuth()` directly rather than reading
 * cookies itself, so it stays correct if AuthKit's session mechanics change.
 *
 * `withSession` (session.ts) does not yet call through this port — it fuses
 * auth, DB pooling, and account provisioning in one function, which this PR
 * does not restructure (see ports.ts's `IdentityPort` doc comment). This
 * class is independently correct and usable wherever only identity, not a DB
 * session, is needed.
 */
export class WorkosIdentityPort implements IdentityPort {
  async currentIdentity(): Promise<ResolvedIdentity | undefined> {
    const { user } = await withAuth();
    if (!user?.email) return undefined;
    return {
      providerId: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
    };
  }
}
