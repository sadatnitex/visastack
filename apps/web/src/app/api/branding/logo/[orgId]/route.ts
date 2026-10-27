import { readOrganizationLogo } from '@visastack/services';
import { logoResponse } from '../../../../../lib/logo-response';
import { withSession } from '../../../../../lib/session';
import { createStorage } from '../../../../../lib/storage';

export const dynamic = 'force-dynamic';

const ORG_ID = /^[a-f0-9-]{36}$/i;

/**
 * An agency's logo, for the image tags in the agency workspace, the settings preview and an invitation.
 * It serves only what the upload check already passed (PNG or JPEG, checked again when read), only to a
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
    return logoResponse(logo, 'private, max-age=86400');
  });
}
