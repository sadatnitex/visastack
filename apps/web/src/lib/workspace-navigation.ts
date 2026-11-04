import type { NavLink } from './navigation';

export interface TravellerContext {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  /** The traveller's profile photo address, when they have one and the viewer may see it (WP-PH1). */
  readonly photo?: string | null;
}

export interface AgencyContext {
  readonly id: string;
  readonly name: string;
  readonly admin: boolean;
  /**
   * AGENCY_COLLECTION_REQUESTS on and the member may send requests: an owner or admin (UMPE P6) or
   * a member an admin gave May Request Documents (UMPE G3). The page itself checks again.
   */
  readonly collectionRequests?: boolean;
}

export interface WorkspaceAccess {
  /** The travellers in everyday use: the ones the switcher offers. */
  readonly travellers: readonly TravellerContext[];
  /**
   * Archived travellers (LC-E). Never offered in the switcher, but a page of one opened by link
   * keeps its frame and tabs. A traveller in Recently Deleted is in neither list.
   */
  readonly archivedTravellers?: readonly TravellerContext[];
  readonly agencies: readonly AgencyContext[];
  readonly platform: null | {
    readonly owner: boolean;
    readonly ai: boolean;
    readonly complaints: boolean;
    readonly audit: boolean;
    readonly privacy: boolean;
    /** Privacy access and DOCUMENT_REMOVAL_REQUESTS on: the Removal Requests queue (lifecycle lane D). */
    readonly removals?: boolean;
    /** FEEDBACK_VIEW: the Field Insights page (UMPE P12). */
    readonly insights?: boolean;
    /** PROCESSING_JOB_RETRY: the Email Delivery page. */
    readonly email?: boolean;
    /** DOCUMENT_PROTECTION_MANAGE: the Document Protection page. */
    readonly protection?: boolean;
    /** ACCOUNT_SIGN_IN_RECOVERY: the Sign-In Recovery page. */
    readonly recovery?: boolean;
  };
}

export interface WorkspaceNavigation {
  readonly kind: 'personal' | 'agency' | 'platform' | 'unavailable';
  readonly name: string;
  readonly caption: string;
  /** The current traveller's photo, shown in place of their initials (WP-PH1). */
  readonly photo?: string;
  readonly primary: readonly NavLink[];
  readonly tools: readonly NavLink[];
  /** Platform only: the Billing and Plans group, each link only for the role that can open it. */
  readonly billing?: readonly NavLink[];
  readonly settings: readonly NavLink[];
}

const settings: readonly NavLink[] = [];

/** The sections that make up a person's Record. Each is an existing page; none is new except the hub. */
export function recordSections(applicantId: string): readonly NavLink[] {
  const base = `/app/applicant/${applicantId}`;
  return [
    { href: `${base}/record`, label: 'All Records', exact: true },
    { href: `${base}/profile`, label: 'My Profile' },
    { href: `${base}/documents`, label: 'Documents' },
    { href: `${base}/expiry`, label: 'Dates & Expiry' },
    { href: `${base}/history`, label: 'History' },
  ];
}

/**
 * Navigation describes only the current server-authorized context list; it grants no access.
 *
 * On a case page the traveller is only ever the one known to own that case: the one the case
 * layout reported after its own owner check (`caseSubject`; the frame remembers each case's report
 * for the visit, so going back to a case shows its traveller at once). Until a case has reported,
 * or when it never does (a case that is not this account's), the sidebar shows a neutral case
 * state with no traveller's links, never a guess (owner list item 2).
 */
