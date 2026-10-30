import 'server-only';
import { type BillingDocumentIssuer, renderBillingDocumentPdf } from '@visastack/adapters';
import type { BillingDocument } from '@visastack/services';
import { resolveAppOrigin } from './csp';

/**
 * The response side of the downloadable Invoice and Receipt (S30). The routes stay thin: they
 * check who is asking through the service (which builds the document), and this file draws it and
 * sends it. Nothing is stored; every download is made fresh.
 */

const SUPPORT_EMAIL_VAR = 'SUPPORT_EMAIL';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a path segment is an id at all (anything else is answered "not found" unread). */
export function isDocumentId(value: string): boolean {
  return ID.test(value);
}

/** Who issues the document: the product's address and the watched support inbox, when set up. */
export function billingDocumentIssuer(
  readEnv: (name: string) => string | undefined = (name) => process.env[name],
): BillingDocumentIssuer {
  const origin = resolveAppOrigin(readEnv);
  const website = origin ? new URL(origin).host : undefined;
  const support = readEnv(SUPPORT_EMAIL_VAR)?.trim();
  const supportEmail =
    support && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(support) ? support : undefined;
  return { ...(website ? { website } : {}), ...(supportEmail ? { supportEmail } : {}) };
}

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
} as const;

/** The same answer for "no such document", "not yours" and "not allowed", so nothing is revealed. */
export function billingDocumentNotFound(): Response {
  return new Response('not found', { status: 404, headers: PRIVATE_HEADERS });
}

/** A fresh, exactly-sized copy, so a view over a larger pooled buffer never sends extra bytes. */
function freshArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return body.buffer;
}

/** Draws the document and sends it as a download the browser may not sniff, run or cache. */
export async function billingDocumentResponse(
  doc: BillingDocument,
  now: Date = new Date(),
): Promise<Response> {
  const bytes = await renderBillingDocumentPdf(doc, billingDocumentIssuer(), now);
  // The service builds the name from letters, digits, hyphens and ".pdf" only.
  const fileName = /^[A-Za-z0-9.-]{1,120}$/.test(doc.fileName) ? doc.fileName : 'VisaStack.pdf';
  return new Response(freshArrayBuffer(bytes), {
    status: 200,
    headers: {
      ...PRIVATE_HEADERS,
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}
