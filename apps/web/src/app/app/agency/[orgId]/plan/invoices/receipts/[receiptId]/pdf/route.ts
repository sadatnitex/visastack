import { getReceiptDocument } from '@visastack/services';
import {
  billingDocumentNotFound,
  billingDocumentResponse,
  isDocumentId,
} from '../../../../../../../../../lib/billing-documents';
import { withSession } from '../../../../../../../../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Download Receipt (PDF) for an agency (S30). Same readers as the receipt page: the agency's
 * active owners and admins. Everyone else, and any receipt outside this agency, gets a 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; receiptId: string }> },
): Promise<Response> {
  const { orgId, receiptId } = await params;
  if (!isDocumentId(orgId) || !isDocumentId(receiptId)) return billingDocumentNotFound();
  const now = new Date();
  const doc = await withSession(async ({ db, accountId }) =>
    getReceiptDocument(db, { actorAccountId: accountId, organizationId: orgId, receiptId, now }),
  );
  return doc.ok ? billingDocumentResponse(doc.value, now) : billingDocumentNotFound();
}
