import 'server-only';
import {
  type Db,
  type PaymentPort,
  RATE_LIMITS,
  type SettlementOutcome,
  checkRateLimit,
  isMerchantTranId,
  recordRejectedPaymentCallback,
  settlePaymentAttempt,
} from '@visastack/services';
import { resolveBaseUrl } from './base-url';
import { clientAddressFrom, hashedSubject } from './client-address';
import {
  PAYMENT_PROVIDERS,
  type PaymentCallback,
  type PaymentProviderKey,
  isPaymentProviderKey,
} from './payment-providers';
import { signedPaymentResultPath } from './payment-result';
import { withoutPaymentSecrets } from './payment-secrets';
import { paymentPortFor } from './providers';
import { withPublicDb } from './public-db';
import { reportServerError } from './server-error';

/**
 * The two public addresses the payment gateway talks to (S11, ADR 0020): the server-to-server
 * notification (IPN) and the browser return.
 *
 * Neither carries a session, so neither is trusted. Each one only extracts which payment is being
 * talked about, bounds how often the address may be used, and hands the payment to
 * `settlePaymentAttempt`, which asks the gateway. What the gateway-facing address answers is
 * deliberately thin (no outcome, no reason): an anonymous caller learns nothing about any payment.
 *
 * S19 step 0: each provider has its own pair, `/api/payments/<provider>/ipn` and `/return`. The
 * provider in the address only chooses which gateway to ask and how to read its callback; a
 * payment started with another provider is unknown here (`settlePaymentAttempt` matches the
 * payment's own provider). An address for a provider this deployment does not have is not found.
 */

export interface PaymentCallbackDeps {
  /** The provider's port when it is configured here; null (or the Null port) when it is not. */
  readonly port: (provider: PaymentProviderKey) => PaymentPort | null;
  readonly withDb: <T>(work: (db: Db) => Promise<T>) => Promise<T>;
  readonly baseUrl: () => string;
}

const DEFAULT_DEPS: PaymentCallbackDeps = {
  port: paymentPortFor,
  withDb: withPublicDb,
  baseUrl: resolveBaseUrl,
};

/** A gateway notification is a few dozen short fields; anything bigger is not one. */
const MAX_BODY_CHARS = 32_768;

/** A callback's body and its type, or null when it is missing, unreadable or oversize. */
export async function readCallbackBody(
  request: Request,
): Promise<{ readonly contentType: string | null; readonly raw: string } | null> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_BODY_CHARS) return null;
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return null;
  }
  if (raw.length > MAX_BODY_CHARS) return null;
  return { contentType: request.headers.get('content-type'), raw };
}

/** What a callback to this provider's address names, or null when it is not one of its callbacks. */
async function readCallback(
  request: Request,
  provider: PaymentProviderKey,
): Promise<PaymentCallback | null> {
  const body = await readCallbackBody(request);
  return body === null ? null : PAYMENT_PROVIDERS[provider].readCallback(body);
}

const notFound = () => new Response('Not found', { status: 404 });

async function withinAddressLimit(db: Db, request: Request): Promise<boolean> {
  const decision = await checkRateLimit(
    db,
    {
      subjectId: hashedSubject('net', clientAddressFrom(request.headers)),
      action: 'payments.callback_ip',
      label: 'payment',
    },
    RATE_LIMITS.PAYMENT_CALLBACK_IP,
  );
  return decision.allowed;
}

function failureToRetry(outcome: SettlementOutcome): boolean {
  return (
    outcome.code === 'unavailable' ||
    outcome.code === 'not_configured' ||
    outcome.code === 'rate_limited'
  );
}

/**
 * The gateway's server-to-server notification. A bad signature is audited (within a small hourly
 * allowance) and answered 200 with nothing applied; a good signature only names the payment to
 * ask the gateway about. When the gateway cannot be asked, the answer is 503 so it sends the
 * notification again, and the daily reconciliation covers the rest.
 */
