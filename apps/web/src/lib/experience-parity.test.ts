import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OUTSIDE_APP_NAVIGATION, ROUTE_PARITY } from './experience-parity';
import { type NavLink, isCurrentPath } from './navigation';
import {
  MY_DOCUMENTS,
  MY_TRIPS,
  SHARING_AND_REQUESTS,
  type WorkspaceAccess,
  recordSections,
  workspaceNavigation,
} from './workspace-navigation';

/**
 * UMPE P13 parity: the three traveller entry points lead, and nothing is lost (locked contract
 * annex F). Every page under app/app is classified in `experience-parity.ts`; a navigation page
 * must be offered by the sidebar, a contextual one must still be linked from the file named.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '..');
const repoRoot = path.resolve(srcDir, '../../..');
const appDir = path.join(srcDir, 'app', 'app');

/** Every page route under app/app, route groups dropped, as written on disk. */
function pageRoutes(dir: string, prefix = '/app'): string[] {
  const routes: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      const segment = /^\(.*\)$/.test(name) ? '' : `/${name}`;
      routes.push(...pageRoutes(full, `${prefix}${segment}`));
    } else if (name === 'page.tsx') {
      routes.push(prefix);
    }
  }
  return routes;
}

const P = '10000000-0000-4000-8000-000000000013';
const O = '20000000-0000-4000-8000-000000000013';
const everything: WorkspaceAccess = {
  travellers: [{ id: P, name: 'Synthetic Self', relationship: 'SELF' }],
  agencies: [{ id: O, name: 'Synthetic Agency', admin: true, collectionRequests: true }],
  platform: { owner: true, ai: true, complaints: true, audit: true, privacy: true, removals: true },
};
const nobody: WorkspaceAccess = { travellers: [], agencies: [], platform: null };

function offeredBy(links: readonly NavLink[]): string[] {
  return links.flatMap((item) => [item.href, ...(item.action ? [item.action.href] : [])]);
}

/** Every address the navigation offers anywhere, without fragments. */
function offered(): Set<string> {
  const navs = [
    workspaceNavigation(`/app/applicant/${P}`, everything),
    workspaceNavigation('/app', nobody),
    workspaceNavigation(`/app/agency/${O}`, everything),
    workspaceNavigation('/app/admin', everything),
  ];
  return new Set(
    [
      ...navs.flatMap((nav) => [
        ...offeredBy(nav.primary),
        ...offeredBy(nav.tools),
        ...offeredBy(nav.settings),
      ]),
      ...recordSections(P).map((section) => section.href),
    ].map((href) => href.split('#')[0] ?? href),
  );
}

const concrete = (route: string) => route.replaceAll('[id]', P).replaceAll('[orgId]', O);

describe('UMPE P13 parity map', () => {
  const routes = pageRoutes(appDir).sort();

  it('classifies every signed-in page, and lists no page that does not exist', () => {
    expect(routes.length).toBeGreaterThan(70);
    const missing = routes.filter((route) => !(route in ROUTE_PARITY));
    expect(missing, 'add each new page to experience-parity.ts').toEqual([]);
    const stale = Object.keys(ROUTE_PARITY).filter((route) => !routes.includes(route));
    expect(stale).toEqual([]);
  });

  it('offers every navigation page from the sidebar, its tasks, More Tools or a Record section', () => {
    const reach = offered();
    for (const [route, how] of Object.entries(ROUTE_PARITY)) {
      if (how.kind !== 'navigation') continue;
      expect(reach.has(concrete(route)), route).toBe(true);
    }
    for (const route of OUTSIDE_APP_NAVIGATION) expect(reach.has(route), route).toBe(true);
  });

  it('keeps every contextual link and invitation address in place', () => {
    for (const [route, how] of Object.entries(ROUTE_PARITY)) {
      if (how.kind === 'navigation') continue;
      const file = how.from.startsWith('packages/')
        ? path.join(repoRoot, how.from)
        : path.join(srcDir, how.from);
      expect(readFileSync(file, 'utf8').includes(how.contains), `${route}: ${how.from}`).toBe(true);
    }
  });

  it('gives Start a Trip, Group Trips and Answers to Agencies a menu entry for the first time', () => {
    const reach = offered();
    for (const route of ['/app/mission/start', '/app/trips', '/collect/account/answers']) {
      expect(reach.has(route), route).toBe(true);
    }
  });
});

/** The traveller links just before P13 (origin/main 44d38213). Frozen: never edit. */
const BEFORE_P13: readonly (readonly [string, string])[] = [
  ['Home', `/app/applicant/${P}`],
  ['Record', `/app/applicant/${P}/record`],
  ['Cases', `/app/applicant/${P}/missions`],
  ['Sharing', `/app/applicant/${P}/sharing`],
  ['Notifications', '/app/notifications'],
  ['Countries', '/app/countries'],
  ['Shared with Me', '/app/shared'],
  ['Account Overview', '/app'],
  ['Evidence Requests', `/app/applicant/${P}/evidence`],
];

describe('the three traveller entry points (UMPE P13)', () => {
  it('keeps every destination the traveller sidebar offered before', () => {
    const nav = workspaceNavigation(`/app/applicant/${P}`, everything);
    const now = new Set([...offeredBy(nav.primary), ...offeredBy(nav.tools)]);
    for (const [label, href] of BEFORE_P13) expect(now.has(href), `${label} (${href})`).toBe(true);
  });

  it('leads with Home and the three entry points, in that order', () => {
    const nav = workspaceNavigation(`/app/applicant/${P}`, everything);
    expect(nav.primary.slice(0, 4).map((item) => item.label)).toEqual([
      'Home',
      MY_DOCUMENTS,
      MY_TRIPS,
      SHARING_AND_REQUESTS,
    ]);
  });

  it('shows the entry points to travellers only, never in an agency or platform workspace', () => {
    const names = new Set<string>([MY_DOCUMENTS, MY_TRIPS, SHARING_AND_REQUESTS]);
    for (const at of [
      `/app/agency/${O}`,
      `/app/agency/${O}/cases`,
      '/app/admin',
      '/app/admin/packs',
    ]) {
      const nav = workspaceNavigation(at, everything);
      const labels = [...nav.primary, ...nav.tools, ...nav.settings].map((item) => item.label);
      expect(
        labels.filter((label) => names.has(label)),
        at,
      ).toEqual([]);
      expect(
        [...nav.primary, ...nav.tools].some((item) => item.action),
        at,
      ).toBe(false);
    }
  });

  it('gives each page one current destination at most among the entry points', () => {
    const nav = workspaceNavigation(`/app/applicant/${P}`, everything);
    for (const route of Object.keys(ROUTE_PARITY)) {
      const at = concrete(route).replaceAll(/\[[a-zA-Z]+\]/g, 'synthetic');
      const lit = nav.primary.filter((item) => isCurrentPath(at, item));
      expect(lit.length, at).toBeLessThanOrEqual(1);
    }
  });
});
