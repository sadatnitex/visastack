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

/** The part of a Neon Auth server instance this port needs (narrow so a test can stand in). */
export interface NeonSessionReader {
  getSession(): Promise<{
    data: {
      user?: { id: string; email?: string | null; emailVerified?: boolean | null } | null;
    } | null;
  }>;
}

/**
 * Neon Auth identity (managed Better Auth, users kept in the Neon database). Same contract as
 * the WorkOS port: a verified-or-not email and a stable provider id, or nothing when nobody is
 * signed in. Whether the email is verified is passed through unchanged; callers that link an
 * existing account must refuse an unverified address.
 */
export class NeonIdentityPort implements IdentityPort {
  constructor(
    private readonly reader: () => NeonSessionReader | Promise<NeonSessionReader> = async () =>
      (await import('./neon-auth')).getNeonAuth() as unknown as NeonSessionReader,
  ) {}

  async currentIdentity(): Promise<ResolvedIdentity | undefined> {
    const { data } = await (await this.reader()).getSession();
    const user = data?.user;
    if (!user?.email) return undefined;
    return {
      providerId: user.id,
      email: user.email,
      emailVerified: user.emailVerified === true,
    };
  }
}
