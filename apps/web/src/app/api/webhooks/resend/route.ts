import { verifyResendWebhookSignature } from '@visastack/adapters';
import { triggerEmailDeliveryWebhook } from '../../../../lib/jobs';

/**
 * NTF-03 (Part 5 §5) delivery/bounce/complaint webhook. Resend signs every
 * webhook delivery via Svix (`svix-id`/`svix-timestamp`/`svix-signature`
 * headers); `verifyResendWebhookSignature` implements the same HMAC-SHA256
 * verification Svix's own protocol defines. Fails closed (503) if
 * `RESEND_WEBHOOK_SECRET` isn't configured -- same posture as `CRON_SECRET`
 * on the periodic job routes -- and never applies an event whose signature
 * doesn't verify (401).
 *
 * Only three of Resend's event types change anything here --
 * `email.delivered`, `email.bounced`, `email.complained` -- matching
 * `applyEmailDeliveryEvent`'s three outcomes. Every other type
 * (`email.sent`, `email.opened`, `email.clicked`, `email.delivery_delayed`,
 * `email.failed`) is acknowledged (200) without further action: `SENT` is
 * already set by the worker itself at send time, not by this webhook, and
 * open/click tracking is outside this chunk's scope entirely.
 *
 * Always returns 200 once the signature verifies, even when no matching
 * `providerMessageId` row exists (`applied: false`) -- a webhook receiver
 * that 4xx/5xxs on an event it simply doesn't act on invites the sender's
 * own retry storm. `applyEmailDeliveryEvent`'s WHERE-clause idempotency
 * already makes a replayed or out-of-order event a harmless no-op (see its
 * own doc comment in packages/services/src/notifications.ts).
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function readEnv(name: string): string | undefined {
  return process.env[name];
}

interface ResendWebhookPayload {
  readonly type?: string;
  readonly data?: {
    readonly email_id?: string;
  };
}

const OUTCOME_BY_EVENT_TYPE: Readonly<Record<string, 'delivered' | 'bounced' | 'complained'>> = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
};

export async function POST(request: Request): Promise<Response> {
  const secret = readEnv('RESEND_WEBHOOK_SECRET');
  if (!secret) {
    return new Response('RESEND_WEBHOOK_SECRET not configured', { status: 503 });
  }

  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response('missing svix headers', { status: 400 });
  }

  const rawBody = await request.text();
  const verified = verifyResendWebhookSignature(
    rawBody,
    { svixId, svixTimestamp, svixSignature },
    secret,
  );
  if (!verified) {
    return new Response('invalid signature', { status: 401 });
  }

  let payload: ResendWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ResendWebhookPayload;
  } catch {
    return new Response('invalid JSON', { status: 400 });
  }

  const outcome = payload.type ? OUTCOME_BY_EVENT_TYPE[payload.type] : undefined;
  const providerMessageId = payload.data?.email_id;
  if (!outcome || !providerMessageId) {
    return Response.json({ acknowledged: true, applied: false });
  }

  const result = await triggerEmailDeliveryWebhook({ providerMessageId, outcome });
  return Response.json({ acknowledged: true, applied: result.applied });
}
