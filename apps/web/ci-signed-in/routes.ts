/**
 * Every signed-in page under apps/web/src/app/app, in exactly one of two lists (WAL1B-2,
 * docs/operations/ci-signed-in-guard.md):
 *
 * - ROUTES: pages the route guard (route-guard.guard.ts) opens as a made-up person at every guard
 *   width, checking the final address, text only the page body shows, at least one control, no
 *   sideways scroll and no control painted over.
 * - EXCLUDED: pages it cannot open here, each with the reason.
 *
 * `page` is the page's route as its folder names it (route groups and dynamic segments kept, so a
 * test can match it to the page file). `path` is the address to open: `{name}` is replaced with
 * that seeded id (see SeededIds in people.ts). A test (scripts/ci-signed-in.test.mjs) fails when a
 * page file is in neither list, in both, or a list names a page that does not exist.
 *
 * KNOWN_FAILING lists today's real layout findings by page and width, so the job stays green while
 * they wait for their own fix. It may only shrink: the same test fails when it grows.
 *
 * Plain data only (no imports at run time), so the Node test can read this file directly.
 */

import type { Role } from './people';

/** The made-up person a page is opened as (people.json). */
export type GuardRole = Role;

/** Ids the paths may use, filled from seeded.json (documentId is the first seeded document). */
export const ROUTE_IDS = [
  'applicantId',
  'caseId',
  'organizationId',
  'grantId',
  'documentId',
] as const;
export type RouteId = (typeof ROUTE_IDS)[number];

/** Guard size names, as in GUARD_SIZES (apps/web/e2e/support/layout-guards.ts). */
export type GuardSizeName = 'phone 390' | 'phone 400' | 'desktop 1280';

export interface GuardRoute {
  readonly page: string;
  readonly role: GuardRole;
  readonly path: string;
  /** Text only the page body shows (never the shared header or the agency name bar). */
  readonly mustShow: string;
  /**
   * The other made-up person, who may not see this page (not their profile, case or agency):
   * the guard checks they do NOT see `mustShow` at the same address, which proves the text comes
   * from the page body and not from a heading anyone can reach.
   */
  readonly deniedTo?: GuardRole;
}

export interface ExcludedPage {
  readonly page: string;
  readonly reason: string;
}

/**
 * A real finding the guard expects, exactly: at these sizes the check fails on this page, and
 * (for a covered control) it reports exactly these controls, named as the check quotes them
 * (`"Create Case"`; a name may be the start of one, as `"Everything` for a button that also shows
 * a count). A new covered control on the same page still fails the guard.
 */
export interface KnownFailing {
  readonly page: string;
  readonly check: 'covered control' | 'no control';
  readonly sizes: readonly GuardSizeName[];
  /** For `covered control`: every control the check reports, and only those. */
  readonly controls: readonly string[];
  readonly finding: string;
}

const A = '/app/applicant/{applicantId}';
const O = '/app/agency/{organizationId}';

