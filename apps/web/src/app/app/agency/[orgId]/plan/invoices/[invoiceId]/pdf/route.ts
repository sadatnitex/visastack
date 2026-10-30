import { getInvoiceDocument } from '@visastack/services';
import {
  billingDocumentNotFound,
  billingDocumentResponse,
  isDocumentId,
} from '../../../../../../../../lib/billing-documents';
import { withSession } from '../../../../../../../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Download Invoice (PDF) for an agency (S30). Signed-in only (withSession sends anyone else to
 * sign in) and readable by the same people as the Invoices page: the agency's active owners and
 * admins. A member, another agency, a stranger and an unknown invoice all get the same 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; invoiceId: string }> },
): Promise<Response> {
  const { orgId, invoiceId } = await params;
  if (!isDocumentId(orgId) || !isDocumentId(invoiceId)) return billingDocumentNotFound();
  const now = new Date();
  const doc = await withSession(async ({ db, accountId }) =>
    getInvoiceDocument(db, { actorAccountId: accountId, organizationId: orgId, invoiceId, now }),
  );
  return doc.ok ? billingDocumentResponse(doc.value, now) : billingDocumentNotFound();
}
