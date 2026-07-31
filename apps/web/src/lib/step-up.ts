import 'server-only';
import {
  type StepUpAssuranceFields,
  issueStepUpAssurance,
  verifyStepUpAssurance,
} from '@visastack/services';
import { checkRecentAuth, getSignInUrl } from '@workos-inc/authkit-nextjs';

/**
 * Genuine WorkOS-compatible step-up (master directive §7 "PR 5"; Build Spec
 * §14). `checkRecentAuth` reads the real `auth_time` claim off the signed
 * WorkOS access token server-side — never a client-supplied flag — so
 * "is this session recently authenticated" cannot be forged by the browser.
 * When it isn't, `getSignInUrl({ maxAge })` forwards OIDC `max_age` so
 * WorkOS's own IdP forces a fresh credential challenge, not a local-only
 * dialog standing in for one.
 *
 * A fresh WorkOS session only establishes recency in general; it says
 * nothing about *which* sensitive action it should cover. `establishStepUp`
 * converts that general signal into the actual assurance record this
 * request needs — action- and resource-bound, short-lived — via
 * `@visastack/services`'s `issueStepUpAssurance`/`verifyStepUpAssurance`
 * (mint and verify happen together here since the whole check completes
 * within one request; the same primitives support a mint-then-verify-later
 * split for a future multi-step confirmation flow).
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
 * Fresh WorkOS session → mints and immediately verifies a real assurance
 * record (never a boolean asserted by the caller). Stale → returns a
 * genuine WorkOS reauthentication URL (never a local substitute) for the
 * caller to redirect to; `returnTo` should be the same URL the caller is
 * currently serving, so completing reauth lands the user back here to
 * retry — this time fresh.
 */
export async function establishStepUp(
  request: StepUpRequest,
  returnTo: string,
): Promise<StepUpResult> {
  const { isStale } = await checkRecentAuth({ maxAge: STEP_UP_MAX_AGE_SECONDS });
  if (isStale) {
    const reauthUrl = await getSignInUrl({ maxAge: STEP_UP_MAX_AGE_SECONDS, returnTo });
    return { satisfied: false, reauthUrl };
  }
  const secret = signingSecret();
  const token: StepUpAssuranceFields = issueStepUpAssurance(secret, request);
  // Self-verification of a token just minted, moments ago, from the same
  // secret and inputs, cannot fail from staleness — only from a broken
  // signing invariant. That is not "please reauth" (a fresh WorkOS session
  // wouldn't fix it); fail loudly rather than mis-report it as satisfied or
  // as a reauth prompt that cannot help.
  if (!verifyStepUpAssurance(secret, token, request)) {
    throw new Error('step-up assurance token failed immediate self-verification');
  }
  return { satisfied: true };
}
