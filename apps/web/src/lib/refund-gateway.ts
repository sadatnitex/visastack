import 'server-only';
import { type PaymentPortResolver, isRefundingPaymentPort } from '@visastack/services';
import { paymentPorts } from './providers';

/**
 * Which payment gateways, if any, refunds may be sent to and checked with (Small Commercial V1
 * S18). Everything is built; sending refunds from VisaStack is switched on by one value:
 * `PAYMENT_REFUNDS_VIA_GATEWAY=true` (exactly "true"), set once the server's fixed outbound address
 * is registered with SSLCOMMERZ (owner action O18). While it is off, refunds are made in the
 * gateway's merchant panel and recorded in VisaStack.
 *
 * S19 step 0: the answer covers every configured provider that can refund, as the resolver the
 * services take. A refund goes to the provider the payment was taken with, never another one.
 *
 * Building the ports never throws: a provider whose settings are incomplete is not configured (and
 * the readiness check, the daily check and its callback addresses report it, S19 step 0 round 2).
 */

export const REFUNDS_SWITCH = 'PAYMENT_REFUNDS_VIA_GATEWAY';

export type ReadEnv = (name: string) => string | undefined;

const fromProcess: ReadEnv = (name) => process.env[name];

/** True only for exactly "true". */
export function refundsViaGatewayEnabled(readEnv: ReadEnv = fromProcess): boolean {
  return readEnv(REFUNDS_SWITCH) === 'true';
}

/**
 * Every configured gateway, whatever the switch says (for checking sent refunds), or null when
 * none of them can refund. The services use only the ones that can refund, and tell a payment
 * whose provider is switched off from one whose provider is on but cannot refund (S19 step 0
 * round 3), so the resolver carries every configured provider.
 */
export function refundCheckPort(): PaymentPortResolver | null {
  const gateways = paymentPorts();
  return gateways.configured().some(isRefundingPaymentPort) ? gateways : null;
}

/**
 * Every configured gateway, possibly none (for "Check Now", which still counts sent refunds no
 * gateway here can be asked about, S19 step 0 round 2).
 */
export function refundCheckPorts(): PaymentPortResolver {
  return paymentPorts();
}

/**
 * The gateways refunds may be sent to: only with the switch on and at least one configured
 * gateway that can refund. Pass the check answer already made for this request, so the ports are
 * built once.
 */
export function refundSendPort(
  readEnv: ReadEnv = fromProcess,
  checkPort: PaymentPortResolver | null | undefined = undefined,
): PaymentPortResolver | null {
  if (!refundsViaGatewayEnabled(readEnv)) return null;
  return checkPort === undefined ? refundCheckPort() : checkPort;
}

/** Both answers for one page render, from one set of ports. */
export function refundPorts(readEnv: ReadEnv = fromProcess): {
  readonly check: PaymentPortResolver | null;
  readonly send: PaymentPortResolver | null;
} {
  const check = refundCheckPort();
  return { check, send: refundSendPort(readEnv, check) };
}

/** The one plain sentence shown when refunds cannot be sent from VisaStack. */
export const REFUNDS_IN_PANEL =
  "Refunds are made in the payment gateway's merchant panel and recorded here with Record a Refund Made Outside VisaStack.";
