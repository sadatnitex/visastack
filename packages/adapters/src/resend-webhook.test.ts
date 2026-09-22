import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyResendWebhookSignature } from './resend-webhook';

/**
 * No live Resend/Svix account exists in this sandbox (ADR-0013), so there is
 * no official "known good" signature to test against. Instead this signs
 * independently, from the documented Svix algorithm
 * (`{id}.{timestamp}.{payload}`, HMAC-SHA256 keyed by the base64-decoded
 * portion of the secret after its `whsec_` prefix, base64-encoded digest),
 * using `node:crypto` directly rather than importing anything from
 * `./resend-webhook` -- confirming the module's `verify` side matches the
 * documented protocol, not merely that it agrees with itself.
 */
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

function sign(id: string, timestamp: string, payload: string, secret = SECRET): string {
  const base64Part = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const key = Buffer.from(base64Part, 'base64');
  const signedContent = `${id}.${timestamp}.${payload}`;
  const digest = createHmac('sha256', key).update(signedContent).digest('base64');
  return `v1,${digest}`;
}

describe('verifyResendWebhookSignature', () => {
  const id = 'msg_2vJ3itR3example';
  const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 'abc123' } });
  const now = new Date('2026-09-22T10:00:00Z');
  const currentTimestamp = String(Math.floor(now.getTime() / 1000));

  it('accepts a correctly signed payload', () => {
    const signature = sign(id, currentTimestamp, payload);
    const result = verifyResendWebhookSignature(
      payload,
      { svixId: id, svixTimestamp: currentTimestamp, svixSignature: signature },
      SECRET,
      now,
    );
    expect(result).toBe(true);
  });

  it('accepts when the header carries multiple space-separated signatures and one matches', () => {
    const real = sign(id, currentTimestamp, payload);
    const decoy = 'v1,not-a-real-signature==';
    const result = verifyResendWebhookSignature(
      payload,
      { svixId: id, svixTimestamp: currentTimestamp, svixSignature: `${decoy} ${real}` },
      SECRET,
      now,
    );
    expect(result).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const signature = sign(id, currentTimestamp, payload);
    const tamperedPayload = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 'DIFFERENT' },
    });
    const result = verifyResendWebhookSignature(
      tamperedPayload,
      { svixId: id, svixTimestamp: currentTimestamp, svixSignature: signature },
      SECRET,
      now,
    );
    expect(result).toBe(false);
  });

  it('rejects a tampered id (signed content includes svix-id)', () => {
    const signature = sign(id, currentTimestamp, payload);
    const result = verifyResendWebhookSignature(
      payload,
      { svixId: 'msg_someOtherId', svixTimestamp: currentTimestamp, svixSignature: signature },
      SECRET,
      now,
    );
    expect(result).toBe(false);
  });

  it('rejects a signature signed with the wrong secret', () => {
    const signature = sign(
      id,
      currentTimestamp,
      payload,
      'whsec_totallyDifferentSecretKeyHere1234',
    );
    const result = verifyResendWebhookSignature(
      payload,
      { svixId: id, svixTimestamp: currentTimestamp, svixSignature: signature },
      SECRET,
      now,
    );
    expect(result).toBe(false);
  });

  it('rejects a stale timestamp outside the tolerance window', () => {
    const staleTimestamp = String(Math.floor(now.getTime() / 1000) - 60 * 60);
    const signature = sign(id, staleTimestamp, payload);
    const result = verifyResendWebhookSignature(
      payload,
      { svixId: id, svixTimestamp: staleTimestamp, svixSignature: signature },
      SECRET,
      now,
    );
    expect(result).toBe(false);
  });

  it('accepts a timestamp just inside the tolerance window', () => {
    const recentTimestamp = String(Math.floor(now.getTime() / 1000) - 60);
    const signature = sign(id, recentTimestamp, payload);
    const result = verifyResendWebhookSignature(
      payload,
      { svixId: id, svixTimestamp: recentTimestamp, svixSignature: signature },
      SECRET,
      now,
    );
    expect(result).toBe(true);
  });

  it('rejects a non-numeric timestamp', () => {
    const signature = sign(id, 'not-a-number', payload);
    const result = verifyResendWebhookSignature(
      payload,
      { svixId: id, svixTimestamp: 'not-a-number', svixSignature: signature },
      SECRET,
      now,
    );
    expect(result).toBe(false);
  });

  it('rejects a malformed signature header with no recognizable v1 entry', () => {
    const result = verifyResendWebhookSignature(
      payload,
      { svixId: id, svixTimestamp: currentTimestamp, svixSignature: 'garbage-no-prefix' },
      SECRET,
      now,
    );
    expect(result).toBe(false);
  });

  it('rejects an empty signature header', () => {
    const result = verifyResendWebhookSignature(
      payload,
      { svixId: id, svixTimestamp: currentTimestamp, svixSignature: '' },
      SECRET,
      now,
    );
    expect(result).toBe(false);
  });

  it('rejects a secret that decodes to an empty key', () => {
    const signature = sign(id, currentTimestamp, payload);
    const result = verifyResendWebhookSignature(
      payload,
      { svixId: id, svixTimestamp: currentTimestamp, svixSignature: signature },
      'whsec_',
      now,
    );
    expect(result).toBe(false);
  });
});
