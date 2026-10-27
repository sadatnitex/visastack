import { handleBrowserReturn } from '../../../../../lib/payment-callbacks';

/**
 * Where the payer's browser lands after the payment page (S11, ADR 0020). Never records anything
 * by itself: it has the payment settled with the gateway, then sends the browser on to the signed,
 * plain-language result page. See `lib/payment-callbacks.ts`.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleBrowserReturn(request);
}

export async function GET(request: Request): Promise<Response> {
  return handleBrowserReturn(request);
}
