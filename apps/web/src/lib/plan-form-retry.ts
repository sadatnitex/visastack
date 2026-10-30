import 'server-only';
import { signedRetryCookie } from './signed-retry-cookie';

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

const cookie = signedRetryCookie({
  label: 'visastack.plan-form-retry.v1',
  path: PLAN_FORM_RETRY_PATH,
  lifetimeS: PLAN_FORM_RETRY_LIFETIME_S,
  maxLength: 3500,
  refuseLongerThan: 3500,
});

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
  const fields = cleanFields(retry.fields);
  if (!fields || !FORM.test(retry.form)) return null;
  return cookie.encode({ f: retry.form, v: fields }, accountId, now);
}

/** The typed values in a cookie VisaStack signed for this account and that has not expired. */
export function decodePlanFormRetry(
  value: string | undefined,
  accountId: string,
  now: Date = new Date(),
): PlanFormRetry | null {
  const decoded = cookie.decode(value, accountId, now);
  if (!decoded) return null;
  const { f, v } = decoded;
  if (typeof f !== 'string' || !FORM.test(f)) return null;
  const fields = cleanFields(v);
  return fields ? { form: f, fields } : null;
}

/** Cookie settings: only the server reads it, only the Plans page receives it. */
export function planFormRetryCookieOptions(secure: boolean) {
  return cookie.options(secure);
}
