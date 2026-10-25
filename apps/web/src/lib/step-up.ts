import 'server-only';
import {
  type StepUpAssuranceFields,
  issueStepUpAssurance,
  verifyStepUpAssurance,
} from '@visastack/services';
import { neonReauthUrl, neonSessionAgeSeconds } from './neon-recency';

/**
 * Step-up for sensitive actions (master directive §7 "PR 5"; Build Spec §14). Recency comes from
 * the Neon Auth session itself, read server-side (`./neon-recency.ts`), never a client-supplied
 * flag, so "is this session recently authenticated" cannot be forged by the browser. When it is
 * not, the caller is sent to the Neon password re-check page, a real credential challenge.
 *
 * A fresh session only establishes recency in general; it says nothing about *which* sensitive
 * action it should cover. `establishStepUp` converts that general signal into the actual
 * assurance record this request needs (action- and resource-bound, short-lived) via
 * `@visastack/services`'s `issueStepUpAssurance`/`verifyStepUpAssurance` (mint and verify happen
 * together here since the whole check completes within one request; the same primitives support a
 * mint-then-verify-later split for a future multi-step confirmation flow).
 */

const STEP_UP_MAX_AGE_SECONDS = 5 * 60;

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

function signingSecret(): string {
  const secret = readEnv('STEP_UP_SIGNING_SECRET');
  if (!secret) throw new Error('STEP_UP_SIGNING_SECRET is not configured');
  return secret;
}

export interface StepUpRequest {
  readonly accountId: string;
  readonly action: string;
  readonly resourceId: string;
}

export type StepUpResult =
  | { readonly satisfied: true }
  | { readonly satisfied: false; readonly reauthUrl: string };

/**
 * Establish step-up for exactly this account/action/resource, in one call.
 * Fresh session → mints and immediately verifies a real assurance
 * record (never a boolean asserted by the caller). Stale → returns the
 * Neon password re-check URL (a real credential challenge) for the
 * caller to redirect to; `returnTo` should be the same URL the caller is
 * currently serving, so completing reauth lands the user back here to
 * retry — this time fresh.
 */
export async function establishStepUp(
  request: StepUpRequest,
  returnTo: string,
): Promise<StepUpResult> {
  if ((await neonSessionAgeSeconds()) > STEP_UP_MAX_AGE_SECONDS) {
    return { satisfied: false, reauthUrl: neonReauthUrl(returnTo) };
  }
  const secret = signingSecret();
  const token: StepUpAssuranceFields = issueStepUpAssurance(secret, request);
  // Self-verification of a token just minted, moments ago, from the same
  // secret and inputs, cannot fail from staleness — only from a broken
  // signing invariant. That is not "please reauth" (a fresh session
  // wouldn't fix it); fail loudly rather than mis-report it as satisfied or
  // as a reauth prompt that cannot help.
  if (!verifyStepUpAssurance(secret, token, request)) {
    throw new Error('step-up assurance token failed immediate self-verification');
  }
  return { satisfied: true };
}

const NOT_CONFIGURED_MESSAGE = 'STEP_UP_SIGNING_SECRET is not configured';

export type StepUpOutcome =
  | { readonly kind: 'satisfied' }
  | { readonly kind: 'reauth_required'; readonly reauthUrl: string }
  /** `STEP_UP_SIGNING_SECRET` is unset in this environment — an operational
   * configuration gap, not a per-request failure. */
  | { readonly kind: 'not_configured' };

/**
 * Same as `establishStepUp`, but never lets the one specific, operationally
 * recoverable failure — `STEP_UP_SIGNING_SECRET` unset — surface as an
 * unhandled exception (docs/audits/post-programme-defect-register.md
 * finding D-RT1: this genuinely happened on the deployed pilot, as an
 * opaque 500 on `/app/privacy/export`). Every step-up-gated call site
 * should use this, not `establishStepUp` directly, so a missing secret
 * renders a clean, actionable message instead of a server error.
 * `establishStepUp` itself keeps failing loudly (and its test keeps
 * asserting that) — this wrapper only translates that one known condition
 * into a typed outcome, deliberately not weakening the underlying
 * fail-closed behavior for any other cause.
 */
export async function tryEstablishStepUp(
  request: StepUpRequest,
  returnTo: string,
): Promise<StepUpOutcome> {
  try {
    const result = await establishStepUp(request, returnTo);
    return result.satisfied
      ? { kind: 'satisfied' }
      : { kind: 'reauth_required', reauthUrl: result.reauthUrl };
  } catch (error) {
    if (error instanceof Error && error.message === NOT_CONFIGURED_MESSAGE) {
      return { kind: 'not_configured' };
    }
    throw error;
  }
}

/** Safe, non-leaky message for a `not_configured` outcome — never exposes which env var or why. */
export const STEP_UP_NOT_CONFIGURED_MESSAGE =
  'This action requires step-up verification, which is not configured in this environment.';
