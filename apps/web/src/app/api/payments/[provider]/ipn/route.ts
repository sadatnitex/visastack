import { handleGatewayNotification } from '../../../../../lib/payment-callbacks';

/**
 * A payment gateway's server-to-server notification (S11, ADR 0020), one address per provider in
 * the payment provider registry (S19 step 0): `/api/payments/sslcommerz/ipn` for SSLCOMMERZ, the
 * address registered with it. Open to the internet and carrying no session, so it is
 * authenticated only by asking the gateway: the signature is a first filter, and the amount,
 * currency, store and transaction are checked against what the gateway itself says in a call
 * VisaStack makes. A provider this deployment does not have is not found. See
 * `lib/payment-callbacks.ts`.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly provider: string }> },
): Promise<Response> {
  const { provider } = await context.params;
  return handleGatewayNotification(request, provider);
}
