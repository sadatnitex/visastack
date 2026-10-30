import {
  type AgencyInvoiceView,
  type Db,
  listAgencyInvoices,
  refreshInvoicePaymentAttempts,
} from '@visastack/services';
import type { Metadata } from 'next';
import { PageHeader } from '../../../../../../components/ui';
import { createPaymentPort, isPaymentProviderConfigured } from '../../../../../../lib/providers';
import { reportServerError } from '../../../../../../lib/server-error';
import { withSession } from '../../../../../../lib/session';
import { BillingStatusNotice, loadNoticeBillingStatus } from '../../billing-status-notice';
import { InvoiceCard } from './invoice-card';

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
  accountId: string,
  organizationId: string,
  invoices: readonly AgencyInvoiceView[],
): Promise<boolean> {
  if (!isPaymentProviderConfigured()) return false;
  const open = invoices.filter(needsGatewayCheck).slice(0, REFRESH_LIMIT);
  if (open.length === 0) return false;
  try {
    const port = createPaymentPort();
    await Promise.all(
      open.map((invoice) =>
        refreshInvoicePaymentAttempts(db, port, {
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
 * The agency's Invoices page (S12, ADR 0020), in the Usage and Billing area. Owners and admins see
 * every invoice with its plain state, can pay online (BDT, when payments are switched on) or
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

  const data = await withSession(async ({ db, accountId }) => {
    let listed = await listAgencyInvoices(db, { actorAccountId: accountId, organizationId: orgId });
    if (listed.ok && (await checkOpenPayments(db, accountId, orgId, listed.value))) {
      listed = await listAgencyInvoices(db, { actorAccountId: accountId, organizationId: orgId });
    }
    if (!listed.ok) return { invoices: [], allowed: false, status: null };
    const status = await loadNoticeBillingStatus(db, accountId, orgId);
    return { invoices: listed.value, allowed: true, status };
  });
  const now = new Date();
  const onlineAvailable = isPaymentProviderConfigured();
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
      <BillingStatusNotice status={data.status} admin organizationId={orgId} showAction={false} />
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
              onlineAvailable={onlineAvailable}
              latestDate={latestDate}
              now={now}
            />
          ))}
        </div>
      )}
    </>
  );
}
