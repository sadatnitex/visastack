import { formatBillingDate, formatBillingDateTime, formatMoney } from '@visastack/core';
import { getReceipt } from '@visastack/services';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../../../../../../components/ui';
import { appAgencyCatalog } from '../../../../../../../../i18n/app-agency';
import { getServerT, primeLocale } from '../../../../../../../../lib/i18n-server';
import { receiptKindLabel } from '../../../../../../../../lib/invoice-labels';
import { withSession } from '../../../../../../../../lib/session';

export const metadata: Metadata = { title: 'Payment Receipt' };

export const dynamic = 'force-dynamic';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One numbered receipt (S12, ADR 0020). Readable by the agency's owners and admins only; another
 * agency's receipt, an unknown number and a receipt a member may not see all show "not found".
 * It states what was recorded and nothing more: no tax lines, no document content.
 */
export default async function ReceiptPage({
  params,
}: {
  readonly params: Promise<{ orgId: string; receiptId: string }>;
}) {
  await primeLocale();
  const t = getServerT(appAgencyCatalog);
  const { orgId, receiptId } = await params;
  if (!ID.test(orgId) || !ID.test(receiptId)) notFound();

  const receipt = await withSession(async ({ db, accountId }) => {
    const found = await getReceipt(db, {
      actorAccountId: accountId,
      organizationId: orgId,
      receiptId,
    });
    return found.ok ? found.value : null;
  });
  if (!receipt) notFound();

  return (
    <>
      <PageHeader
        eyebrow={t('appAgency.appAgencyOrgidPlanInvoicesPage.usageBilling')}
        title={t('appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.receiptNumber', {
          number: receipt.number,
        })}
        description={t(
          'appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.visastackRecordedThisPaymentAgainstYour',
        )}
        back={{ href: `/app/agency/${orgId}/plan/invoices`, label: 'Invoices' }}
        actions={
          <a
            className="btn btn-secondary"
            href={`/app/agency/${orgId}/plan/invoices/receipts/${receiptId}/pdf`}
          >
            {t.node('appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.downloadReceiptPdf')}
          </a>
        }
        as="h2"
      />
      <article className="card receipt-card">
        <dl className="invoice-facts receipt-facts">
          <div>
            <dt>
              {t.node('appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.receiptNumber')}
            </dt>
            <dd>{receipt.number}</dd>
          </div>
          <div>
            <dt>{t.node('appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.agency')}</dt>
            <dd>{receipt.organizationName}</dd>
          </div>
          <div>
            <dt>{t.node('appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.invoice')}</dt>
            <dd>{receipt.invoiceRef}</dd>
          </div>
          <div>
            <dt>
              {t.node('appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.amountReceived')}
            </dt>
            <dd>{formatMoney(receipt.amountMinorUnits, receipt.currency)}</dd>
          </div>
          <div>
            <dt>
              {t.node('appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.howItWasPaid')}
            </dt>
            <dd>{receiptKindLabel(receipt.kind)}</dd>
          </div>
          <div>
            <dt>
              {t.node('appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.paymentDate')}
            </dt>
            <dd>{formatBillingDate(receipt.collectedDate)}</dd>
          </div>
          <div>
            <dt>{t.node('appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.paymentReference')}</dt>
            <dd>{receipt.reference}</dd>
          </div>
          <div>
            <dt>
              {t.node('appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.receiptIssued')}
            </dt>
            <dd>{formatBillingDateTime(receipt.issuedAt)}</dd>
          </div>
        </dl>
        <p className="invoice-note">
          {t.node(
            'appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.thisReceiptShowsThatAPayment',
          )}
        </p>
      </article>
    </>
  );
}