export async function handleGatewayNotification(
  request: Request,
  provider: string,
  deps: PaymentCallbackDeps = DEFAULT_DEPS,
): Promise<Response> {
  if (!isPaymentProviderKey(provider)) return notFound();
  try {
    const port = deps.port(provider);
    if (!port?.configured) return new Response('Payments are not available', { status: 503 });
    const callback = await readCallback(request, provider);
    if (!callback) return new Response('Bad request', { status: 400 });

    return await deps.withDb(async (db) => {
      if (!(await withinAddressLimit(db, request))) {
        return new Response('Too many requests', { status: 429 });
      }
      if (!port.verifyIpnSignature(callback.fields)) {
        await recordRejectedPaymentCallback(db, { reason: 'bad_signature', source: 'ipn' });
        return Response.json({ received: true });
      }
      const merchantTranId = callback.merchantTranId ?? '';
      if (!isMerchantTranId(merchantTranId)) {
        await recordRejectedPaymentCallback(db, { reason: 'unknown_transaction', source: 'ipn' });
        return Response.json({ received: true });
      }
      const outcome = await settlePaymentAttempt(db, port, {
        merchantTranId,
        valId: callback.valId,
        source: 'ipn',
      });
      if (outcome.code === 'unknown_transaction') {
        await recordRejectedPaymentCallback(db, { reason: 'unknown_transaction', source: 'ipn' });
      }
      if (failureToRetry(outcome)) {
        // Fixed words only: which step stopped, never a reply, an address or a credential.
        reportServerError('paymentNotification', new Error('payment could not be settled'), {
          step: outcome.code,
        });
        return new Response('Please try again later', {
          status: outcome.code === 'rate_limited' ? 429 : 503,
        });
      }
      return Response.json({ received: true });
    });
  } catch (error) {
    reportServerError('paymentNotification', withoutPaymentSecrets(error), {
      step: 'handling failed',
    });
    return new Response('Please try again later', { status: 503 });
  }
}

function redirectResponse(location: URL): Response {
  return new Response(null, {
    status: 303,
    headers: { location: location.toString(), 'cache-control': 'no-store' },
  });
}

/** The result page without a payment: what anyone sees when there is nothing specific to show. */
function redirectToGenericResult(deps: PaymentCallbackDeps): Response {
  return redirectResponse(new URL('/payments/result', deps.baseUrl()));
}

/**
 * The browser coming back from the payment page (success, failure or cancel; the gateway posts
 * the payer's browser here). It records nothing by itself: it names the payment, has it settled
 * with the gateway exactly as the notification does, and sends the browser on to the signed,
 * plain-language result page. What the browser claims (status, amount, which button it pressed)
 * is ignored.
 */
export async function handleBrowserReturn(
  request: Request,
  provider: string,
  deps: PaymentCallbackDeps = DEFAULT_DEPS,
): Promise<Response> {
  if (!isPaymentProviderKey(provider)) return notFound();
  try {
    const port = deps.port(provider);
    if (!port?.configured) return redirectToGenericResult(deps);
    const url = new URL(request.url);
    const callback = request.method === 'POST' ? await readCallback(request, provider) : null;
    const merchantTranId = callback?.merchantTranId ?? url.searchParams.get('t') ?? '';
    if (!isMerchantTranId(merchantTranId)) return redirectToGenericResult(deps);

    return await deps.withDb(async (db) => {
      // Too many returns from one address: the payer sees the neutral page, never a bare error.
      if (!(await withinAddressLimit(db, request))) return redirectToGenericResult(deps);
      const outcome = await settlePaymentAttempt(db, port, {
        merchantTranId,
        valId: callback?.valId ?? null,
        source: 'return',
      });
      if (failureToRetry(outcome)) {
        reportServerError('paymentReturn', new Error('payment could not be settled'), {
          step: outcome.code,
        });
      }
      // Only a payment that exists gets a signed page; a made-up id gets the generic one.
      if (outcome.code === 'unknown_transaction') return redirectToGenericResult(deps);
      const path = signedPaymentResultPath(merchantTranId);
      return path === null
        ? redirectToGenericResult(deps)
        : redirectResponse(new URL(path, deps.baseUrl()));
    });
  } catch (error) {
    reportServerError('paymentReturn', withoutPaymentSecrets(error), { step: 'handling failed' });
    return redirectToGenericResult(deps);
  }
}
