import {
  type AgencyInvoiceView,
  type Db,
  type PaymentPortResolver,
  TEST_PAYMENTS_ONLY,
  listAgencyInvoices,
  refreshInvoicePaymentAttempts,
} from '@visastack/services';
import type { Metadata } from 'next';
import { PageHeader } from '../../../../../../components/ui';
import { isPlatformOwnerAccount } from '../../../../../../lib/admin';
import { type OnlineOffers, onlineOffers } from '../../../../../../lib/payment-providers';
import { paymentPorts } from '../../../../../../lib/providers';
import { reportServerError } from '../../../../../../lib/server-error';
import { withSession } from '../../../../../../lib/session';
import { BillingStatusNotice, loadBillingNotice } from '../../billing-status-notice';
import { InvoiceCard, type OnlineOffer } from './invoice-card';

export const metadata: Metadata = { title: 'Agency Invoices' };

export const dynamic = 'force-dynamic';

/** At most this many invoices are checked with the payment gateway when the page opens. */
const REFRESH_LIMIT = 3;

function needsGatewayCheck(invoice: AgencyInvoiceView): boolean {
  return (
    invoice.state !== 'PAID' &&
    invoice.state !== 'VOID' &&
    invoice.attempts.some((a) => a.status === 'REDIRECTED' || a.status === 'EXPIRED')
  );
}

/**
 * Asks the payment gateway about payments that were started and never settled, for the few
 * invoices that have one, so a payer who closed the payment page sees the right state. A gateway
 * that cannot be reached changes nothing; the daily check covers the rest.
 */
async function checkOpenPayments(
  db: Db,
  payments: PaymentPortResolver,
  accountId: string,
  organizationId: string,
  invoices: readonly AgencyInvoiceView[],
): Promise<boolean> {
  const open = invoices.filter(needsGatewayCheck).slice(0, REFRESH_LIMIT);
  if (open.length === 0) return false;
  try {
    // S19 step 0: each payment is asked of the provider it was made with.
    if (payments.configured().length === 0) return false;
    await Promise.all(
      open.map((invoice) =>
        refreshInvoicePaymentAttempts(db, payments, {
          actorAccountId: accountId,
          organizationId,
          invoiceId: invoice.id,
        }),
      ),
    );
    return true;
  } catch (error) {
    reportServerError('agencyInvoices', error, { step: 'checking open payments' });
    return false;
  }
}

/**
 * What this viewer is offered online, per invoice currency (S19 step 0, from the provider
 * registry): `pay` where a live provider takes it, or a test-mode one and the viewer is the
 * platform owner (S29); `testing` where only a test-mode provider takes it and the viewer is
 * anyone else.
 */
function viewerOffers(offers: OnlineOffers, owner: boolean): Readonly<Record<string, OnlineOffer>> {
  const result: Record<string, OnlineOffer> = Object.create(null) as Record<string, OnlineOffer>;
  for (const [currency, offer] of Object.entries(offers)) {
    result[currency] = offer.mode === 'LIVE' || owner ? 'pay' : 'testing';
  }
  return result;
}

/**
 * The agency's Invoices page (S12, ADR 0020), in the Usage and Billing area. Owners and admins see
 * every invoice with its plain state, can pay online (in a currency a configured payment provider
 * takes; with SSLCOMMERZ, taka) or
 * report a payment made another way, and keep their receipts. Everyone else in the agency is
 * told it is for owners and admins. Nothing here counts money: online payments are counted only
 * when the gateway confirms them, and reports only when VisaStack confirms them.
 */
export default async function AgencyInvoicesPage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const offers = onlineOffers(process.env);
  // One resolver for the whole page (S19 step 0 round 4): the open-payment check and the stranded
  // answer on each card both come from it, as they do in the services.
  const payments = paymentPorts();

  const data = await withSession(async ({ db, accountId, email }) => {
    const list = () =>
      listAgencyInvoices(db, {
        actorAccountId: accountId,
        organizationId: orgId,
        payments,
      });
    let listed = await list();
    if (listed.ok && (await checkOpenPayments(db, payments, accountId, orgId, listed.value))) {
      listed = await list();
    }
    if (!listed.ok) return { invoices: [], allowed: false, status: null, owner: false };
    const status = await loadBillingNotice(db, accountId, orgId);
    // S29 round 2: in a gateway's test mode only the platform owner can pay online.
    const owner = Object.values(offers).some((offer) => offer.mode === 'TEST')
      ? await isPlatformOwnerAccount(db, { accountId, email })
      : false;
    return { invoices: listed.value, allowed: true, status, owner };
  });
  const now = new Date();
  const online = viewerOffers(offers, data.owner);
  // The newest calendar day anywhere on earth (UTC+14), so nobody is stopped from choosing their own today.
  const latestDate = new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        eyebrow="Usage &amp; Billing"
        title="Invoices"
        description="Pay an invoice online or tell us about a payment you made another way. Your receipts are kept here."
        back={{ href: `/app/agency/${orgId}/plan`, label: 'Plan & Usage' }}
        as="h2"
      />
      <BillingStatusNotice notice={data.status} admin organizationId={orgId} showAction={false} />
      {!data.allowed ? (
        <article className="card">
          <p className="card-body">Only owners and admins can see and pay invoices.</p>
        </article>
      ) : data.invoices.length === 0 ? (
        <article className="card">
          <p className="card-body">
            No invoices yet. When VisaStack issues an invoice for your plan it appears here.
          </p>
        </article>
      ) : (
        <div className="invoice-stack">
          {data.invoices.map((invoice) => (
            <InvoiceCard
              key={invoice.id}
              invoice={invoice}
              organizationId={orgId}
              online={online}
              testModeHint={TEST_PAYMENTS_ONLY}
              latestDate={latestDate}
              now={now}
            />
          ))}
        </div>
      )}
    </>
  );
}