export const ROUTES: readonly GuardRoute[] = [
  // The traveller.
  { page: '/app/(home)', role: 'traveller', path: '/app', mustShow: 'Welcome back, Rumana' },
  {
    page: '/app/account',
    role: 'traveller',
    path: '/app/account',
    mustShow: 'ci.traveller@example.test',
  },
  {
    page: '/app/account/plan',
    role: 'traveller',
    path: '/app/account/plan',
    mustShow: 'Your plan, what it includes',
  },
  {
    page: '/app/account/whatsapp',
    role: 'traveller',
    path: '/app/account/whatsapp',
    mustShow: 'Ask about your cases from WhatsApp',
  },
  {
    page: '/app/applicants',
    role: 'traveller',
    path: '/app/applicants',
    mustShow: 'Yourself and anyone you manage records for',
  },
  {
    page: '/app/applicant/[id]',
    role: 'traveller',
    path: A,
    mustShow: 'Japan Tourist Visa',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/calendar',
    role: 'traveller',
    path: `${A}/calendar`,
    mustShow: 'Add Dates to My Calendar',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/change-impact',
    role: 'traveller',
    path: `${A}/change-impact?document={documentId}`,
    mustShow: 'What This Change Affects',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/documents',
    role: 'traveller',
    path: `${A}/documents`,
    mustShow: 'passport-scan',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/documents/add',
    role: 'traveller',
    path: `${A}/documents/add`,
    mustShow: 'Drop your files or a whole folder here',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/evidence',
    role: 'traveller',
    path: `${A}/evidence`,
    mustShow: 'An agency is asking you for this',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/evidence/answer',
    role: 'traveller',
    path: `${A}/evidence/answer`,
    mustShow: 'Answer from Your Records',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/expiry',
    role: 'traveller',
    path: `${A}/expiry`,
    mustShow: 'About These Dates',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/history',
    role: 'traveller',
    path: `${A}/history`,
    mustShow: 'Every saved value is kept, and nothing is overwritten',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/insights',
    role: 'traveller',
    path: `${A}/insights`,
    mustShow: 'A summary of your saved documents and profile',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/memory',
    role: 'traveller',
    path: `${A}/memory`,
    mustShow: 'Every case for this person',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/missions',
    role: 'traveller',
    path: `${A}/missions`,
    mustShow: 'Japan Tourist Visa',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/missions/prepare-again',
    role: 'traveller',
    path: `${A}/missions/prepare-again?from={caseId}`,
    mustShow: 'Start a New Case from This One',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/outputs',
    role: 'traveller',
    path: `${A}/outputs`,
    mustShow: 'Choose what goes in, check the preview',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/profile',
    role: 'traveller',
    path: `${A}/profile`,
    mustShow: 'About This Profile',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/record',
    role: 'traveller',
    path: `${A}/record`,
    mustShow: 'Everything saved for Rumana Test Traveller',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/removal-records',
    role: 'traveller',
    path: `${A}/removal-records`,
    mustShow: 'What was deleted from this record',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/review',
    role: 'traveller',
    path: `${A}/review`,
    mustShow: 'Details we read from your documents',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/applicant/[id]/sharing',
    role: 'traveller',
    path: `${A}/sharing`,
    mustShow: 'Harbour Test Travel Agency',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/countries/(list)',
    role: 'traveller',
    path: '/app/countries',
    mustShow: 'What an ordinary Bangladeshi passport needs',
  },
  {
    page: '/app/countries/[iso2]',
    role: 'traveller',
    path: '/app/countries/JP',
    mustShow: 'For an ordinary Bangladeshi passport. Rules change',
  },
  {
    page: '/app/help',
    role: 'traveller',
    path: '/app/help',
    mustShow: 'Guidance for your records, case work and account',
  },
  {
    page: '/app/incoming',
    role: 'traveller',
    path: '/app/incoming',
    mustShow: 'That Share Did Not Come Through',
  },
  {
    page: '/app/mission/[id]',
    role: 'traveller',
    path: '/app/mission/{caseId}',
    mustShow: 'Case Reference',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/mission/[id]/snapshots',
    role: 'traveller',
    path: '/app/mission/{caseId}/snapshots',
    mustShow: 'Each snapshot keeps exactly what this case held',
    deniedTo: 'agencyAdmin',
  },
  {
    page: '/app/mission/start',
    role: 'traveller',
    path: '/app/mission/start',
    mustShow: 'Where Are You Going?',
  },
  {
    page: '/app/notifications',
    role: 'traveller',
    path: '/app/notifications',
    mustShow: 'No Notifications Yet',
  },
  { page: '/app/privacy', role: 'traveller', path: '/app/privacy', mustShow: 'Export Your Data' },
  {
    page: '/app/shared/(list)',
    role: 'traveller',
    path: '/app/shared',
    mustShow: 'Someone granted you access to their records',
  },
  {
    page: '/app/trips/(list)',
    role: 'traveller',
    path: '/app/trips',
    mustShow: 'No group trips yet',
  },
  {
    page: '/app/trips/new',
    role: 'traveller',
    path: '/app/trips/new',
    mustShow: 'Where Are You Going?',
  },

  // The agency admin.
  {
    page: '/app/agency',
    role: 'agencyAdmin',
    path: '/app/agency',
    mustShow: 'Agencies collaborate on cases',
  },
  {
    page: '/app/agency/[orgId]',
    role: 'agencyAdmin',
    path: O,
    mustShow: 'Active Clients',
    deniedTo: 'traveller',
  },
  {
    page: '/app/agency/[orgId]/activity',
    role: 'agencyAdmin',
    path: `${O}/activity`,
    mustShow: 'Recent notes on cases you can access',
    deniedTo: 'traveller',
  },
  {
    page: '/app/agency/[orgId]/ai-connections',
    role: 'agencyAdmin',
    path: `${O}/ai-connections`,
    mustShow: 'No AI Apps Connected',
    deniedTo: 'traveller',
  },
  {
    page: '/app/agency/[orgId]/cases',
    role: 'agencyAdmin',
    path: `${O}/cases`,
    mustShow: 'Japan Tourist Visa',
    deniedTo: 'traveller',
  },
  {
    page: '/app/agency/[orgId]/checklists',
    role: 'agencyAdmin',
    path: `${O}/checklists`,
    mustShow: 'Make a country list your own',
    deniedTo: 'traveller',
  },
  {
    page: '/app/agency/[orgId]/clients',
    role: 'agencyAdmin',
    path: `${O}/clients`,
    mustShow: 'Client Email Address',
    deniedTo: 'traveller',
  },
  {
    page: '/app/agency/[orgId]/countries',
    role: 'agencyAdmin',
    path: `${O}/countries`,
    mustShow: 'What an ordinary Bangladeshi passport needs',
    deniedTo: 'traveller',
  },
  {
    page: '/app/agency/[orgId]/countries/[iso2]',
    role: 'agencyAdmin',
    path: `${O}/countries/JP`,
    mustShow: 'For an ordinary Bangladeshi passport. Rules change',
    deniedTo: 'traveller',
  },
  {
    page: '/app/agency/[orgId]/plan',
    role: 'agencyAdmin',
    path: `${O}/plan`,
    mustShow: 'VisaStack Founding Access',
    deniedTo: 'traveller',
  },
  {
    page: '/app/agency/[orgId]/plan/invoices',
    role: 'agencyAdmin',
    path: `${O}/plan/invoices`,
    mustShow: 'Pay an invoice online or tell us about a payment',
    deniedTo: 'traveller',
  },
  {
    page: '/app/agency/[orgId]/settings',
    role: 'agencyAdmin',
    path: `${O}/settings`,
    mustShow: 'AI Connections for This Agency',
    deniedTo: 'traveller',
  },
  {
    page: '/app/agency/[orgId]/team',
    role: 'agencyAdmin',
    path: `${O}/team`,
    mustShow: 'ci.agency.admin@example.test',
    deniedTo: 'traveller',
  },
  {
    page: '/app/shared/[grantId]',
    role: 'agencyAdmin',
    path: '/app/shared/{grantId}',
    mustShow: 'Rumana Test Traveller',
    deniedTo: 'traveller',
  },
];

