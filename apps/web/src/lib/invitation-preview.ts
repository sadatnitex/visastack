import 'server-only';
import {
  type Db,
  type PublicClientInvitationView,
  RATE_LIMITS,
  type RateLimitConfig,
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
 * withdrawn, used or no longer acceptable all come back as the same `closed`, so the page cannot be
 * used to find out which invitations exist.
 */

type Limited<T> = { readonly state: 'busy' } | { readonly state: 'ok'; readonly value: T };

/** Counts one look from the visitor's address under `action`, then runs `work` only if it is within `config`. */
async function withinAddressLimit<T>(
  action: string,
  config: RateLimitConfig,
  work: (db: Db) => Promise<T>,
): Promise<Limited<T>> {
  const address = clientAddressFrom(await headers());
  return withPublicDb(async (db): Promise<Limited<T>> => {
    const decision = await checkRateLimit(
      db,
      { subjectId: hashedSubject('net', address), action, label: 'visit' },
      config,
    );
    if (!decision.allowed) return { state: 'busy' };
    return { state: 'ok', value: await work(db) };
  });
}

export type ClientInvitationPage =
  | { readonly state: 'open'; readonly view: PublicClientInvitationView }
  | { readonly state: 'closed' }
  /** This address has looked at a great many links this hour; the page then reads nothing for it. */
  | { readonly state: 'busy' }
  /** Something failed on our side: the page falls back to the plain sign-in handoff. */
  | { readonly state: 'unavailable' };

export async function loadClientInvitationPage(token: string): Promise<ClientInvitationPage> {
  try {
    const result = await withinAddressLimit(
      'invitation.preview_ip',
      RATE_LIMITS.INVITATION_PREVIEW_IP,
      (db) => getPublicClientInvitationView(db, token),
    );
    if (result.state === 'busy') return { state: 'busy' };
    return result.value ? { state: 'open', view: result.value } : { state: 'closed' };
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
    const result = await withinAddressLimit(
      'invitation.logo_ip',
      RATE_LIMITS.INVITATION_LOGO_IP,
      (db) => readPublicClientInvitationLogo(db, createStorage(db), token),
    );
    if (result.state === 'busy') return { state: 'busy' };
    return result.value ? { state: 'found', ...result.value } : { state: 'none' };
  } catch (error) {
    reportServerError('invitationLogo', error, { step: 'lookup failed' });
    return { state: 'none' };
  }
}
