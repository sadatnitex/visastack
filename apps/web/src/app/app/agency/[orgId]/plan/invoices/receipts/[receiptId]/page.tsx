import { formatBillingDate, formatBillingDateTime, formatMoney } from '@visastack/core';
import { getReceipt } from '@visastack/services';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../../../../../../components/ui';
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
        eyebrow="Usage &amp; Billing"
        title={`Receipt ${receipt.number}`}
        description="VisaStack recorded this payment against your invoice."
        back={{ href: `/app/agency/${orgId}/plan/invoices`, label: 'Invoices' }}
        actions={
          <a
            className="btn btn-secondary"
            href={`/app/agency/${orgId}/plan/invoices/receipts/${receiptId}/pdf`}
            download
          >
            Download Receipt (PDF)
          </a>
        }
        as="h2"
      />
      <article className="card receipt-card">
        <dl className="invoice-facts receipt-facts">
          <div>
            <dt>Receipt Number</dt>
            <dd>{receipt.number}</dd>
          </div>
          <div>
            <dt>Agency</dt>
            <dd>{receipt.organizationName}</dd>
          </div>
          <div>
            <dt>Invoice</dt>
            <dd>{receipt.invoiceRef}</dd>
          </div>
          <div>
            <dt>Amount Received</dt>
            <dd>{formatMoney(receipt.amountMinorUnits, receipt.currency)}</dd>
          </div>
          <div>
            <dt>How It Was Paid</dt>
            <dd>{receiptKindLabel(receipt.kind)}</dd>
          </div>
          <div>
            <dt>Payment Date</dt>
            <dd>{formatBillingDate(receipt.collectedDate)}</dd>
          </div>
          <div>
            <dt>Payment Reference</dt>
            <dd>{receipt.reference}</dd>
          </div>
          <div>
            <dt>Receipt Issued</dt>
            <dd>{formatBillingDateTime(receipt.issuedAt)}</dd>
          </div>
        </dl>
        <p className="invoice-note">
          This receipt shows that a payment was recorded against the invoice named above. It is not
          a tax document.
        </p>
      </article>
    </>
  );
}
