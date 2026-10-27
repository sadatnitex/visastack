import 'server-only';
import {
  type PublicClientInvitationView,
  RATE_LIMITS,
  checkRateLimit,
  getPublicClientInvitationView,
  readPublicClientInvitationLogo,
} from '@visastack/services';
import { headers } from 'next/headers';
import { clientAddressFrom, hashedSubject } from './client-address';
import { withPublicDb } from './public-db';
import { reportServerError } from './server-error';
import { createStorage } from './storage';

/**
 * What the public page of an agency's client invitation (and its logo) may learn, for someone who
 * has not signed in. Each look is counted against the visitor's network address (kept only as a
 * short hash), so the page cannot be used to try tokens in bulk. A token that is unknown, expired,
 * withdrawn or used all come back as the same `closed`, so the page cannot be used to find out
 * which invitations exist.
 */

export type ClientInvitationPage =
  | { readonly state: 'open'; readonly view: PublicClientInvitationView }
  | { readonly state: 'closed' }
  | { readonly state: 'busy' }
  /** Something failed on our side: the page falls back to the plain sign-in handoff. */
  | { readonly state: 'unavailable' };

export async function loadClientInvitationPage(token: string): Promise<ClientInvitationPage> {
  try {
    const address = clientAddressFrom(await headers());
    return await withPublicDb(async (db): Promise<ClientInvitationPage> => {
      const decision = await checkRateLimit(
        db,
        {
          subjectId: hashedSubject('net', address),
          action: 'invitation.preview_ip',
          label: 'visit',
        },
        RATE_LIMITS.INVITATION_PREVIEW_IP,
      );
      if (!decision.allowed) return { state: 'busy' };
      const view = await getPublicClientInvitationView(db, token);
      return view ? { state: 'open', view } : { state: 'closed' };
    });
  } catch (error) {
    reportServerError('invitationPreview', error, { step: 'lookup failed' });
    return { state: 'unavailable' };
  }
}

export type InvitationLogo =
  | { readonly state: 'found'; readonly bytes: Uint8Array; readonly contentType: string }
  | { readonly state: 'none' }
  | { readonly state: 'busy' };

/** The inviting agency's logo, only for an open invitation from a reviewed agency. */
export async function loadInvitationLogo(token: string): Promise<InvitationLogo> {
  try {
    const address = clientAddressFrom(await headers());
    return await withPublicDb(async (db): Promise<InvitationLogo> => {
      const decision = await checkRateLimit(
        db,
        {
          subjectId: hashedSubject('net', address),
          action: 'invitation.logo_ip',
          label: 'visit',
        },
        RATE_LIMITS.INVITATION_LOGO_IP,
      );
      if (!decision.allowed) return { state: 'busy' };
      const logo = await readPublicClientInvitationLogo(db, createStorage(db), token);
      return logo ? { state: 'found', ...logo } : { state: 'none' };
    });
  } catch (error) {
    reportServerError('invitationLogo', error, { step: 'lookup failed' });
    return { state: 'none' };
  }
}
