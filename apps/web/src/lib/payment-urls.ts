import type { PaymentReturnKind } from '@visastack/services';

/**
 * The three addresses the payment gateway is given when a payment starts (S11, ADR 0020): where to
 * send the payer's browser after paying, after a failure and after cancelling, and where to post
 * the server-to-server notification. All are under this site's own origin. The transaction id in
 * the browser addresses only names the payment; the return handler asks the gateway what really
 * happened and ignores everything else on the address.
 */
export function paymentUrlFor(
  origin: string,
): (kind: PaymentReturnKind, merchantTranId: string) => string {
  const base = origin.replace(/\/+$/, '');
  return (kind, merchantTranId) =>
    kind === 'ipn'
      ? `${base}/api/payments/sslcommerz/ipn`
      : `${base}/api/payments/sslcommerz/return?o=${kind}&t=${encodeURIComponent(merchantTranId)}`;
}
