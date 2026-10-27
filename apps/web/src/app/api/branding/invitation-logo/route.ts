import { loadInvitationLogo } from '../../../../lib/invitation-preview';
import { INVITATION_TOKEN_PATTERN } from '../../../../lib/invitation-token';
import { logoResponse } from '../../../../lib/logo-response';

export const dynamic = 'force-dynamic';

/**
 * The inviting agency's logo for the public invitation page, before anyone has signed in. It answers
 * only for a link that is still open and only for an agency VisaStack has reviewed; for every other
 * case (no such link, closed, no logo, agency not reviewed) it gives the same plain 404, so it tells
 * nobody anything the page itself does not. Served exactly like the signed-in logo, except that its
 * address carries the invitation token, so shared caches are told to keep it out. It lives under the
 * API folder because those routes are served with their own headers (the page-wide security policy
 * is for pages).
 */
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (!INVITATION_TOKEN_PATTERN.test(token)) return new Response('not found', { status: 404 });
  const logo = await loadInvitationLogo(token);
  if (logo.state === 'busy') return new Response('try again later', { status: 429 });
  if (logo.state !== 'found') return new Response('not found', { status: 404 });
  return logoResponse(logo, 'private, max-age=3600');
}
