import 'server-only';
import type { IdentityPort, ResolvedIdentity } from '@visastack/services';

/** The part of a Neon Auth server instance this port needs (narrow so a test can stand in). */
export interface NeonSessionReader {
  getSession(): Promise<{
    data: {
      user?: {
        name?: string | null;
        id: string;
        email?: string | null;
        emailVerified?: boolean | null;
      } | null;
    } | null;
  }>;
}

/**
 * Neon Auth identity (managed Better Auth, users kept in the Neon database): a verified-or-not
 * email and a stable provider id, or nothing when nobody is signed in. Whether the email is verified is passed through unchanged; callers that link an
 * existing account must refuse an unverified address.
 */
export class NeonIdentityPort implements IdentityPort {
  constructor(
    // The default shares one Neon Auth read per page request (see neon-request-session.ts).
    private readonly reader: () => NeonSessionReader | Promise<NeonSessionReader> = async () =>
      (
        await import('./neon-request-session')
      ).requestSessionReader() as unknown as NeonSessionReader,
  ) {}

  async currentIdentity(): Promise<ResolvedIdentity | undefined> {
    const { data } = await (await this.reader()).getSession();
    const user = data?.user;
    if (!user?.email) return undefined;
    return {
      ...(typeof user.name === 'string' && user.name.trim()
        ? { displayName: user.name.trim() }
        : {}),
      providerId: user.id,
      email: user.email,
      emailVerified: user.emailVerified === true,
    };
  }
}