export function workspaceNavigation(
  pathname: string,
  access: WorkspaceAccess,
  caseSubject?: { readonly route: string; readonly applicantId: string } | null,
): WorkspaceNavigation {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[1] === 'admin') {
    if (!access.platform) return unavailable('Platform Access Unavailable');
    return {
      kind: 'platform',
      name: 'VisaStack',
      caption: 'Platform Operations',
      primary: [
        { href: '/app/admin', label: 'Overview', exact: true },
        ...(access.platform.owner ? [{ href: '/app/admin/members', label: 'Members' }] : []),
        { href: '/app/admin/organizations', label: 'Organizations' },
        ...(access.platform.audit ? [{ href: '/app/admin/audit', label: 'Activity' }] : []),
        { href: '/app/admin#admin-provider-operations', label: 'Providers', exact: true },
        // The owner reaches the plans themselves; everyone else sees the storage and AI spend.
        access.platform.owner
          ? { href: '/app/admin/plans', label: 'Costs & Plans' }
          : { href: '/app/admin#admin-usage', label: 'Costs & Plans', exact: true },
        { href: '/app/admin/security', label: 'Security' },
      ],
      tools: [
        { href: '/app/admin/packs', label: 'Rules & Packs' },
        ...(access.platform.ai ? [{ href: '/app/admin/ai', label: 'AI Settings' }] : []),
        ...(access.platform.privacy
          ? [{ href: '/app/admin/privacy', label: 'Privacy Operations' }]
          : []),
        ...(access.platform.removals === true
          ? [{ href: '/app/admin/removals', label: 'Removal Requests' }]
          : []),
        ...(access.platform.insights === true
          ? [{ href: '/app/admin/insights', label: 'Field Insights' }]
          : []),
        { href: '/app/admin/access', label: 'Platform Access' },
        ...(access.platform.complaints
          ? [{ href: '/app/admin/complaints', label: 'Complaints' }]
          : []),
      ],
      billing: [
        ...(access.platform.owner ? [{ href: '/app/admin/billing', label: 'Billing' }] : []),
        ...(access.platform.email === true
          ? [{ href: '/app/admin/email', label: 'Email Delivery' }]
          : []),
        ...(access.platform.protection === true
          ? [{ href: '/app/admin/document-protection', label: 'Document Protection' }]
          : []),
        ...(access.platform.recovery === true
          ? [{ href: '/app/admin/sign-in-recovery', label: 'Sign-In Recovery' }]
          : []),
      ],
      settings: [{ href: '/app/admin/settings', label: 'Platform Settings' }],
    };
  }

  if (segments[1] === 'agency' && segments[2]) {
    const agency = access.agencies.find((item) => item.id === segments[2]);
    if (!agency) return unavailable('Agency Access Unavailable');
    const base = `/app/agency/${agency.id}`;
    return {
      kind: 'agency',
      name: agency.name,
      caption: 'Agency Workspace',
      primary: [
        { href: base, label: 'Overview', exact: true },
        ...(agency.admin ? [{ href: `${base}/clients`, label: 'Clients', exact: true }] : []),
        { href: `${base}/cases`, label: 'Cases' },
        ...(agency.admin
          ? [
              {
                href: `${base}/clients#agency-evidence-requests`,
                label: 'Evidence Requests',
                exact: true,
              },
            ]
          : []),
        ...(agency.collectionRequests === true
          ? [{ href: `${base}/collection`, label: 'Document Requests' }]
          : []),
        ...(agency.admin ? [{ href: `${base}/team`, label: 'Team' }] : []),
        { href: `${base}/activity`, label: 'Case Activity' },
        { href: `${base}/countries`, label: 'Countries' },
      ],
      tools: [{ href: `${base}/plan`, label: 'Plan & Usage' }],
      settings: [...(agency.admin ? [{ href: `${base}/settings`, label: 'Agency Settings' }] : [])],
    };
  }

  const casePath = segments[1] === 'mission';
  const subjectId =
    segments[1] === 'applicant'
      ? segments[2]
      : casePath &&
          caseSubject &&
          (pathname === caseSubject.route || pathname.startsWith(`${caseSubject.route}/`))
        ? caseSubject.applicantId
        : undefined;
  const person = subjectId
    ? (access.travellers.find((item) => item.id === subjectId) ??
      access.archivedTravellers?.find((item) => item.id === subjectId))
    : !casePath
      ? (access.travellers.find((item) => item.relationship === 'SELF') ??
        (access.travellers.length === 1 ? access.travellers[0] : undefined))
      : undefined;

  if (segments[1] === 'applicant' && !person) return unavailable('Traveller Access Unavailable');
  const base = person ? `/app/applicant/${person.id}` : null;
  return {
    kind: 'personal',
    name: person?.name ?? (casePath ? 'Visa Case' : 'Personal Space'),
    ...(person?.photo ? { photo: person.photo } : {}),
    caption:
      person?.relationship === 'SELF'
        ? 'Personal Space'
        : person
          ? 'Managed Traveller'
          : // A case whose traveller is not known yet: a caption that names no owner.
            casePath
            ? 'Case Workspace'
            : 'Choose a Traveller',
    primary: person ? travellerEntryPoints(person.id) : accountPrimary(access, casePath),
    tools: base ? travellerTools(base) : ACCOUNT_TOOLS,
    settings,
  };
}

