import { getInvoiceDocument } from '@visastack/services';
import { bootstrapAdminEmails, isPlatformOwnerAccount } from '../../../../../../../../lib/admin';
import {
  billingDocumentNotFound,
  billingDocumentResponse,
  isDocumentId,
} from '../../../../../../../../lib/billing-documents';
import { withSession } from '../../../../../../../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Download Invoice (PDF) from the platform's organization page (S30). Platform owners only, the
 * same standing as the page itself; the service checks it again. Anyone else gets a 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; invoiceId: string }> },
): Promise<Response> {
  const { orgId, invoiceId } = await params;
  if (!isDocumentId(orgId) || !isDocumentId(invoiceId)) return billingDocumentNotFound();
  const now = new Date();
  const doc = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return null;
    return getInvoiceDocument(db, {
      actorAccountId: accountId,
      organizationId: orgId,
      invoiceId,
      actorEmail: email,
      bootstrapEmails: bootstrapAdminEmails(),
      now,
    });
  });
  return doc?.ok ? billingDocumentResponse(doc.value, now) : billingDocumentNotFound();
}
