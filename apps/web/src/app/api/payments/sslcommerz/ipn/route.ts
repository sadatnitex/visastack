import { handleGatewayNotification } from '../../../../../lib/payment-callbacks';

/**
 * The payment gateway's server-to-server notification (S11, ADR 0020). Open to the internet and
 * carrying no session, so it is authenticated only by asking the gateway: the signature is a
 * first filter, and the amount, currency, store and transaction are checked against what the
 * gateway itself says in a call VisaStack makes. See `lib/payment-callbacks.ts`.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleGatewayNotification(request);
}
