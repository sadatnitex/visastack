import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Resend delivers webhooks through Svix (Part 5 §3: "Webhook: signature
 * verification; replay/event-ID protection; idempotent"). This module is
 * the signature-verification half; `applyEmailDeliveryEvent`
 * (`packages/services/src/notifications.ts`) is the idempotent-apply half.
 *
 * Verified against Svix's own documented manual-verification algorithm:
 * the signed content is `{svix-id}.{svix-timestamp}.{raw body}`, HMAC-SHA256
 * keyed by the base64 portion of the webhook secret (after its `whsec_`
 * prefix), base64-encoded, and compared against each `v1,<sig>` entry in
 * the space-delimited `svix-signature` header.
 */

export interface SvixWebhookHeaders {
  readonly svixId: string;
  readonly svixTimestamp: string;
  readonly svixSignature: string;
}

/** Replay protection: a signature is only accepted within this window of "now", regardless of validity. */
const MAX_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

function decodeSecret(secret: string): Buffer | null {
  const base64Part = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  try {
    const decoded = Buffer.from(base64Part, 'base64');
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a Resend/Svix webhook request. `payload` MUST be the exact raw
 * request body string (never a re-serialized parsed object -- "the
 * cryptographic signature is sensitive to even the slightest change").
 * Rejects a stale or future-dated timestamp outside the tolerance window
 * even when the signature itself is otherwise valid, which is what makes a
 * captured-and-replayed request eventually stop verifying.
 */
export function verifyResendWebhookSignature(
  payload: string,
  headers: SvixWebhookHeaders,
  secret: string,
  now: Date = new Date(),
): boolean {
  const key = decodeSecret(secret);
  if (!key) return false;

  const timestampSeconds = Number(headers.svixTimestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const ageSeconds = Math.abs(now.getTime() / 1000 - timestampSeconds);
  if (ageSeconds > MAX_TIMESTAMP_TOLERANCE_SECONDS) return false;

  const signedContent = `${headers.svixId}.${headers.svixTimestamp}.${payload}`;
  const expected = createHmac('sha256', key).update(signedContent).digest('base64');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  const candidates = headers.svixSignature.split(' ').filter((s) => s.length > 0);
  for (const candidate of candidates) {
    const separatorIndex = candidate.indexOf(',');
    if (separatorIndex === -1) continue;
    const version = candidate.slice(0, separatorIndex);
    const sig = candidate.slice(separatorIndex + 1);
    if (version !== 'v1' || sig.length === 0) continue;
    const sigBuffer = Buffer.from(sig, 'utf8');
    if (sigBuffer.length !== expectedBuffer.length) continue;
    if (timingSafeEqual(sigBuffer, expectedBuffer)) return true;
  }
  return false;
}
