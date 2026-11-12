/**
 * Which language the page itself is marked with (the `lang` of the html element, WCAG 3.1.2).
 *
 * The visitor's choice (`locale`) is not the same thing. Until a screen is fully translated its
 * words are English, and marking it Bangla would make a screen reader voice English text with
 * Bangla rules. So the page is marked Bangla only when the visitor chose Bangla AND the route is
 * on the ready list below. Anything else is English.
 *
 * Add a route here in the same change that finishes translating it.
 */
export type PageLanguage = 'en' | 'bn';

/** Routes whose whole page is written in Bangla when the visitor chose it. Only the auth screens today. */
export const BN_READY_ROUTES: readonly string[] = [
  // Interim entries: the sign-in, sign-up, password and email screens are listed (one by one: /auth/confirmed and /auth/account-recovery are still English) because their headings and controls
  // are predominantly Bengali for a visitor who chose it. English fallbacks there get their own
  // lang="en" marking from the marking pass (t.node, see I18N_RUNTIME.md) once the waves merge; the coverage gate in PR4 will decide readiness formally.
  '/auth/sign-in',
  '/auth/sign-up',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/reauth',
  '/auth/verify-email',
];

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Matching rule: an entry matches the same path, or any path below it at a "/" boundary.
 * "/trust" matches "/trust" and "/trust/x" but not "/trustworthy". The entry "/" matches only
 * "/" itself, so it can never claim the whole site. A trailing slash is ignored. The
 * pathname never carries a query string or "#" part (the middleware sets it from the path alone).
 */
export function matchesRoute(pathname: string, route: string): boolean {
  const path = stripTrailingSlash(pathname);
  const entry = stripTrailingSlash(route);
  if (entry === '/') return path === '/';
  return path === entry || path.startsWith(`${entry}/`);
}

export function pageLanguage(
  locale: string,
  pathname: string | null | undefined,
  routes: readonly string[] = BN_READY_ROUTES,
): PageLanguage {
  if (locale !== 'bn' || !pathname) return 'en';
  return routes.some((route) => matchesRoute(pathname, route)) ? 'bn' : 'en';
}