const STAFF =
  'Staff only: the made-up people are a traveller and an agency admin, not platform staff.';
const ONE_TIME = 'Opened only from a one-time invitation link; the seed makes no invitation.';

export const EXCLUDED: readonly ExcludedPage[] = [
  ...[
    '/app/admin',
    '/app/admin/access',
    '/app/admin/ai',
    '/app/admin/audit',
    '/app/admin/billing',
    '/app/admin/billing/travellers',
    '/app/admin/billing/travellers/metrics',
    '/app/admin/complaints',
    '/app/admin/document-protection',
    '/app/admin/email',
    '/app/admin/insights',
    '/app/admin/members',
    '/app/admin/organizations',
    '/app/admin/organizations/[orgId]',
    '/app/admin/packs',
    '/app/admin/packs/[packId]',
    '/app/admin/packs/[packId]/diff',
    '/app/admin/packs/corrections',
    '/app/admin/packs/import',
    '/app/admin/packs/sources',
    '/app/admin/plans',
    '/app/admin/privacy',
    '/app/admin/removals',
    '/app/admin/security',
    '/app/admin/settings',
    '/app/admin/sign-in-recovery',
    '/app/staff-code',
  ].map((page) => ({
    page,
    reason:
      page === '/app/admin'
        ? `${STAFF} Its readiness panel also uses the Neon HTTP driver, which the loopback bridge does not serve.`
        : STAFF,
  })),
  ...[
    '/app/client-invitations/accept',
    '/app/contributor-requests/accept',
    '/app/invitations/accept',
    '/app/sharing-invitations/accept',
    '/app/trip-invitations/accept',
    '/app/trip-invitations/[id]',
  ].map((page) => ({ page, reason: ONE_TIME })),
  { page: '/app/account/passkeys', reason: 'Switched off in this build (PASSKEYS is not on).' },
  {
    page: '/app/account/plan/billing',
    reason: 'Traveller plans are switched off and the traveller has no billing history.',
  },
  {
    page: '/app/agency/[orgId]/checklists/edit',
    reason: 'Opens one rule pack (?pack=); the seed adds no pack to the agency yet.',
  },
  ...[
    '/app/agency/[orgId]/collection',
    '/app/agency/[orgId]/collection/new',
    '/app/agency/[orgId]/collection/request',
  ].map((page) => ({ page, reason: 'Agency collection requests are switched off in this build.' })),
  {
    page: '/app/agency/[orgId]/plan/invoices/receipts/[receiptId]',
    reason: 'Needs a payment receipt; the seed makes no payment.',
  },
  {
    page: '/app/applicant/[id]/memory/compare',
    reason: 'Needs a saved snapshot; the seed makes none yet.',
  },
  {
    page: '/app/mission/[id]/snapshots/[snapshotId]',
    reason: 'Needs a saved snapshot; the seed makes none yet.',
  },
  { page: '/app/trips/[id]', reason: 'Needs a group trip; the seed makes none yet.' },
];

/**
 * Today's real findings (docs/upgrades/programme/wal/WAL1B-2-records.md). The guard requires each
 * to still fail exactly as listed, so a fix makes it say what to remove; scripts/ci-signed-in.test.mjs
 * pins the set, so the list only shrinks.
 */
