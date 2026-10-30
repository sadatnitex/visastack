import 'server-only';
import type { PaymentReturnKind } from '@visastack/services';
import { PAYMENT_PROVIDERS, isPaymentProviderKey } from './payment-providers';

/**
 * The three addresses a payment gateway is given when a payment starts (S11, ADR 0020): where to
 * send the payer's browser after paying, after a failure and after cancelling, and where to post
 * the server-to-server notification. All are under this site's own origin, in the folder of the
 * provider the payment starts on (S19 step 0: `/api/payments/<provider>/ipn` and `/return`, so
 * SSLCOMMERZ keeps exactly the addresses registered with it). The transaction id in the browser
 * addresses only names the payment; the return handler asks the gateway what really happened and
 * ignores everything else on the address.
 */
export function paymentUrlFor(
  origin: string,
): (kind: PaymentReturnKind, merchantTranId: string, provider: string) => string {
  const base = origin.replace(/\/+$/, '');
  return (kind, merchantTranId, provider) => {
    // The services only start payments on configured registry providers; anything else is a bug.
    if (!isPaymentProviderKey(provider)) throw new Error('unknown payment provider');
    const path = `${base}${PAYMENT_PROVIDERS[provider].callbackPath}`;
    return kind === 'ipn'
      ? `${path}/ipn`
      : `${path}/return?o=${kind}&t=${encodeURIComponent(merchantTranId)}`;
  };
}
