import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Step-up / reauthentication assurance (master directive §7 "PR 5"; Build
 * Spec §14). "Never represent step-up as a Boolean supplied by the browser
 * — use a server-generated, short-lived, action-bound assurance record."
 *
 * This is that record: a signed, stateless token binding a specific account
 * to a specific action on a specific resource, valid only briefly. Mirrors
 * `blob-token.ts`'s exact HMAC pattern (same primitives, same shape) rather
 * than inventing a second signing convention — the two concerns are
 * unrelated (this never touches storage), but "how a short-lived signed
 * capability is constructed and verified" is one canonical pattern.
 *
 * Minting a token is NOT itself the step-up check — the caller must first
 * establish genuine recency (WorkOS `checkRecentAuth`/`getSignInUrl({
 * maxAge })`, which reads the real `auth_time` JWT claim server-side; see
 * `apps/web/src/lib/step-up.ts`). This module only makes that one-time
 * confirmation replay-safe and action-bound for the handful of requests
 * that follow it, so a sensitive action isn't gated on re-running the WorkOS
 * round trip on every single call.
 */

const DEFAULT_TTL_SECONDS = 5 * 60;

export interface StepUpAssuranceFields {
  readonly accountId: string;
  readonly action: string;
  readonly resourceId: string;
  readonly exp: number;
  readonly sig: string;
}

function signingPayload(
  accountId: string,
  action: string,
  resourceId: string,
  exp: number,
): string {
  return `${accountId}.${action}.${resourceId}.${exp}`;
}

export function signStepUpAssurance(
  secret: string,
  accountId: string,
  action: string,
  resourceId: string,
  exp: number,
): string {
  return createHmac('sha256', secret)
    .update(signingPayload(accountId, action, resourceId, exp))
    .digest('hex');
}

/** Mint a fresh, short-lived assurance token for exactly this account/action/resource. */
export function issueStepUpAssurance(
  secret: string,
  input: { readonly accountId: string; readonly action: string; readonly resourceId: string },
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  now: number = Date.now(),
): StepUpAssuranceFields {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return {
    accountId: input.accountId,
    action: input.action,
    resourceId: input.resourceId,
    exp,
    sig: signStepUpAssurance(secret, input.accountId, input.action, input.resourceId, exp),
  };
}

/**
 * Verify an assurance token against the request actually being made: correct
 * signature, not expired, and bound to this exact account/action/resource —
 * a token minted for one action or resource is never accepted for another,
 * and a token minted for a different account is never accepted here.
 */
export function verifyStepUpAssurance(
  secret: string,
  token: StepUpAssuranceFields,
  expected: { readonly accountId: string; readonly action: string; readonly resourceId: string },
  now: number = Date.now(),
): boolean {
  if (token.accountId !== expected.accountId) return false;
  if (token.action !== expected.action) return false;
  if (token.resourceId !== expected.resourceId) return false;
  if (!Number.isFinite(token.exp) || token.exp * 1000 < now) return false;
  const good = signStepUpAssurance(
    secret,
    token.accountId,
    token.action,
    token.resourceId,
    token.exp,
  );
  const a = Buffer.from(good);
  const b = Buffer.from(token.sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
