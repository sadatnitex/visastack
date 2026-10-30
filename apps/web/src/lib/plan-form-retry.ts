import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readEnv } from './env';

/**
 * What the platform owner typed on the Plans page, kept across the fresh sign-in check every save
 * needs (S29), so they can check it and choose Save again. Follows `ai-feature-retry.ts` (S21
 * round 3): never carried in the address, httpOnly, scoped to `/app/admin/plans`, 15 minutes,
 * signed with a key derived from the sign-in cookie secret, bound to the account that typed it.
 * A successful save clears it.
 */

export const PLAN_FORM_RETRY_COOKIE = 'vs_plan_form_retry';
export const PLAN_FORM_RETRY_LIFETIME_S = 15 * 60;
export const PLAN_FORM_RETRY_PATH = '/app/admin/plans';

/** Which form the values belong to: a plan id, or "new" for the New Plan form. */
export interface PlanFormRetry {
  readonly form: string;
  /** Field name to typed text, exactly as the form sends it. */
  readonly fields: Readonly<Record<string, string>>;
}

const FORM = /^(new|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const FIELD_NAME = /^[a-zA-Z][a-zA-Z0-9_.:]{0,80}$/;
const MAX_FIELDS = 40;
const MAX_VALUE = 120;
const MAX_COOKIE = 3500;

function signingKey(): Buffer | null {
  const secret = readEnv('NEON_AUTH_COOKIE_SECRET');
  if (!secret || secret.length < 32) return null;
  return createHmac('sha256', secret).update('visastack.plan-form-retry.v1').digest();
}

function signature(payload: string, key: Buffer): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

function cleanFields(fields: unknown): Record<string, string> | null {
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) return null;
  const entries = Object.entries(fields as Record<string, unknown>);
  if (entries.length > MAX_FIELDS) return null;
  const out: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!FIELD_NAME.test(name) || typeof value !== 'string' || value.length > MAX_VALUE) {
      return null;
    }
    out[name] = value;
  }
  return out;
}

/** The cookie value for one set of typed values, or null when it cannot be signed or is too big. */
export function encodePlanFormRetry(
  retry: PlanFormRetry,
  accountId: string,
  now: Date = new Date(),
): string | null {
  const key = signingKey();
  const fields = cleanFields(retry.fields);
  if (!key || !fields || !FORM.test(retry.form)) return null;
  const expiresAt = Math.floor(now.getTime() / 1000) + PLAN_FORM_RETRY_LIFETIME_S;
  const payload = Buffer.from(
    JSON.stringify({ f: retry.form, v: fields, a: accountId, x: expiresAt }),
    'utf8',
  ).toString('base64url');
  const value = `${payload}.${signature(payload, key)}`;
  return value.length <= MAX_COOKIE ? value : null;
}

/** The typed values in a cookie VisaStack signed for this account and that has not expired. */
export function decodePlanFormRetry(
  value: string | undefined,
  accountId: string,
  now: Date = new Date(),
): PlanFormRetry | null {
  const key = signingKey();
  if (!key || !value || value.length > MAX_COOKIE) return null;
  const [payload, presented, extra] = value.split('.');
  if (!payload || !presented || extra !== undefined) return null;
  const expected = Buffer.from(signature(payload, key), 'utf8');
  const given = Buffer.from(presented, 'utf8');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { f, v, a, x } = parsed as Record<string, unknown>;
    if (typeof f !== 'string' || !FORM.test(f)) return null;
    if (a !== accountId || typeof x !== 'number' || x * 1000 < now.getTime()) return null;
    const fields = cleanFields(v);
    return fields ? { form: f, fields } : null;
  } catch {
    return null;
  }
}

/** Cookie settings: only the server reads it, only the Plans page receives it. */
export function planFormRetryCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: PLAN_FORM_RETRY_PATH,
    maxAge: PLAN_FORM_RETRY_LIFETIME_S,
  };
}
