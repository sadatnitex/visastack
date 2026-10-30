import { type RefundingPaymentPort, isRefundingPaymentPort } from '@visastack/services';
import { withoutPaymentSecrets } from './payment-secrets';
import { createPaymentPort, isPaymentProviderConfigured } from './providers';
import { reportServerError } from './server-error';

/**
 * Which payment gateway, if any, refunds may be sent to and checked with (Small Commercial V1
 * S18). Everything is built; sending refunds from VisaStack is switched on by one value:
 * `PAYMENT_REFUNDS_VIA_GATEWAY=true` (exactly "true"), set once the server's fixed outbound address
 * is registered with SSLCOMMERZ (owner action O18). While it is off, refunds are made in the
 * gateway's merchant panel and recorded in VisaStack.
 *
 * The port is never made unguarded: an incomplete payment configuration (which makes
 * `createPaymentPort` throw on purpose) gives "no gateway" here, never a broken page.
 */

export const REFUNDS_SWITCH = 'PAYMENT_REFUNDS_VIA_GATEWAY';

export type ReadEnv = (name: string) => string | undefined;

const fromProcess: ReadEnv = (name) => process.env[name];

/** True only for exactly "true". */
export function refundsViaGatewayEnabled(readEnv: ReadEnv = fromProcess): boolean {
  return readEnv(REFUNDS_SWITCH) === 'true';
}

/** The configured gateway, when it can refund, whatever the switch says (for checking sent refunds). */
export function refundCheckPort(): RefundingPaymentPort | null {
  if (!isPaymentProviderConfigured()) return null;
  try {
    const port = createPaymentPort();
    return port.configured && isRefundingPaymentPort(port) ? port : null;
  } catch (error) {
    reportServerError('refund gateway', withoutPaymentSecrets(error), { step: 'payment port' });
    return null;
  }
}

/**
 * The gateway refunds may be sent to: only with the switch on and a complete configuration. Pass
 * the check port already made for this request, so the payment port is built once.
 */
export function refundSendPort(
  readEnv: ReadEnv = fromProcess,
  checkPort: RefundingPaymentPort | null | undefined = undefined,
): RefundingPaymentPort | null {
  if (!refundsViaGatewayEnabled(readEnv)) return null;
  return checkPort === undefined ? refundCheckPort() : checkPort;
}

/** Both answers for one page render, from one payment port. */
export function refundPorts(readEnv: ReadEnv = fromProcess): {
  readonly check: RefundingPaymentPort | null;
  readonly send: RefundingPaymentPort | null;
} {
  const check = refundCheckPort();
  return { check, send: refundSendPort(readEnv, check) };
}

/** The one plain sentence shown when refunds cannot be sent from VisaStack. */
export const REFUNDS_IN_PANEL =
  "Refunds are made in the payment gateway's merchant panel and recorded here with Record a Refund Made Outside VisaStack.";
