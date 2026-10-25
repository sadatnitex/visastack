import { readApplicantPhoto } from '@visastack/services';
import { photoAccess } from '../../../../../lib/profile-photos';
import { withSession } from '../../../../../lib/session';
import { createStorage } from '../../../../../lib/storage';

export const dynamic = 'force-dynamic';

const APPLICANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The same answer for "no such person", "not yours" and "no photo", so the route reveals nothing. */
function notFound(): Response {
  return new Response('not found', {
    status: 404,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** A fresh, exactly-sized copy, so a view over a larger pooled buffer never leaks bytes beyond the image. */
function freshArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return body.buffer;
}

/**
 * A traveller's profile photo (WP-PH1). Signed-in only (withSession sends anyone else to sign
 * in), decided by the access gate for that one record, and served to the record's owner alone.
 * Only the server's own re-encoded JPEG is ever sent, as an inline image the browser may not
 * sniff or run, and it is never kept in a shared or disk cache.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!APPLICANT_ID.test(id)) return notFound();
  return withSession(async ({ db, accountId }) => {
    const access = await photoAccess(db, accountId, id, 'VIEW_METADATA');
    if (!access) return notFound();
    const photo = await readApplicantPhoto(access, createStorage(db));
    if (!photo.ok) return notFound();
    return new Response(freshArrayBuffer(photo.value.bytes), {
      status: 200,
      headers: {
        'Content-Type': photo.value.contentType,
        'Content-Length': String(photo.value.bytes.byteLength),
        'Content-Disposition': 'inline; filename="photo.jpg"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Referrer-Policy': 'no-referrer',
      },
    });
  });
}
