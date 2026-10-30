import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readEnv } from './env';

/**
 * One signed cookie for typed values kept across a fresh sign-in check (S29 round 2), used by AI
 * Features (`ai-feature-retry.ts`), the AI file choices (`ai-file-picks-retry.ts`) and the Plans
 * page (`plan-form-retry.ts`), each with its own label, page path and checks.
 *
 * The value is `<payload>.<signature>`: the payload is the page's own fields plus the account
 * that typed them (`a`) and an expiry (`x`), as base64url JSON; the signature is an HMAC with a key
 * derived from the sign-in cookie secret and the page's label, so no new secret is needed, the
 * secret is never exposed, and one page's cookie never verifies on another. It is never carried
 * in the address, is httpOnly and scoped to its page.
 */

export interface SignedRetryCookieConfig {
  /** Distinct per use, for example `visastack.plan-form-retry.v1`. */
  readonly label: string;
  /** The page path the cookie is sent to. */
  readonly path: string;
  readonly lifetimeS: number;
  /** A cookie longer than this is never read. */
  readonly maxLength: number;
  /** When set, a value that would be longer than this is not written (encode gives null). */
  readonly refuseLongerThan?: number;
}

export interface SignedRetryCookie {
  /** The cookie value for the page's fields, or null when it cannot be signed. */
  encode(fields: Readonly<Record<string, unknown>>, accountId: string, now?: Date): string | null;
  /**
   * The page's fields from a cookie VisaStack signed with this label, for this account, not yet
   * expired; null for anything else (tampered, expired, another account, another page).
   */
  decode(value: string | undefined, accountId: string, now?: Date): Record<string, unknown> | null;
  /** Cookie settings: only the server reads it, only its page receives it. */
  options(
    secure: boolean,
    path?: string,
  ): {
    readonly httpOnly: true;
    readonly secure: boolean;
    readonly sameSite: 'lax';
    readonly path: string;
    readonly maxAge: number;
  };
}

export function signedRetryCookie(config: SignedRetryCookieConfig): SignedRetryCookie {
  const signingKey = (): Buffer | null => {
    const secret = readEnv('NEON_AUTH_COOKIE_SECRET');
    if (!secret || secret.length < 32) return null;
    return createHmac('sha256', secret).update(config.label).digest();
  };
  const signature = (payload: string, key: Buffer) =>
    createHmac('sha256', key).update(payload).digest('base64url');
  return {
    encode(fields, accountId, now = new Date()) {
      const key = signingKey();
      if (!key) return null;
      const payload = Buffer.from(
        JSON.stringify({
          ...fields,
          a: accountId,
          x: Math.floor(now.getTime() / 1000) + config.lifetimeS,
        }),
        'utf8',
      ).toString('base64url');
      const value = `${payload}.${signature(payload, key)}`;
      if (config.refuseLongerThan !== undefined && value.length > config.refuseLongerThan) {
        return null;
      }
      return value;
    },
    decode(value, accountId, now = new Date()) {
      const key = signingKey();
      if (!key || !value || value.length > config.maxLength) return null;
      const [payload, presented, extra] = value.split('.');
      if (!payload || !presented || extra !== undefined) return null;
      const expected = Buffer.from(signature(payload, key), 'utf8');
      const given = Buffer.from(presented, 'utf8');
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      try {
        const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
        const fields = parsed as Record<string, unknown>;
        const { a, x } = fields;
        if (a !== accountId) return null;
        if (typeof x !== 'number' || x * 1000 < now.getTime()) return null;
        return fields;
      } catch {
        return null;
      }
    },
    options(secure, path = config.path) {
      return {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path,
        maxAge: config.lifetimeS,
      } as const;
    },
  };
}
