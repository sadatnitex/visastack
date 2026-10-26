import 'server-only';
import { type Db, listMembershipsForAccount } from '@visastack/services';
import { holdsPlatformRole } from './admin';
import { neonReauthUrl, neonSessionAgeSeconds } from './neon-recency';

/**
 * Absolute session-age enforcement (Commercial V1 SEC-01; implementation
 * directive Part 2 §5: "staff absolute max 12 hours; traveller session max
 * 7 days"). Reuses the same Neon Auth session-age check
 * `establishStepUp` (`./step-up.ts`) already relies on for step-up, applied
 * unconditionally on every authenticated request via `withSession` rather
 * than only at specific sensitive actions.
 *
 * Scoping, stated plainly: this is enforced per ACCOUNT, not per route. The
 * directive's exact wording ("users with traveller + staff roles must
 * satisfy staff rules when entering staff context") implies a route-scoped
 * check; doing that precisely would mean threading a context flag through
 * every one of the ~38 `withSession` call sites across the app. Applying
 * the stricter staff limit to the WHOLE account whenever any active
 * organization membership or platform role exists is the safe direction of
 * that same rule, never a longer session than the spec allows for a role
 * the account holds, at most stricter for a genuinely dual-role account on
 * its traveller-facing pages too, enforced here as a single, well-tested
 * chokepoint instead. Idle timeout (30-minute staff) is a separate,
 * not-yet-built mechanism (needs last-activity tracking, not just
 * `auth_time`) and is tracked as open in the requirements ledger, not
 * silently folded into this check.
 */

const STAFF_MAX_SESSION_AGE_SECONDS = 12 * 60 * 60;
const TRAVELLER_MAX_SESSION_AGE_SECONDS = 7 * 24 * 60 * 60;

/** True if the account currently holds any active organization membership or platform role. */
export async function isStaffContext(
  db: Db,
  ctx: { readonly accountId: string; readonly email: string },
): Promise<boolean> {
  const memberships = await listMembershipsForAccount(db, ctx.accountId);
  if (memberships.some((m) => m.active)) return true;
  // The role itself decides the session limit, not whether a code was proved yet: a staff
  // session must not get the longer traveller limit just because the code is still to come.
  return holdsPlatformRole(db, ctx);
}

export type SessionAgeResult =
  | { readonly satisfied: true }
  | { readonly satisfied: false; readonly reauthUrl: string };

/**
 * Fails closed toward MORE reauthentication, never less: a stale session
 * for the applicable max age returns a reauthentication URL for the caller
 * to redirect to, the same shape `establishStepUp` already returns, so
 * callers use the identical `redirect(result.reauthUrl)` pattern.
 *
 * The URL is the Neon password re-check page, with a same-origin return path.
 */
export async function enforceSessionAgeLimit(
  staffContext: boolean,
  returnTo: string,
): Promise<SessionAgeResult> {
  const maxAge = staffContext ? STAFF_MAX_SESSION_AGE_SECONDS : TRAVELLER_MAX_SESSION_AGE_SECONDS;
  if ((await neonSessionAgeSeconds()) > maxAge) {
    return { satisfied: false, reauthUrl: neonReauthUrl(returnTo) };
  }
  return { satisfied: true };
}
