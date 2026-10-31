import { ownReceiptDocument } from '@visastack/services';
import {
  billingDocumentNotFound,
  billingDocumentResponse,
  isDocumentId,
} from '../../../../../../../../lib/billing-documents';
import { withSession } from '../../../../../../../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Download Receipt (PDF) for a traveller's own payment (ADR 0025, T5). Only the person who paid
 * can read it: another person's receipt, an agency's receipt and an unknown id all get a 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ receiptId: string }> },
): Promise<Response> {
  const { receiptId } = await params;
  if (!isDocumentId(receiptId)) return billingDocumentNotFound();
  const now = new Date();
  const doc = await withSession(async ({ db, self }) =>
    ownReceiptDocument(db, self, receiptId, now),
  );
  return doc.ok ? billingDocumentResponse(doc.value, now) : billingDocumentNotFound();
}
