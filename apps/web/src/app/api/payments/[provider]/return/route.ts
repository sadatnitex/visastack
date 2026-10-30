import { handleBrowserReturn } from '../../../../../lib/payment-callbacks';

/**
 * Where the payer's browser lands after a provider's payment page (S11, ADR 0020), one address per
 * provider in the payment provider registry (S19 step 0): `/api/payments/sslcommerz/return` for
 * SSLCOMMERZ. Never records anything by itself: it has the payment settled with the gateway, then
 * sends the browser on to the signed, plain-language result page. A provider this deployment does
 * not have is not found. See `lib/payment-callbacks.ts`.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Context = { readonly params: Promise<{ readonly provider: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { provider } = await context.params;
  return handleBrowserReturn(request, provider);
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { provider } = await context.params;
  return handleBrowserReturn(request, provider);
}
