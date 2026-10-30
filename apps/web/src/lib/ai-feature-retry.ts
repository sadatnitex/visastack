import 'server-only';
import { type AiFeatureKey, isAiFeatureKey } from '@visastack/core/ai-features';
import { signedRetryCookie } from './signed-retry-cookie';

/**
 * What the platform owner typed on AI Features, kept across the fresh sign-in check that saving
 * needs, so they can check it and choose Save again (S21 round 3). Never carried in the address: a
 * link someone else sent could otherwise fill the form and claim a change was "not saved yet".
 *
 * Follows `pending-confirmation.ts`: the cookie holds the typed values, the account that typed
 * them, an expiry and a signature. It is httpOnly, scoped to `/app/admin/ai`, and lives 15
 * minutes. The key is derived from the sign-in cookie secret with a fixed label, so no new secret
 * is needed and the secret itself is never exposed. A successful save clears it.
 */

export const AI_FEATURE_RETRY_COOKIE = 'vs_ai_feature_retry';
export const AI_FEATURE_RETRY_LIFETIME_S = 15 * 60;
export const AI_FEATURE_RETRY_PATH = '/app/admin/ai';

export interface AiFeatureRetry {
  readonly feature: AiFeatureKey;
  readonly enabled: boolean;
  /** As typed: a whole number of up to four digits, or empty for the plan's limit. */
  readonly dailyLimit: string;
}

const LIMIT = /^\d{0,4}$/;

const cookie = signedRetryCookie({
  label: 'visastack.ai-feature-retry.v1',
  path: AI_FEATURE_RETRY_PATH,
  lifetimeS: AI_FEATURE_RETRY_LIFETIME_S,
  maxLength: 1024,
});

/** The cookie value for one set of typed values, or null when it cannot be signed. */
export function encodeAiFeatureRetry(
  retry: AiFeatureRetry,
  accountId: string,
  now: Date = new Date(),
): string | null {
  if (!LIMIT.test(retry.dailyLimit)) return null;
  return cookie.encode({ f: retry.feature, o: retry.enabled, l: retry.dailyLimit }, accountId, now);
}

/** The typed values in a cookie VisaStack signed for this account and that has not expired. */
export function decodeAiFeatureRetry(
  value: string | undefined,
  accountId: string,
  now: Date = new Date(),
): AiFeatureRetry | null {
  const fields = cookie.decode(value, accountId, now);
  if (!fields) return null;
  const { f, o, l } = fields;
  if (typeof f !== 'string' || !isAiFeatureKey(f)) return null;
  if (typeof o !== 'boolean' || typeof l !== 'string' || !LIMIT.test(l)) return null;
  return { feature: f, enabled: o, dailyLimit: l };
}

/** Cookie settings: only the server reads it, only the AI Features page receives it. */
export function aiFeatureRetryCookieOptions(secure: boolean) {
  return cookie.options(secure);
}
