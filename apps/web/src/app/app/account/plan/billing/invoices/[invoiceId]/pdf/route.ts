import { ownInvoiceDocument } from '@visastack/services';
import {
  billingDocumentNotFound,
  billingDocumentResponse,
  isDocumentId,
} from '../../../../../../../../lib/billing-documents';
import { withSession } from '../../../../../../../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Download Invoice (PDF) for a traveller's own purchase (ADR 0025, T5). Signed-in only (withSession
 * sends anyone else to sign in) and readable only by the person who paid it: another person's
 * invoice, an agency's invoice and an unknown id all get the same 404. Made fresh, never stored.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
): Promise<Response> {
  const { invoiceId } = await params;
  if (!isDocumentId(invoiceId)) return billingDocumentNotFound();
  const now = new Date();
  const doc = await withSession(async ({ db, self }) =>
    ownInvoiceDocument(db, self, invoiceId, now),
  );
  return doc.ok ? billingDocumentResponse(doc.value, now) : billingDocumentNotFound();
}
