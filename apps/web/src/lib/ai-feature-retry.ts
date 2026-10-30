import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { type AiFeatureKey, isAiFeatureKey } from '@visastack/core/ai-features';
import { readEnv } from './env';

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

function signingKey(): Buffer | null {
  const secret = readEnv('NEON_AUTH_COOKIE_SECRET');
  if (!secret || secret.length < 32) return null;
  return createHmac('sha256', secret).update('visastack.ai-feature-retry.v1').digest();
}

function signature(payload: string, key: Buffer): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/** The cookie value for one set of typed values, or null when it cannot be signed. */
export function encodeAiFeatureRetry(
  retry: AiFeatureRetry,
  accountId: string,
  now: Date = new Date(),
): string | null {
  const key = signingKey();
  if (!key || !LIMIT.test(retry.dailyLimit)) return null;
  const expiresAt = Math.floor(now.getTime() / 1000) + AI_FEATURE_RETRY_LIFETIME_S;
  const payload = Buffer.from(
    JSON.stringify({
      f: retry.feature,
      o: retry.enabled,
      l: retry.dailyLimit,
      a: accountId,
      x: expiresAt,
    }),
    'utf8',
  ).toString('base64url');
  return `${payload}.${signature(payload, key)}`;
}

/** The typed values in a cookie VisaStack signed for this account and that has not expired. */
export function decodeAiFeatureRetry(
  value: string | undefined,
  accountId: string,
  now: Date = new Date(),
): AiFeatureRetry | null {
  const key = signingKey();
  if (!key || !value || value.length > 1024) return null;
  const [payload, presented, extra] = value.split('.');
  if (!payload || !presented || extra !== undefined) return null;
  const expected = Buffer.from(signature(payload, key), 'utf8');
  const given = Buffer.from(presented, 'utf8');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { f, o, l, a, x } = parsed as Record<string, unknown>;
    if (typeof f !== 'string' || !isAiFeatureKey(f)) return null;
    if (typeof o !== 'boolean' || typeof l !== 'string' || !LIMIT.test(l)) return null;
    if (a !== accountId || typeof x !== 'number' || x * 1000 < now.getTime()) return null;
    return { feature: f, enabled: o, dailyLimit: l };
  } catch {
    return null;
  }
}

/** Cookie settings: only the server reads it, only the AI Features page receives it. */
export function aiFeatureRetryCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: AI_FEATURE_RETRY_PATH,
    maxAge: AI_FEATURE_RETRY_LIFETIME_S,
  };
}
