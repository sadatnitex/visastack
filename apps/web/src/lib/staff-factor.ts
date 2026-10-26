import 'server-only';
import {
  type Db,
  STAFF_FACTOR_FRESH_MS,
  getStaffFactorStatus,
  hasAnyPlatformRole,
  isStaffFactorFresh,
} from '@visastack/services';
import { bootstrapAdminEmails } from './admin-emails';
import { neonSessionAgeSeconds, neonSessionRef, safeReturnPath } from './neon-recency';
import { withSession } from './session';

/**
 * The staff authenticator-app rule (S3, M08) as the web app applies it.
 *
 * `STAFF_SECOND_FACTOR` is `off` (the default, so deploying this never locks anyone out before
 * the owner has set an authenticator up) or `required`. Any other value counts as `required`:
 * a typo can only ask for more, never for less. The rule applies to accounts that hold a
 * platform role, including the one-time ADMIN_EMAILS bootstrap address.
 */

export type StaffFactorMode = 'off' | 'required';

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

export function staffFactorMode(): StaffFactorMode {
  const raw = readEnv('STAFF_SECOND_FACTOR')?.trim().toLowerCase();
  if (raw === undefined || raw === '' || raw === 'off') return 'off';
  return 'required';
}

/** The page where staff enter a code or set the app up. Lives outside /app/admin so it can never loop. */
export const STAFF_CODE_PATH = '/app/staff-code';

export function staffCodeUrl(returnTo: string): string {
  return `${STAFF_CODE_PATH}?returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`;
}

export type StaffFactorGate =
  | { readonly kind: 'ok' }
  /** Send the person here: set the app up, or enter a code. */
  | { readonly kind: 'redirect'; readonly url: string }
  /** The check cannot be made right now (no table yet, no readable sign-in). Fail closed. */
  | { readonly kind: 'unavailable' };

/**
 * Whether a privileged action may go ahead, as far as the authenticator rule is concerned.
 * Not staff, or the rule is off: yes. Staff with a code proved in this sign-in within five
 * minutes: yes. Anything else asks for a code, and anything unreadable refuses.
 */
export async function staffFactorGate(
  accountId: string,
  returnTo: string,
  options: { readonly anyAge?: boolean } = {},
): Promise<StaffFactorGate> {
  if (staffFactorMode() === 'off') return { kind: 'ok' };
  return withSession(async ({ db, accountId: signedIn, email }) => {
    if (signedIn !== accountId) return { kind: 'unavailable' } as const;
    const holdsRole = await hasAnyPlatformRole(db, {
      accountId,
      email,
      bootstrapEmails: bootstrapAdminEmails(),
    });
    if (!holdsRole) return { kind: 'ok' } as const;
    const sessionRef = await neonSessionRef();
    if (!sessionRef) return { kind: 'unavailable' } as const;
    const status = await getStaffFactorStatus(db, accountId);
    if (status.state === 'unavailable') return { kind: 'unavailable' } as const;
    if (status.state === 'active') {
      const fresh = await isStaffFactorFresh(db, {
        accountId,
        sessionRef,
        maxAgeMs: options.anyAge ? null : STAFF_FACTOR_FRESH_MS,
      });
      if (fresh) return { kind: 'ok' } as const;
    }
    return { kind: 'redirect', url: staffCodeUrl(returnTo) } as const;
  });
}

/** True when the password was typed in the last five minutes (the same rule step-up uses). */
export async function passwordIsRecent(): Promise<boolean> {
  return (await neonSessionAgeSeconds()) <= STAFF_FACTOR_FRESH_MS / 1000;
}

/**
 * Whether this sign-in has proved an authenticator code (at any time since sign-in), for an
 * account already known to hold a platform role. The platform checks in `./admin` call this, so
 * every page, action and scope that needs a platform role also needs the code, not only the
 * platform layout (a layout does not run for every request). Rule off: always true. Nothing
 * readable (no sign-in, no table, no enrolment): false.
 */
export async function staffFactorProvedForSignIn(db: Db, accountId: string): Promise<boolean> {
  if (staffFactorMode() === 'off') return true;
  const sessionRef = await neonSessionRef();
  if (!sessionRef) return false;
  return isStaffFactorFresh(db, { accountId, sessionRef, maxAgeMs: null });
}
