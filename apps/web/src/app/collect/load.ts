import 'server-only';
import {
  type GuestCollectionSessionProof,
  type GuestDesk,
  RATE_LIMITS,
  agencyCollectionRequestsEnabled,
  checkRateLimits,
  collectionLinkProof,
  guestCollectionSessionProof,
  guestSessionLink,
  readGuestDesk,
  startGuestSession,
} from '@visastack/services';
import { clientAddressFrom, hashedSubject } from '../../lib/client-address';
import { withPublicDb } from '../../lib/public-db';
import { reportServerError } from '../../lib/server-error';

/**
 * The public side of an agency document request (UMPE P6, P8). The link is never identity. Its
 * first visit (`/collect/open`) exchanges the token for a server-side desk session: the cookie holds
 * only a random session id (stored as a hash), never the link token, and the token leaves the
 * address at once. The session is bound to that link and the checklist it issued, ends after 30
 * idle minutes or 12 hours, and ends at once when the link or request does. Unverified, the desk
 * shows only who is asking; a one-time email code to the address the agency entered for the link
 * proves the guest. Every look is counted per network address (a short hash), and every closed
 * answer reads the same.
 */

/** Where the first visit lands once the session is made: the page itself, with no token. */
export const COLLECT_PAGE = { href: '/collect', busyHref: '/collect?busy=1' } as const;

/**
 * Where "Sign In to Respond" leads: the account path of this landing, owned and built by P7
 * (`apps/web/src/app/collect/account/**`). Until P7 merges this page does not exist; the switch
 * stays off in production until it does (lead check in the P8 hand-back).
 */
export const SIGN_IN_TO_RESPOND_HREF = '/collect/account';

/** The cookie holding the desk session id (32 random bytes, base64url). Never the link token. */
export const COLLECT_COOKIE = 'vs_collect';
/** The cookie lives no longer than a session can (12 hours); the server ends it sooner when idle. */
export const COLLECT_COOKIE_SECONDS = 12 * 60 * 60;

export const COLLECT_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/collect',
} as const;

export type CollectPage =
  | { readonly state: 'desk'; readonly desk: GuestDesk }
  | { readonly state: 'closed' }
  | { readonly state: 'busy' };

export function collectSwitchOn(): boolean {
  return agencyCollectionRequestsEnabled();
}

/** The session proof a cookie value names, or null when it cannot be one. */
export function sessionProofFrom(value: string | undefined): GuestCollectionSessionProof | null {
  return guestCollectionSessionProof(value);
}

export function networkSubject(requestHeaders: Pick<Headers, 'get'>): string {
  return hashedSubject('net', clientAddressFrom(requestHeaders));
}

async function addressAllowed(
  db: Parameters<typeof checkRateLimits>[0],
  requestHeaders: Pick<Headers, 'get'>,
  action: string,
): Promise<boolean> {
  const decision = await checkRateLimits(db, [
    {
      input: { subjectId: networkSubject(requestHeaders), action, label: 'visit' },
      config: RATE_LIMITS.COLLECTION_OPEN_IP,
    },
  ]);
  return decision.allowed;
}

export type OpenedLink =
  | { readonly state: 'open'; readonly rawSessionId: string | null }
  | { readonly state: 'closed' }
  | { readonly state: 'busy' };

/**
 * The first visit: count it per address and per link, then turn an open link into a desk session.
 * `currentCookie` keeps a live session of the same link (opening the link again on the same
 * device). `rawSessionId` is null when the existing session was kept.
 */
export async function openLinkIntoSession(
  requestHeaders: Pick<Headers, 'get'>,
  token: string | null,
  currentCookie: string | undefined,
): Promise<OpenedLink> {
  const proof = collectionLinkProof(token);
  try {
    return await withPublicDb(async (db) => {
      const decision = await checkRateLimits(db, [
        {
          input: {
            subjectId: networkSubject(requestHeaders),
            action: 'collect.open_ip',
            label: 'visit',
          },
          config: RATE_LIMITS.COLLECTION_OPEN_IP,
        },
        ...(proof
          ? [
              {
                input: {
                  subjectId: `link:${proof.tokenHash.slice(0, 32)}`,
                  action: 'collect.open_link',
                  label: 'visit',
                },
                config: RATE_LIMITS.COLLECTION_OPEN_LINK,
              },
            ]
          : []),
      ]);
      if (!decision.allowed) return { state: 'busy' } as const;
      if (!proof) return { state: 'closed' } as const;
      const started = await startGuestSession(db, proof, sessionProofFrom(currentCookie));
      return started
        ? ({ state: 'open', rawSessionId: started.rawSessionId } as const)
        : ({ state: 'closed' } as const);
    });
  } catch (error) {
    reportServerError('collectionRequestLink', error, { step: 'open failed' });
    return { state: 'closed' };
  }
}

/** What the desk shows for the session a cookie names, counted per address. */
export async function loadCollectPage(
  requestHeaders: Pick<Headers, 'get'>,
  cookie: string | undefined,
): Promise<CollectPage> {
  const proof = sessionProofFrom(cookie);
  try {
    return await withPublicDb(async (db) => {
      if (!(await addressAllowed(db, requestHeaders, 'collect.view_ip'))) {
        return { state: 'busy' } as const;
      }
      if (!proof) return { state: 'closed' } as const;
      const desk = await readGuestDesk(db, proof);
      return desk ? ({ state: 'desk', desk } as const) : ({ state: 'closed' } as const);
    });
  } catch (error) {
    reportServerError('collectionRequestLink', error, { step: 'desk lookup failed' });
    return { state: 'closed' };
  }
}

/**
 * For the account path that shares this landing (`/collect/account`, P7): the link a live desk
 * session belongs to and whether the guest proved the email, or null. Opening the link grants
 * nothing, so this is never a sign-in.
 */
export async function readCollectSession(
  cookie: string | undefined,
): Promise<{ readonly linkId: string; readonly verified: boolean } | null> {
  const proof = sessionProofFrom(cookie);
  if (!proof) return null;
  try {
    return await withPublicDb((db) => guestSessionLink(db, proof));
  } catch (error) {
    reportServerError('collectionRequestLink', error, { step: 'session lookup failed' });
    return null;
  }
}
