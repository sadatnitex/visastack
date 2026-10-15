import { readOrganizationLogo } from '@visastack/services';
import { withSession } from '../../../../../lib/session';
import { createStorage } from '../../../../../lib/storage';

export const dynamic = 'force-dynamic';

const ORG_ID = /^[a-f0-9-]{36}$/i;

/** A fresh, exactly-sized copy, so a view over a larger pooled buffer never leaks bytes beyond the image. */
function freshArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return body.buffer;
}

/**
 * An agency's logo, for the image tags in the agency workspace, the settings preview and an invitation.
 * It serves only what the safety scan already passed (PNG or JPEG, checked again when read), only to a
 * signed-in person (the name and logo already show to anyone who can open the agency page), and never as
 * something a browser may run: nosniff, a sandboxing policy and an inline image type only. The address
 * carries a version that changes with the logo, so a long browser cache is safe.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<Response> {
  const { orgId } = await params;
  if (!ORG_ID.test(orgId)) return new Response('not found', { status: 404 });
  return withSession(async ({ db }) => {
    const logo = await readOrganizationLogo(db, createStorage(db), orgId);
    if (!logo) return new Response('not found', { status: 404 });
    return new Response(freshArrayBuffer(logo.bytes), {
      status: 200,
      headers: {
        'Content-Type': logo.contentType,
        'Content-Length': String(logo.bytes.byteLength),
        'Content-Disposition': 'inline; filename="logo"',
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  });
}
