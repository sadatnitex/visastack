/**
 * The public site's header list (WP-PUB1): the five public pages, in this order, under one
 * list. Owner decision, 17 Nov 2026: the menu names /trust "Privacy and Trust".
 *
 * Three pages get their own address in later units (How It Works in PUB3, Countries and For
 * Agencies in PUB4). Until a unit ships its page, its entry points at the part of the home page
 * that tells the same story today, so the header never links to a missing page. A unit that
 * ships its page adds the path to `LIVE_ROUTES` in the same change, and the header follows.
 */

/** Words that already have a translation in the home message catalogue. */
export type PublicNavKey = 'home.page.howItWorks' | 'home.page.forAgencies';

export interface PublicNavEntry {
  /** The page's own address. */
  readonly route: string;
  /** Where the entry points while the page's own address does not exist yet. */
  readonly fallback: string;
  /** The fallback for a signed-in person, when the visitor's fallback is not shown to them. */
  readonly memberFallback?: string;
  /** The words in English (Title Case). */
  readonly label: string;
  /** The catalogue key with the same words, when one exists, so Bangla visitors read them. */
  readonly key?: PublicNavKey;
}

export const PUBLIC_NAV: readonly PublicNavEntry[] = Object.freeze([
  { route: '/', fallback: '/', label: 'Home' },
  {
    route: '/how-it-works',
    fallback: '/#how-it-works',
    label: 'How It Works',
    key: 'home.page.howItWorks',
  },
  { route: '/trust', fallback: '/trust', label: 'Privacy and Trust' },
  // The home page's country picker is for visitors; a signed-in person has the full list in the app.
  {
    route: '/countries',
    fallback: '/#start',
    memberFallback: '/app/countries',
    label: 'Countries',
  },
  {
    route: '/for-agencies',
    fallback: '/#for-agencies',
    label: 'For Agencies',
    key: 'home.page.forAgencies',
  },
]);

/**
 * The public pages that exist today. PUB3 adds '/how-it-works'; PUB4 adds '/countries' and
 * '/for-agencies'. A test checks every path here has a page file.
 */
export const LIVE_ROUTES: ReadonlySet<string> = new Set(['/', '/how-it-works', '/trust']);

export interface PublicNavLink {
  readonly href: string;
  readonly label: string;
  readonly key?: PublicNavKey;
}

/** The header links as they should be drawn now, for a visitor or a signed-in person. */
export function publicNavLinks(
  live: ReadonlySet<string> = LIVE_ROUTES,
  { signedIn = false }: { readonly signedIn?: boolean } = {},
): PublicNavLink[] {
  return PUBLIC_NAV.map(({ route, fallback, memberFallback, label, key }) => ({
    href: live.has(route) ? route : signedIn && memberFallback ? memberFallback : fallback,
    label,
    ...(key ? { key } : {}),
  }));
}
