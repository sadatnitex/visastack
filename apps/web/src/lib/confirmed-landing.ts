import { safeReturnPath } from './safe-return-path';

/**
 * Where a new person lands after they click the confirmation link in their email (owner decision
 * 10 Nov 2026, "yes P1": land signed in instead of retyping the email and password).
 *
 * The link is checked on Neon Auth's own address; Neon then sends the browser to the address given
 * as `callbackURL` when the confirmation was requested. That address is `CONFIRMED_PATH` here.
 * Neon Auth signs the person in when the link is confirmed (its "sign in after confirmation"
 * setting, on in production), but the sign-in cookie VisaStack reads is set by this site, so a
 * signed-in person only arrives when the sign-in check can pass it on (it runs on this path first,
 * see `middleware.ts`). A link opened on another device, or one where nothing was passed on,
 * leads to the sign-in form with the "confirmed" line, as before. A link that is expired or was
 * already used is told apart (Neon Auth adds `error` to the address) and never says "confirmed".
 *
 * Everything here is pure and import-free apart from `safeReturnPath` (the middleware loads this
 * file): the only input from the address is `next`, and it always goes through `safeReturnPath`
 * (one leading slash, no `//`, no backslash, no control characters), so the link cannot send
 * anyone to another site. The person's email address is never put in an address.
 */

export const CONFIRMED_PATH = '/auth/confirmed';

/** The plain-language line shown once after confirming. */
export const CONFIRMED_LINE = 'Your email is confirmed.';

/** `&next=...` for any destination other than the ordinary home, else nothing. */
export function signInNextSuffix(next: string): string {
  return next === '/app' ? '' : `&next=${encodeURIComponent(next)}`;
}

/** The validated destination, ready to place after `/auth/confirmed?next=` in the callback address. */
export function confirmedCallbackNext(next: string | null | undefined): string {
  return encodeURIComponent(safeReturnPath(next));
}

/** Where a person with no sign-in goes: today's sign-in form with the confirmed line. */
export function confirmedSignInFallback(next: string | null | undefined): string {
  return `/auth/sign-in?n=confirmed${signInNextSuffix(safeReturnPath(next))}`;
}

/** Where a link that failed (expired, already used) goes: ask for a new one, never "confirmed". */
export function confirmedFailedDestination(next: string | null | undefined): string {
  return `/auth/verify-email?e=expired${signInNextSuffix(safeReturnPath(next))}`;
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

/** The decision for the landing page: one answer from the link's outcome, the session and `next`. */
export function confirmedLandingDecision(input: {
  readonly signedIn: boolean;
  readonly next: unknown;
  /** True when Neon Auth reported a problem with the link (an `error` on the address). */
  readonly failed?: boolean;
}): string {
  if (input.failed) return confirmedFailedDestination(safeReturnPath(input.next));
  return input.signedIn
    ? confirmedSignedInDestination(safeReturnPath(input.next))
    : confirmedSignInFallback(safeReturnPath(input.next));
}

/**
 * The page the sign-in check sends visitors to when no session arrives. For the landing path it
 * keeps the confirmed line and the validated destination (always spelled out, so the check does
 * not copy the raw `next` from the address back on), and sends a failed link to ask for a new one;
 * for every other protected page it is the ordinary `?next=` form.
 */
export function neonLoginUrlFor(pathname: string, search: string): string {
  if (pathname === CONFIRMED_PATH) {
    const params = new URLSearchParams(search);
    const next = safeReturnPath(params.get('next'));
    if (params.has('error')) return confirmedFailedDestination(next);
    return `/auth/sign-in?n=confirmed&next=${encodeURIComponent(next)}`;
  }
  return `/auth/sign-in?next=${encodeURIComponent(`${pathname}${search}`)}`;
}
