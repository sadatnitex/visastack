import 'server-only';
import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { AI_FILE_CHOICES_MAX, type AiFileChoice } from './ai-consent-choices';
import { signedRetryCookie } from './signed-retry-cookie';

/**
 * The documents a person ticked under "Original Files" (S20), kept across the fresh sign-in check
 * an Original needs, so the screen comes back with them ticked. Never carried in the address: a
 * link someone else sent could otherwise tick files to give to an AI app.
 *
 * Follows `ai-feature-retry.ts`: the cookie holds the ticked documents, the account, the record
 * and which form they belong to (the consent screen, or one connection's Change Access), an expiry
 * and a signature. It is httpOnly, scoped to the one page that reads it, and lives 15 minutes. The
 * key is derived from the sign-in cookie secret with its own fixed label. A successful save clears
 * it. It only fills the boxes again: the person still presses Allow or Save, and the server checks
 * every document again.
 */

export const AI_FILE_PICKS_COOKIE = 'vs_ai_file_picks';
export const AI_FILE_PICKS_LIFETIME_S = 15 * 60;
/** The consent screen's own form, as `target`. */
export const AI_FILE_PICKS_CONSENT = 'consent';

export interface AiFilePicksRetry {
  readonly applicantId: string;
  /** `consent`, or the connection id of a Change Access form. */
  readonly target: string;
  /** The consent screen only: the exact request it answers (`consentRequestKey`). */
  readonly request?: string;
  readonly files: readonly AiFileChoice[];
}

/**
 * One AI app's one consent request: its client, its PKCE challenge and its state. Saved choices
 * come back only to the same request, so another app's consent screen is never pre-ticked.
 */
export function consentRequestKey(request: {
  readonly clientId: string;
  readonly codeChallenge: string;
  readonly state: string | null;
}): string {
  return createHash('sha256')
    .update(JSON.stringify([request.clientId, request.codeChallenge, request.state ?? '']))
    .digest('base64url');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const cookie = signedRetryCookie({
  label: 'visastack.ai-file-picks.v1',
  path: '/app',
  lifetimeS: AI_FILE_PICKS_LIFETIME_S,
  maxLength: 4096,
});

function validTarget(target: string): boolean {
  return target === AI_FILE_PICKS_CONSENT || UUID_RE.test(target);
}

/** The cookie value for one set of ticked documents, or null when it cannot be signed. */
export function encodeAiFilePicks(
  retry: AiFilePicksRetry,
  accountId: string,
  now: Date = new Date(),
): string | null {
  if (!UUID_RE.test(retry.applicantId) || !validTarget(retry.target)) return null;
  const files = retry.files.slice(0, AI_FILE_CHOICES_MAX);
  if (!files.every((file) => UUID_RE.test(file.documentId))) return null;
  return cookie.encode(
    {
      p: retry.applicantId,
      t: retry.target,
      r: retry.request ?? '',
      // One letter for how: S for a Safe Copy, O for the Original.
      f: files.map((file) => `${file.variant === 'ORIGINAL' ? 'O' : 'S'}${file.documentId}`),
    },
    accountId,
    now,
  );
}

/** The ticked documents in a cookie VisaStack signed for this account, record and form, unexpired. */
export function decodeAiFilePicks(
  value: string | undefined,
  expected: {
    readonly accountId: string;
    readonly applicantId: string;
    readonly target: string;
    readonly request?: string;
  },
  now: Date = new Date(),
): readonly AiFileChoice[] | null {
  const fields = cookie.decode(value, expected.accountId, now);
  if (!fields) return null;
  const { p, t, r, f } = fields;
  if (p !== expected.applicantId || t !== expected.target) return null;
  if (r !== (expected.request ?? '')) return null;
  if (!Array.isArray(f)) return null;
  const files: AiFileChoice[] = [];
  for (const item of f.slice(0, AI_FILE_CHOICES_MAX)) {
    if (typeof item !== 'string') return null;
    const how = item.slice(0, 1);
    const documentId = item.slice(1);
    if ((how !== 'S' && how !== 'O') || !UUID_RE.test(documentId)) return null;
    files.push({ documentId, variant: how === 'O' ? 'ORIGINAL' : 'SAFE_COPY' });
  }
  return files;
}

/** Cookie settings: only the server reads it, and only the page named by `path` receives it. */
export function aiFilePicksCookieOptions(secure: boolean, path: string) {
  return cookie.options(secure, path);
}

/**
 * The cookie as this request carries it, or nothing. Outside a request (a page rendered by a test)
 * there are no cookies to read, which reads as nothing kept.
 */
export async function rememberedAiFilePicks(): Promise<string | undefined> {
  try {
    return (await cookies()).get(AI_FILE_PICKS_COOKIE)?.value;
  } catch {
    return undefined;
  }
}
