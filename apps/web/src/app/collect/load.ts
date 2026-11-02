import 'server-only';
import {
  type PublicCollectionView,
  RATE_LIMITS,
  agencyCollectionRequestsEnabled,
  checkRateLimits,
  collectionLinkProof,
  openCollectionLink,
} from '@visastack/services';
import { clientAddressFrom, hashedSubject } from '../../lib/client-address';
import { withPublicDb } from '../../lib/public-db';
import { reportServerError } from '../../lib/server-error';

/**
 * The public side of an agency document request (UMPE P6). The link is never identity: it opens a
 * neutral page that names only an agency VisaStack has reviewed. The token moves from the address
 * into a short-lived cookie on the first visit (`/collect/open`) and never stays in the address bar
 * or a Referer. Every look is counted per network address (as a short hash) and per link, and an
 * unknown, expired, revoked, replaced or ended link all get the same closed answer.
 */

/** Where the first visit lands once the token is in the cookie: the page itself, with no token. */
export const COLLECT_PAGE = { href: '/collect', busyHref: '/collect?busy=1' } as const;

/** The cookie holding the open link, bound to the link's id: `<link id>.<token>`. */
export const COLLECT_COOKIE = 'vs_collect';
/** How long the cookie lives: a short visit, never a session. */
export const COLLECT_COOKIE_SECONDS = 30 * 60;

export type CollectPage =
  | { readonly state: 'open'; readonly view: PublicCollectionView }
  | { readonly state: 'closed' }
  | { readonly state: 'busy' };

export function collectSwitchOn(): boolean {
  return agencyCollectionRequestsEnabled();
}

/** The cookie's value for an open link. */
export function cookieValue(linkId: string, token: string): string {
  return `${linkId}.${token}`;
}

/** The link id and token a cookie holds, or null when it is not one of ours. */
export function parseCookie(
  value: string | undefined,
): { readonly linkId: string; readonly token: string } | null {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(value ?? '');
  return match?.[1] && match[2] ? { linkId: match[1], token: match[2] } : null;
}

/**
 * Open the link this token names, counting the look per address and per link. `expectLinkId` binds
 * a cookie to the link it was made for: a different link reads as closed.
 */
export async function loadCollectPage(
  requestHeaders: Pick<Headers, 'get'>,
  token: string | null,
  expectLinkId?: string,
): Promise<CollectPage> {
  // The first visit (no link id yet) counts against the address and the link; a later look with
  // the cookie counts against its own address budget, so a first visit is never charged twice.
  const first = expectLinkId === undefined;
  const proof = collectionLinkProof(token);
  try {
    return await withPublicDb(async (db) => {
      const address = clientAddressFrom(requestHeaders);
      const decision = await checkRateLimits(db, [
        {
          input: {
            subjectId: hashedSubject('net', address),
            action: first ? 'collect.open_ip' : 'collect.view_ip',
            label: 'visit',
          },
          config: RATE_LIMITS.COLLECTION_OPEN_IP,
        },
        ...(proof && first
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
      const view = await openCollectionLink(db, proof);
      if (!view || (expectLinkId !== undefined && view.linkId !== expectLinkId)) {
        return { state: 'closed' } as const;
      }
      return { state: 'open', view } as const;
    });
  } catch (error) {
    reportServerError('collectionRequestLink', error, { step: 'lookup failed' });
    return { state: 'closed' };
  }
}
