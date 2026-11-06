/**
 * UMPE P13 parity map: every signed-in page and how a person reaches it once the traveller
 * navigation leads with My Documents, My Trips and Sharing & Requests (locked contract section 9,
 * annex F: "information-architecture priorities, not authorization to rename/delete old routes or
 * hide working features").
 *
 * Three ways in:
 * - `navigation`: a sidebar destination, a sidebar task, a More Tools entry or a Record section;
 * - `link`: a contextual link on another page, pinned by the source file and the text of the link
 *   target, so removing that link fails the parity test;
 * - `email`: an address sent to a person (an invitation), pinned the same way.
 *
 * `experience-parity.test.ts` lists every page under `app/app` and fails when a page is missing
 * here, when a navigation page is not offered, or when a pinned link is gone. Paths use the route
 * folder names, with `[id]`, `[orgId]` and the like as written on disk.
 */

export type ParityReach =
  | { readonly kind: 'navigation' }
  | { readonly kind: 'link'; readonly from: string; readonly contains: string }
  | { readonly kind: 'email'; readonly from: string; readonly contains: string };

const nav: ParityReach = { kind: 'navigation' };
const link = (from: string, contains: string): ParityReach => ({ kind: 'link', from, contains });

/** Source paths are relative to `apps/web/src`, or to the repository root when they start `packages/`. */
export const ROUTE_PARITY: Readonly<Record<string, ParityReach>> = {
  // Account-wide pages.
  '/app': nav,
  '/app/account': link('app/app/account-menu.tsx', "'/app/account'"),
  '/app/account/plan': link('components/upgrade-line.tsx', "'/app/account/plan'"),
  '/app/account/plan/billing': link('app/app/account/plan/page.tsx', '`${PLAN_PATH}/billing`'),
  '/app/account/whatsapp': link('app/app/account/page.tsx', '/app/account/whatsapp'),
  '/app/applicants': nav,
  '/app/countries': nav,
  '/app/countries/[iso2]': link('app/app/countries/(list)/page.tsx', '/app/countries/[code]'),
  '/app/help': link('app/app/account-menu.tsx', "'/app/help'"),
  '/app/notifications': nav,
  '/app/privacy': link('app/app/account-menu.tsx', "'/app/privacy'"),
  '/app/shared': nav,
  '/app/shared/[grantId]': link('app/app/shared/(list)/page.tsx', '/app/shared/${grant.id}'),
  '/app/staff-code': link('app/app/admin/page.tsx', '/app/staff-code'),
  // Invitations arrive by email; their accept pages have no menu entry by design.
  '/app/invitations/accept': {
    kind: 'email',
    from: 'app/invitation/accept-paths.ts',
    contains: "'/app/invitations/accept'",
  },
  '/app/client-invitations/accept': {
    kind: 'email',
    from: 'app/invitation/accept-paths.ts',
    contains: 'client-invitations/accept',
  },
  '/app/contributor-requests/accept': {
    kind: 'email',
    from: 'packages/services/src/invitation-email.ts',
    contains: 'contributor-requests/accept',
  },
  '/app/trip-invitations/accept': {
    kind: 'email',
    from: 'packages/services/src/invitation-email.ts',
    contains: 'trip-invitations/accept',
  },
  '/app/sharing-invitations/accept': {
    kind: 'email',
    from: 'app/invitation/accept-paths.ts',
    contains: 'sharing-invitations/accept',
  },

  // One traveller: Home and the three entry points, their tasks and More Tools.
  '/app/applicant/[id]': nav,
  '/app/applicant/[id]/documents': nav,
  '/app/applicant/[id]/documents/add': nav,
  '/app/applicant/[id]/review': link('app/app/applicant/[id]/page.tsx', '/review'),
  '/app/applicant/[id]/record': nav,
  '/app/applicant/[id]/profile': nav,
  '/app/applicant/[id]/expiry': nav,
  '/app/applicant/[id]/history': nav,
  '/app/applicant/[id]/missions': nav,
  '/app/applicant/[id]/sharing': nav,
  '/app/applicant/[id]/evidence': nav,
  '/app/applicant/[id]/calendar': link('app/app/(home)/page.tsx', '/calendar`'),
  '/app/applicant/[id]/insights': link(
    'app/app/applicant/[id]/documents/page.tsx',
    '/app/applicant/${id}/insights',
  ),
  '/app/applicant/[id]/memory': link(
    'app/app/applicant/[id]/missions/page.tsx',
    '/app/applicant/${id}/memory',
  ),
  '/app/applicant/[id]/memory/compare': link(
    'app/app/applicant/[id]/memory/memory-case-list.tsx',
    'memory/compare',
  ),
  '/app/applicant/[id]/missions/prepare-again': link(
    'app/app/mission/[id]/page.tsx',
    '/missions/prepare-again?from=',
  ),
  '/app/applicant/[id]/outputs': link(
    'app/app/applicant/[id]/missions/page.tsx',
    '/app/applicant/${id}/outputs',
  ),
  '/app/applicant/[id]/removal-records': link(
    'app/app/applicant/[id]/documents/page.tsx',
    '/app/applicant/${id}/removal-records',
  ),

  // Trips and cases.
  '/app/mission/start': nav,
  '/app/mission/[id]': link(
    'app/app/applicant/[id]/missions/page.tsx',
    '/app/mission/${mission.id}',
  ),
  '/app/mission/[id]/snapshots': link(
    'app/app/mission/[id]/case-rail.tsx',
    '/app/mission/${mission.id}/snapshots',
  ),
  '/app/mission/[id]/snapshots/[snapshotId]': link(
    'app/app/mission/[id]/case-rail.tsx',
    '/app/mission/${mission.id}/snapshots/${snap.id}',
  ),
  '/app/trips': nav,
  // UX6 package 4: the read-only page of a trip a person joined, reached from Trips You Joined.
  '/app/trip-invitations/[id]': link(
    'app/app/trips/(list)/page.tsx',
    '/app/trip-invitations/${trip.tripId}',
  ),
  '/app/trips/new': link('app/app/trips/(list)/page.tsx', '/app/trips/new'),
  '/app/trips/[id]': link('app/app/trips/(list)/page.tsx', '/app/trips/${trip.id}'),

  // Agencies (unchanged by P13).
  '/app/agency': link('app/app/account-menu.tsx', "'/app/agency'"),
  '/app/agency/[orgId]': nav,
  '/app/agency/[orgId]/activity': nav,
  '/app/agency/[orgId]/cases': nav,
  '/app/agency/[orgId]/clients': nav,
  '/app/agency/[orgId]/collection': nav,
  '/app/agency/[orgId]/checklists': nav,
  '/app/agency/[orgId]/countries': nav,
  '/app/agency/[orgId]/plan': nav,
  '/app/agency/[orgId]/settings': nav,
  '/app/agency/[orgId]/team': nav,
  '/app/agency/[orgId]/ai-connections': link(
    'app/app/agency/[orgId]/settings/page.tsx',
    '/ai-connections`',
  ),
  '/app/agency/[orgId]/collection/new': link(
    'app/app/agency/[orgId]/collection/page.tsx',
    '`${base}/new`',
  ),
  '/app/agency/[orgId]/collection/request': link(
    'app/app/agency/[orgId]/collection/page.tsx',
    '`${base}/request?id=',
  ),
  '/app/agency/[orgId]/checklists/edit': link(
    'app/app/agency/[orgId]/checklists/page.tsx',
    '/checklists/edit?pack=',
  ),
  '/app/agency/[orgId]/countries/[iso2]': link(
    'app/app/agency/[orgId]/countries/page.tsx',
    '/countries/[code]',
  ),
  '/app/agency/[orgId]/plan/invoices': link(
    'app/app/agency/[orgId]/plan/page.tsx',
    '/plan/invoices`',
  ),
  '/app/agency/[orgId]/plan/invoices/receipts/[receiptId]': link(
    'app/app/agency/[orgId]/plan/invoices/invoice-card.tsx',
    'receipts/',
  ),

  // Platform staff (unchanged by P13).
  '/app/admin': nav,
  '/app/admin/access': nav,
  '/app/admin/ai': nav,
  '/app/admin/audit': nav,
  '/app/admin/complaints': nav,
  '/app/admin/insights': nav,
  '/app/admin/members': nav,
  '/app/admin/organizations': nav,
  '/app/admin/packs': nav,
  '/app/admin/packs/import': link('app/app/admin/packs/page.tsx', '/app/admin/packs/import'),
  '/app/admin/privacy': nav,
  '/app/admin/removals': nav,
  '/app/admin/security': nav,
  '/app/admin/settings': nav,
  '/app/admin/billing': link('app/app/admin/settings/page.tsx', '/app/admin/billing'),
  '/app/admin/billing/travellers': link(
    'app/app/admin/settings/page.tsx',
    '/app/admin/billing/travellers',
  ),
  '/app/admin/billing/travellers/metrics': link(
    'app/app/admin/billing/travellers/page.tsx',
    '/metrics',
  ),
  '/app/admin/document-protection': link(
    'app/app/admin/settings/page.tsx',
    '/app/admin/document-protection',
  ),
  '/app/admin/email': link('app/app/admin/page.tsx', '/app/admin/email'),
  '/app/admin/organizations/[orgId]': link(
    'app/app/admin/organizations/page.tsx',
    '/app/admin/organizations/${org.id}',
  ),
  '/app/admin/packs/[packId]': link('app/app/admin/packs/page.tsx', '/app/admin/packs/${pack.id}'),
  '/app/admin/packs/[packId]/diff': link('app/app/admin/packs/[packId]/page.tsx', '/diff`'),
  '/app/admin/packs/corrections': link(
    'app/app/admin/packs/page.tsx',
    '/app/admin/packs/corrections',
  ),
  '/app/admin/packs/sources': link('app/app/admin/packs/page.tsx', '/app/admin/packs/sources'),
  '/app/admin/plans': link('app/app/admin/settings/page.tsx', '/app/admin/plans'),
  '/app/admin/sign-in-recovery': link(
    'app/app/admin/security/page.tsx',
    '/app/admin/sign-in-recovery',
  ),
};

/**
 * Pages outside `app/app` that the traveller navigation now offers (UMPE P13). They are listed so
 * the parity test proves the navigation still reaches them.
 */
export const OUTSIDE_APP_NAVIGATION: readonly string[] = ['/collect/account/answers'];
