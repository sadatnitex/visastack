import {
  WHATSAPP_MAX_WEBHOOK_BYTES,
  ingestWhatsAppWebhook,
  verifyWhatsAppSignature,
  verifyWhatsAppSubscription,
} from '@visastack/services';
import { after } from 'next/server';
import { createKeyManagementPort } from '../../../../../lib/providers';
import { withPublicDb } from '../../../../../lib/public-db';
import { reportServerError } from '../../../../../lib/server-error';
import { readWhatsAppConfig } from '../../../../../lib/whatsapp';
import { runWhatsAppInbox } from '../../../jobs/process-whatsapp-inbox/run';

/**
 * Meta's WhatsApp webhook (Lane D contract section 5).
 *
 * GET is the one-time handshake when the URL is registered. POST is each delivery: the raw bytes
 * are checked against `X-Hub-Signature-256` before anything is parsed, then stored encrypted and
 * answered at once. The delivery is handled after the answer (`after()`), and the daily job picks
 * up anything left. Nothing here reads records or logs content.
 *
 * While the channel is off (or not fully configured) the handshake is refused (404) and deliveries
 * are answered 200 and dropped, so Meta does not keep retrying them for seven days. A delivery
 * that cannot be stored while the channel is on answers 503 so Meta retries it.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export function GET(request: Request): Response {
  const config = readWhatsAppConfig();
  if (!config) return new Response(null, { status: 404 });
  const challenge = verifyWhatsAppSubscription(
    new URL(request.url).searchParams,
    config.verifyToken,
  );
  if (challenge === null) return new Response(null, { status: 403 });
  return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function POST(request: Request): Promise<Response> {
  const config = readWhatsAppConfig();
  if (!config) return new Response(null, { status: 200 });

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > WHATSAPP_MAX_WEBHOOK_BYTES) return new Response(null, { status: 413 });
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > WHATSAPP_MAX_WEBHOOK_BYTES) return new Response(null, { status: 413 });

  const signature = request.headers.get('x-hub-signature-256');
  if (!verifyWhatsAppSignature(body, signature, config.appSecrets)) {
    return new Response(null, { status: 401 });
  }

  const encryption = createKeyManagementPort();
  if (!encryption) return new Response(null, { status: 503 });
  try {
    const stored = await withPublicDb((db) => ingestWhatsAppWebhook(db, encryption, body));
    if (stored === 'unavailable') return new Response(null, { status: 503 });
    if (stored === 'stored') after(() => runWhatsAppInbox({ limit: 10, timeBudgetMs: 20_000 }));
    return new Response(null, { status: 200 });
  } catch (error) {
    reportServerError('whatsappWebhook', error, { step: 'store delivery' });
    return new Response(null, { status: 503 });
  }
}