/**
 * The traveller's three entry points (UMPE P13, locked contract section 9 and annex F): My
 * Documents, My Trips and Sharing & Requests, after Home. Each opens an existing page and lights
 * up on the pages that belong to it, so Record, Cases and Evidence Requests keep their addresses.
 * On a phone the bar holds the first four; Notifications and Countries sit under More.
 */
export function travellerEntryPoints(applicantId: string): readonly NavLink[] {
  const base = `/app/applicant/${applicantId}`;
  return [
    { href: base, label: 'Home', exact: true },
    {
      href: `${base}/documents`,
      label: MY_DOCUMENTS,
      // The Record hub and its sections (WP-V3 part 2) are where documents grow into a profile.
      alsoCurrentFor: recordSections(applicantId).map((section) => section.href),
      action: { href: `${base}/documents/add`, label: 'Add Documents' },
    },
    {
      href: `${base}/missions`,
      label: MY_TRIPS,
      // Case pages, Start a Trip and Group Trips all live outside the traveller's own path.
      alsoCurrentFor: ['/app/mission/', '/app/trips'],
      action: { href: '/app/mission/start', label: 'Start a Trip' },
    },
    {
      href: `${base}/sharing`,
      label: SHARING_AND_REQUESTS,
      alsoCurrentFor: [`${base}/evidence`, '/app/shared'],
    },
    { href: '/app/notifications', label: 'Notifications' },
    { href: '/app/countries', label: 'Countries' },
  ];
}

/** The entry point names, one spelling for the navigation, Home and the tests. */
export const MY_DOCUMENTS = 'My Documents';
export const MY_TRIPS = 'My Trips';
export const SHARING_AND_REQUESTS = 'Sharing & Requests';

/**
 * Everything the entry points do not name, one step away under More Tools. Every one of these
 * was a tab or tool before P13 or had no menu entry at all (Group Trips, Answers to Agencies).
 */
function travellerTools(base: string): readonly NavLink[] {
  return [
    { href: `${base}/record`, label: 'Record' },
    { href: `${base}/evidence`, label: 'Evidence Requests' },
    ...ACCOUNT_TOOLS,
    // The account-wide page has its own name, Account Overview, so it is never mistaken for a
    // traveller's Home (owner list item 11). With no traveller it is already a tab.
    { href: '/app', label: 'Account Overview', exact: true },
  ];
}

/** Account-wide pages that need no chosen traveller. */
const ACCOUNT_TOOLS: readonly NavLink[] = [
  { href: '/app/trips', label: 'Group Trips' },
  { href: '/collect/account/answers', label: 'Answers to Agencies' },
  { href: '/app/shared', label: 'Shared with Me' },
];

/** With no traveller chosen (or a case whose traveller is not known yet): the account's own tabs. */
function accountPrimary(access: WorkspaceAccess, casePath: boolean): readonly NavLink[] {
  return [
    // The account-wide page is the Account Overview, not a second Home (owner list item 11).
    { href: '/app', label: 'Account Overview', exact: true },
    {
      href: '/app/applicants',
      label: casePath
        ? 'All Travellers'
        : access.travellers.length
          ? 'Choose a Traveller'
          : 'Add a Traveller',
    },
    { href: '/app/notifications', label: 'Notifications' },
    { href: '/app/countries', label: 'Countries' },
  ];
}

function unavailable(name: string): WorkspaceNavigation {
  return {
    kind: 'unavailable',
    name,
    caption: 'Choose an Available Workspace',
    primary: [],
    tools: [],
    settings,
  };
}
