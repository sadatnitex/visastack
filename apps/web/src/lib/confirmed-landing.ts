import { safeReturnPath } from './neon-recency';

/**
 * Where a new person lands after they click the confirmation link in their email (owner decision
 * 10 Nov 2026, "yes P1": land signed in instead of retyping the email and password).
 *
 * The link is checked on Neon Auth's own address; Neon then sends the browser to the address given
 * as `callbackURL` when the confirmation was requested. That address is `CONFIRMED_PATH` here.
 * Neon Auth signs the person in when the link is confirmed (its "sign in after confirmation"
 * setting), but the sign-in cookie VisaStack reads is set by this site, so a signed-in person only
 * arrives when the sign-in check can pass it on (it does so on this path, see `middleware.ts`).
 * A link opened on another device, or one where nothing was passed on, simply leads to the sign-in
 * form with the "confirmed" line, as before.
 *
 * Everything here is pure: the only input from the address is `next`, and it always goes through
 * `safeReturnPath` (one leading slash, no `//`, no backslash, no control characters), so the link
 * cannot send anyone to another site. The person's email address is never put in an address.
 */

export const CONFIRMED_PATH = '/auth/confirmed';

/** The plain-language line shown once after confirming. */
export const CONFIRMED_LINE = 'Your email is confirmed.';

/** `&next=...` for any destination other than the ordinary home, else nothing. */
function nextSuffix(next: string): string {
  return next === '/app' ? '' : `&next=${encodeURIComponent(next)}`;
}

/** The address Neon Auth sends the browser to after the link is confirmed. */
export function confirmedCallbackUrl(baseUrl: string, next: string): string {
  const safe = safeReturnPath(next);
  return `${baseUrl}${CONFIRMED_PATH}${safe === '/app' ? '' : `?next=${encodeURIComponent(safe)}`}`;
}

/** Where a person with no sign-in goes: today's sign-in form with the confirmed line. */
export function confirmedSignInFallback(next: string | null | undefined): string {
  return `/auth/sign-in?n=confirmed${nextSuffix(safeReturnPath(next))}`;
}

/**
 * Where a signed-in person goes: their validated destination. Only the ordinary home carries the
 * one-time `confirmed` line (the first-run screen shows it); a task they came for (an invitation,
 * say) opens exactly as before.
 */
export function confirmedSignedInDestination(next: string | null | undefined): string {
  const safe = safeReturnPath(next);
  return safe === '/app' ? '/app?confirmed=1' : safe;
}

/** The decision for the landing page: one answer from "is there a session" and `next`. */
export function confirmedLandingDecision(input: {
  readonly signedIn: boolean;
  readonly next: string | null | undefined;
}): string {
  return input.signedIn
    ? confirmedSignedInDestination(input.next)
    : confirmedSignInFallback(input.next);
}

/**
 * The sign-in page address the sign-in check sends visitors to when no session arrives. For the
 * landing path it keeps the confirmed line and the validated destination; for every other
 * protected page it is the ordinary `?next=` form.
 */
export function neonLoginUrlFor(pathname: string, search: string): string {
  if (pathname === CONFIRMED_PATH) {
    let next: string | null = null;
    try {
      next = new URLSearchParams(search).get('next');
    } catch {
      next = null;
    }
    return confirmedSignInFallback(next);
  }
  return `/auth/sign-in?next=${encodeURIComponent(`${pathname}${search}`)}`;
}
