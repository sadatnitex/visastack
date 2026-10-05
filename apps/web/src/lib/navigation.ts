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

import type { MessageKey, Translator } from '@visastack/i18n';

export interface NavLink {
  readonly href: string;
  /** The English name, which the tests and the Playwright checks read. */
  readonly label: string;
  /** The catalog message for this name; a link without one (the professional consoles) is shown in English. */
  readonly labelKey?: MessageKey;
  /** Current only on this exact path, not on pages below it (an overview or home link). */
  readonly exact?: boolean;
  /** Further path prefixes that also belong to this link (pages that live elsewhere in the route tree). */
  readonly alsoCurrentFor?: readonly string[];
}

/** Persistent primary navigation for a signed-in traveller. */
export const PRIMARY_NAV: readonly NavLink[] = [
  { href: '/app', label: 'Overview', labelKey: 'shell.app.overview', exact: true },
  {
    href: '/app/applicants',
    label: 'Applicants',
    labelKey: 'shell.app.applicants',
    // A person's workspace and their case pages sit outside `/app/applicants`.
    alsoCurrentFor: ['/app/applicant/', '/app/mission/'],
  },
  { href: '/app/shared', label: 'Shared with me', labelKey: 'shell.app.shared' },
  { href: '/app/notifications', label: 'Alerts', labelKey: 'shell.app.alerts' },
  { href: '/app/privacy', label: 'Privacy', labelKey: 'shell.app.privacy' },
  { href: '/app/account', label: 'Account', labelKey: 'shell.app.account' },
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
    { href: base, label: 'Overview', labelKey: 'shell.applicant.overview', exact: true },
    { href: `${base}/profile`, label: 'Profile', labelKey: 'shell.applicant.profile' },
    { href: `${base}/documents`, label: 'Documents', labelKey: 'shell.applicant.documents' },
    { href: `${base}/missions`, label: 'Cases', labelKey: 'shell.applicant.cases' },
    { href: `${base}/sharing`, label: 'Sharing', labelKey: 'shell.applicant.sharing' },
    { href: `${base}/evidence`, label: 'Evidence', labelKey: 'shell.applicant.evidence' },
    { href: `${base}/expiry`, label: 'Expiry', labelKey: 'shell.applicant.expiry' },
    { href: `${base}/history`, label: 'History', labelKey: 'shell.applicant.history' },
  ];
}

/**
 * The links with their names in the reader's language. A link carries the key of
 * its message; one with no key keeps its English name. The result is plain data a
 * client navigation component can receive, so no catalog reaches the browser.
 */
export function localizeLinks(links: readonly NavLink[], t: Translator): readonly NavLink[] {
  return links.map((link) => (link.labelKey ? { ...link, label: t(link.labelKey) } : link));
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
    { href: `${base}/plan`, label: 'Usage & billing' },
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
  const path = stripTrailingSlash(pathname);
  if (link.exact) return path === stripTrailingSlash(link.href);
  if (underPrefix(path, stripTrailingSlash(link.href))) return true;
  return (link.alsoCurrentFor ?? []).some((prefix) => underPrefix(path, prefix));
}