export const KNOWN_FAILING: readonly KnownFailing[] = [
  {
    page: '/app/applicant/[id]/documents/add',
    check: 'covered control',
    sizes: ['phone 390', 'phone 400', 'desktop 1280'],
    controls: ['"Files to Import"', '"Folder to Import"'],
    finding:
      'The hidden file pickers (input.sr-only, 1 by 1 px) can be reached but have no drawn label tied to them.',
  },
  {
    page: '/app/applicant/[id]/profile',
    check: 'covered control',
    sizes: ['phone 390', 'phone 400', 'desktop 1280'],
    controls: ['"Photo File"'],
    finding:
      'The hidden photo picker (input.sr-only, 1 by 1 px) can be reached but has no drawn label tied to it.',
  },
  {
    page: '/app/applicant/[id]/record',
    check: 'covered control',
    sizes: ['phone 390', 'phone 400'],
    controls: ['"Everything', '"Profile Details', '"Previous Versions'],
    finding:
      'The Record Filters buttons are painted over by their own fieldset.record-hub-filter-set.',
  },
  {
    page: '/app/applicant/[id]/record',
    check: 'covered control',
    sizes: ['desktop 1280'],
    controls: ['"Everything', '"Previous Versions'],
    finding:
      'The Record Filters buttons are painted over by their own fieldset.record-hub-filter-set.',
  },
  {
    page: '/app/applicant/[id]/missions/prepare-again',
    check: 'covered control',
    sizes: ['phone 390', 'phone 400'],
    controls: ['"Create Case"'],
    finding:
      'Create Case, scrolled up from the bottom of the screen, sits under the phone bottom app bar (nav.app-shell-links, an icon svg); at 390 px this was its Notifications icon.',
  },
  {
    page: '/app/applicant/[id]/outputs',
    check: 'covered control',
    sizes: ['phone 390', 'phone 400'],
    controls: ['"Preview"'],
    finding:
      'Preview, scrolled up from the bottom of the screen, sits under the phone bottom app bar (nav.app-shell-links, an icon svg); at 390 px this was its Notifications icon.',
  },
  {
    page: '/app/mission/start',
    check: 'covered control',
    sizes: ['phone 390', 'phone 400'],
    controls: ['"Start Trip"'],
    finding:
      'Start Trip, scrolled up from the bottom of the screen, sits under the phone bottom app bar (nav.app-shell-links, an icon svg); at 390 px this was its Notifications icon.',
  },
  {
    page: '/app/agency/[orgId]/clients',
    check: 'covered control',
    sizes: ['phone 390', 'phone 400', 'desktop 1280'],
    controls: ['"Invite a Client"', '"Ask for a Document or Detail"'],
    finding:
      'The Invite a Client and Ask for a Document or Detail open rows (summary.lift-action) are painted over by their section.agency-add-part.',
  },
  {
    page: '/app/agency/[orgId]/activity',
    check: 'no control',
    sizes: ['phone 390', 'phone 400', 'desktop 1280'],
    controls: [],
    finding:
      'With no case notes yet the page body is a dead end: "No Case Activity Recorded" offers no control or link (only the agency banner back link).',
  },
  {
    page: '/app/agency/[orgId]/ai-connections',
    check: 'no control',
    sizes: ['phone 390', 'phone 400', 'desktop 1280'],
    controls: [],
    finding:
      'With no app connected the page body is a dead end: "No AI Apps Connected" says to turn it on in Settings but gives no link there.',
  },
];

/** The known finding for this page, check and size, if any. */
export function knownFinding(
  page: string,
  check: KnownFailing['check'],
  size: string,
): KnownFailing | undefined {
  return KNOWN_FAILING.find(
    (k) => k.page === page && k.check === check && (k.sizes as readonly string[]).includes(size),
  );
}

/**
 * Whether `path` opens `page`: route groups (`(home)`) take no part of the address and each
 * dynamic segment (`[id]`) is one segment. The query is ignored.
 */
export function pathOpensPage(page: string, path: string): boolean {
  const want = page
    .split('/')
    .filter((part) => part && !(part.startsWith('(') && part.endsWith(')')));
  const got = (path.split('?')[0] ?? '').split('/').filter(Boolean);
  if (want.length !== got.length) return false;
  return want.every((part, index) =>
    part.startsWith('[') ? (got[index] ?? '').length > 0 : part === got[index],
  );
}

/** The address to open for a route, with this run's ids. */
export function routePath(route: GuardRoute, ids: Readonly<Record<RouteId, string>>): string {
  return route.path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = ids[name as RouteId];
    if (!value) throw new Error(`No seeded id ${name} for ${route.page}`);
    return value;
  });
}
