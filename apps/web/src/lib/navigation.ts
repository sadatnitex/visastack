/**
 * Navigation names and "which link is current" rule for the signed-in product
 * (Commercial V1 Part 9 UX-01, section 1). Plain data and one pure function, with
 * no React or Next imports, so the layouts, the client navigation components,
 * the unit tests and the Playwright layout checks all read the same labels.
 *
 * The names are the product's own words for travellers, agencies and platform
 * staff. Internal names ("mission", "provider schema", "job lease") never appear
 * here: a traveller opens a case, not a mission.
 */

export interface NavLink {
  readonly href: string;
  readonly label: string;
  /** Current only on this exact path, not on pages below it (an overview or home link). */
  readonly exact?: boolean;
  /** Further path prefixes that also belong to this link (pages that live elsewhere in the route tree). */
  readonly alsoCurrentFor?: readonly string[];
  readonly alsoExactFor?: readonly string[];
}

/** Persistent primary navigation for a signed-in traveller. */
export const PRIMARY_NAV: readonly NavLink[] = [
  { href: '/app', label: 'Overview', exact: true },
  {
    href: '/app/applicants',
    label: 'Applicants',
    // A person's workspace and their case pages sit outside `/app/applicants`.
    alsoCurrentFor: ['/app/applicant/', '/app/mission/'],
  },
  { href: '/app/shared', label: 'Shared with Me' },
  { href: '/app/notifications', label: 'Alerts' },
  { href: '/app/privacy', label: 'Privacy' },
  { href: '/app/countries', label: 'Countries' },
  { href: '/app/account', label: 'Account' },
];

/**
 * The tabs of one applicant's workspace. "Evidence" and "Expiry" are real,
 * shipped destinations that the directive's own list does not name; they stay as
 * tabs rather than being deleted or hidden. The route segment stays `missions`
 * so existing bookmarks keep working; only the visible name is "Cases".
 */
export function applicantTabs(applicantId: string): readonly NavLink[] {
  const base = `/app/applicant/${applicantId}`;
  return [
    { href: base, label: 'Overview', exact: true },
    { href: `${base}/profile`, label: 'Profile' },
    { href: `${base}/documents`, label: 'Documents' },
    { href: `${base}/missions`, label: 'Cases' },
    { href: `${base}/sharing`, label: 'Sharing' },
    { href: `${base}/evidence`, label: 'Evidence' },
    { href: `${base}/expiry`, label: 'Expiry' },
    { href: `${base}/history`, label: 'History' },
  ];
}

/**
 * The sections of one agency's console (directive Part 9 section 1: Dashboard,
 * Clients, Cases, Team, Usage/Billing, Settings). Clients, Team and Settings are
 * administrator work, so a member who is not an administrator sees only the
 * sections they can use. The route for Usage & billing stays `plan`.
 */
export function agencyTabs(orgId: string, access: { readonly admin: boolean }): readonly NavLink[] {
  const base = `/app/agency/${orgId}`;
  const tabs: readonly (NavLink & { readonly adminOnly?: true })[] = [
    { href: base, label: 'Dashboard', exact: true },
    { href: `${base}/clients`, label: 'Clients', adminOnly: true },
    { href: `${base}/cases`, label: 'Cases' },
    { href: `${base}/team`, label: 'Team', adminOnly: true },
    { href: `${base}/plan`, label: 'Usage & Billing' },
    { href: `${base}/settings`, label: 'Settings', adminOnly: true },
  ];
  return tabs
    .filter((tab) => access.admin || !tab.adminOnly)
    .map(({ adminOnly: _adminOnly, ...link }) => link);
}

/**
 * The sections of platform administration (directive Part 9 section 1:
 * Organizations, Rules, AI, Operations, Privacy, Audit), in that order. Operations
 * is the landing page (`/app/admin`) and so matches only its own path. "Access"
 * (platform roles and pilot access) and "Complaints" are real, shipped areas the
 * directive's list does not name, kept as tabs rather than hidden. AI and
 * Complaints show only to an administrator who may use them, so no tab leads to a
 * refusal. The product spells it "Organizations" everywhere.
 */
export function platformTabs(access: {
  readonly ai: boolean;
  readonly complaints: boolean;
}): readonly NavLink[] {
  return [
    { href: '/app/admin/organizations', label: 'Organizations' },
    { href: '/app/admin/packs', label: 'Rules' },
    ...(access.ai ? [{ href: '/app/admin/ai-settings', label: 'AI' }] : []),
    { href: '/app/admin', label: 'Operations', exact: true },
    { href: '/app/admin/privacy', label: 'Privacy' },
    { href: '/app/admin/audit', label: 'Audit' },
    { href: '/app/admin/access', label: 'Access' },
    ...(access.complaints ? [{ href: '/app/admin/complaints', label: 'Complaints' }] : []),
  ];
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function underPrefix(path: string, prefix: string): boolean {
  if (prefix.endsWith('/')) return path.startsWith(prefix);
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Whether `link` is the current page for `pathname`. A link matches its own path
 * and everything below it, on a path boundary (`/app/shared` does not claim
 * `/app/shared-with`), unless it is `exact`.
 */
export function isCurrentPath(pathname: string, link: NavLink): boolean {
  if (link.href.includes('#')) return pathname === link.href;
  const path = stripTrailingSlash(pathname.split(/[?#]/)[0] ?? pathname);
  if (link.alsoExactFor?.some((candidate) => path === stripTrailingSlash(candidate))) return true;
  if (link.exact) return path === stripTrailingSlash(link.href);
  if (underPrefix(path, stripTrailingSlash(link.href))) return true;
  return (link.alsoCurrentFor ?? []).some((prefix) => underPrefix(path, prefix));
}
