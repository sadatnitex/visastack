import { readClaimProofFile } from '@visastack/services';
import { bootstrapAdminEmails, isPlatformOwnerAccount } from '../../../../../../lib/admin';
import { withSession } from '../../../../../../lib/session';
import { createStorage } from '../../../../../../lib/storage';

export const dynamic = 'force-dynamic';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXTENSIONS: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** The same answer for "no such file", "not yours" and "not allowed", so the route reveals nothing. */
function notFound(): Response {
  return new Response('not found', {
    status: 404,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** A fresh, exactly-sized copy, so a view over a larger pooled buffer never leaks bytes beyond the file. */
function freshArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return body.buffer;
}

/**
 * The proof of payment attached to a payment report (S12, ADR 0020). Signed-in only (withSession
 * sends anyone else to sign in), served to the owners and admins of that agency and to platform
 * owners, and to nobody else. It is always sent as a download that the browser may not sniff or
 * run, and it is never kept in a shared or disk cache.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; claimId: string }> },
): Promise<Response> {
  const { orgId, claimId } = await params;
  if (!ID.test(orgId) || !ID.test(claimId)) return notFound();
  return withSession(async ({ db, accountId, email }) => {
    const staff = await isPlatformOwnerAccount(db, { accountId, email });
    const file = await readClaimProofFile(db, createStorage(db), {
      actorAccountId: accountId,
      organizationId: orgId,
      claimId,
      ...(staff ? { actorEmail: email, bootstrapEmails: bootstrapAdminEmails() } : {}),
    });
    if (!file.ok) return notFound();
    const extension = EXTENSIONS[file.value.contentType] ?? 'bin';
    return new Response(freshArrayBuffer(file.value.bytes), {
      status: 200,
      headers: {
        'Content-Type': file.value.contentType,
        'Content-Length': String(file.value.bytes.byteLength),
        'Content-Disposition': `attachment; filename="proof-of-payment.${extension}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Referrer-Policy': 'no-referrer',
      },
    });
  });
}
