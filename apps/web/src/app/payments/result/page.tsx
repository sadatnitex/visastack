import {
  type PaymentResultState,
  type PaymentResultView,
  formatMinorUnits,
  getPaymentResultView,
} from '@visastack/services';
import type { Metadata } from 'next';
import { verifyPaymentResultParams } from '../../../lib/payment-result';
import { withPublicDb } from '../../../lib/public-db';
import { reportServerError } from '../../../lib/server-error';

export const metadata: Metadata = { title: 'Payment Result', robots: { index: false } };
export const dynamic = 'force-dynamic';

interface ResultCopy {
  readonly heading: string;
  readonly body: string;
}

const COPY: Readonly<Record<PaymentResultState, ResultCopy>> = {
  received: {
    heading: 'Payment Received',
    body: 'We have received your payment. Thank you.',
  },
  confirming: {
    heading: 'We Are Confirming Your Payment',
    body: 'Your payment is still being confirmed. This usually takes a minute. Refresh this page shortly. If you were charged, you do not need to pay again.',
  },
  not_completed: {
    heading: 'Payment Not Completed',
    body: 'Nothing was charged. You can go back to your invoice and try again.',
  },
  needs_check: {
    heading: 'Payment Needs a Check',
    body: 'We received your payment but need to check it before we can count it. We will contact you. You do not need to pay again.',
  },
};

const GENERIC: ResultCopy = {
  heading: 'This Payment Link Is No Longer Available',
  body: 'The link may have expired. Open your invoices to see the latest state of your payment.',
};

async function loadView(merchantTranId: string): Promise<PaymentResultView | null> {
  try {
    return await withPublicDb((db) => getPaymentResultView(db, merchantTranId));
  } catch (error) {
    reportServerError('paymentResultPage', error, { step: 'lookup failed' });
    return null;
  }
}

/**
 * The plain-language result shown after the payment page (S11, ADR 0020). It is reached only by a
 * signed address VisaStack itself redirected to, and it shows the payment's own recorded state,
 * never anything the address or the browser claims. An unsigned, expired or unknown address gets
 * the same neutral message.
 */
export default async function PaymentResultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const one = (
    values: Record<string, string | string[] | undefined>,
    name: string,
  ): string | undefined => {
    const value = values[name];
    return typeof value === 'string' ? value : undefined;
  };
  const params = { t: one(raw, 't'), x: one(raw, 'x'), s: one(raw, 's') };
  const signed = verifyPaymentResultParams(params);
  const view = signed && params.t ? await loadView(params.t) : null;
  const copy = view ? COPY[view.state] : GENERIC;

  return (
    <section className="section container" style={{ maxWidth: '40rem' }}>
      <h1 className="page-title">{copy.heading}</h1>
      <p className="card-body">{copy.body}</p>
      {view ? (
        <p className="card-body">
          Invoice {view.invoiceRef}: {view.currency} {formatMinorUnits(view.amountMinorUnits)}
        </p>
      ) : null}
      <div className="cta-row">
        <a className="btn btn-primary" href="/app">
          Go to Workspace
        </a>
      </div>
    </section>
  );
}
