import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Provider-agnostic signed blob-access token (ADR-0011). Any storage backend
 * (Neon-bytea, Vercel Private Blob, S3 later) mints one of these to authorize
 * a single short-lived read through the app's own serving route
 * (`/api/blob/[key]`) — the token, not the storage backend's own URL scheme,
 * is what the browser ever receives. The variant AND the display filename are
 * embedded in the signed payload, so neither can be tampered with after the
 * policy engine has already authorized the access (Milestone 2 P0 / §18).
 */

export interface BlobTokenFields {
  readonly objectKey: string;
  readonly disposition: string;
  readonly variant: string;
  readonly exp: number;
  readonly sig: string;
  /** Display filename for `Content-Disposition`; absent serves with no filename. */
  readonly filename?: string;
}

function signingPayload(
  objectKey: string,
  disposition: string,
  variant: string,
  exp: number,
  filename: string,
): string {
  // encodeURIComponent on the filename keeps it delimiter-safe regardless of
  // what characters (including '.') the display name itself contains.
  return `${objectKey}.${disposition}.${variant}.${exp}.${encodeURIComponent(filename)}`;
}

export function signBlobToken(
  secret: string,
  objectKey: string,
  disposition: string,
  variant: string,
  exp: number,
  filename = '',
): string {
  return createHmac('sha256', secret)
    .update(signingPayload(objectKey, disposition, variant, exp, filename))
    .digest('hex');
}

/** Verify a blob access token: correct signature and not expired. */
export function verifyBlobToken(
  secret: string,
  fields: BlobTokenFields,
  now: number = Date.now(),
): boolean {
  if (!Number.isFinite(fields.exp) || fields.exp * 1000 < now) return false;
  const expected = signBlobToken(
    secret,
    fields.objectKey,
    fields.disposition,
    fields.variant,
    fields.exp,
    fields.filename ?? '',
  );
  const a = Buffer.from(expected);
  const b = Buffer.from(fields.sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
