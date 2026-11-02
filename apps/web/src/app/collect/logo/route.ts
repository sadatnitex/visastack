import { readGuestDeskLogo } from '@visastack/services';
import { cookies } from 'next/headers';
import { logoResponse } from '../../../lib/logo-response';
import { withPublicDb } from '../../../lib/public-db';
import { reportServerError } from '../../../lib/server-error';
import { createStorage } from '../../../lib/storage';
import { COLLECT_COOKIE, collectSwitchOn, sessionProofFrom } from '../load';

export const dynamic = 'force-dynamic';

/**
 * The agency's logo on the Document Collection Desk (UMPE P8): only for a live desk session whose
 * link is open, and only for an agency VisaStack has reviewed. It serves what the upload check
 * passed, through the same response the agency's own logo route uses (an inline image type,
 * nosniff, a sandboxing policy), and is never cached beyond this browser.
 */
export async function GET(): Promise<Response> {
  if (!collectSwitchOn()) return new Response('Not Found', { status: 404 });
  const proof = sessionProofFrom((await cookies()).get(COLLECT_COOKIE)?.value);
  if (!proof) return new Response('Not Found', { status: 404 });
  try {
    const logo = await withPublicDb((db) => readGuestDeskLogo(db, createStorage(db), proof));
    if (!logo) return new Response('Not Found', { status: 404 });
    return logoResponse(logo, 'private, no-store');
  } catch (error) {
    reportServerError('guestCollectionLogo', error, { step: 'lookup failed' });
    return new Response('Not Found', { status: 404 });
  }
}
