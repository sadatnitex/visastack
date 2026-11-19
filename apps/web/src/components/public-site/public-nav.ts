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
 * The public pages that exist today. PUB3 added '/how-it-works'; PUB4 added '/countries' and
 * '/for-agencies'. A test checks every path here has a page file.
 */
export const LIVE_ROUTES: ReadonlySet<string> = new Set([
  '/',
  '/how-it-works',
  '/trust',
  '/countries',
  '/for-agencies',
]);

export interface PublicNavLink {
  /** The page's own address, kept apart from `href` so the current page can be told by it. */
  readonly route: string;
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
    route,
    href: live.has(route) ? route : signedIn && memberFallback ? memberFallback : fallback,
    label,
    ...(key ? { key } : {}),
  }));
}

/**
 * The pages the footer adds to the header's five (NAV2). Each has its own page file; a test checks
 * every address here against the app's route files. The status page also holds the full words
 * about this version, which the footer links to only while a version notice is shown.
 */
export interface FooterPage {
  readonly route: string;
  readonly key: 'home.layout.privacy' | 'home.layout.terms' | 'home.layout.status';
}

export const FOOTER_LEGAL: readonly FooterPage[] = Object.freeze([
  { route: '/privacy', key: 'home.layout.privacy' },
  { route: '/terms', key: 'home.layout.terms' },
  { route: '/status', key: 'home.layout.status' },
]);

/** Where the full words about this version are, and its anchor on the status page. */
export const ABOUT_VERSION_HREF = '/status#about-this-version';

/** The footer's three groups of links, by the public list they draw from. */
export const FOOTER_PRODUCT_ROUTES: readonly string[] = Object.freeze([
  '/how-it-works',
  '/countries',
  '/for-agencies',
]);
export const FOOTER_TRUST_ROUTES: readonly string[] = Object.freeze(['/trust']);
