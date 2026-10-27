import { loadInvitationLogo } from '../../../lib/invitation-preview';

export const dynamic = 'force-dynamic';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** A fresh, exactly-sized copy, so a view over a larger pooled buffer never leaks bytes beyond the image. */
function freshArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return body.buffer;
}

/**
 * The inviting agency's logo for the public invitation page, before anyone has signed in. It answers
 * only for a link that is still open and only for an agency VisaStack has reviewed; for every other
 * case (no such link, closed, no logo, agency not reviewed) it gives the same plain 404, so it tells
 * nobody anything the page itself does not. Served like the signed-in logo: an inline picture and
 * nothing a browser may run.
 */
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (!TOKEN.test(token)) return new Response('not found', { status: 404 });
  const logo = await loadInvitationLogo(token);
  if (logo.state === 'busy') {
    return new Response('try again later', { status: 429, headers: { 'Retry-After': '600' } });
  }
  if (logo.state !== 'found') return new Response('not found', { status: 404 });
  return new Response(freshArrayBuffer(logo.bytes), {
    status: 200,
    headers: {
      'Content-Type': logo.contentType,
      'Content-Length': String(logo.bytes.byteLength),
      'Content-Disposition': 'inline; filename="logo"',
      // The address carries the invitation token, so it is not kept by shared caches.
      'Cache-Control': 'private, max-age=3600',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}
