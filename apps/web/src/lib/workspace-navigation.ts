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
}

export interface WorkspaceAccess {
  readonly travellers: readonly TravellerContext[];
  readonly agencies: readonly AgencyContext[];
  readonly platform: null | {
    readonly owner: boolean;
    readonly ai: boolean;
    readonly complaints: boolean;
    readonly audit: boolean;
    readonly privacy: boolean;
  };
}

export interface WorkspaceNavigation {
  readonly kind: 'personal' | 'agency' | 'platform' | 'unavailable';
  readonly name: string;
  readonly caption: string;
  /** The current traveller's photo, shown in place of their initials (WP-PH1). */
  readonly photo?: string;
  /** The traveller this navigation is for, when it is for one. */
  readonly travellerId?: string;
  readonly primary: readonly NavLink[];
  readonly tools: readonly NavLink[];
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
 * On a case page the traveller is the one the case layout reported after its own owner check
 * (`caseSubject`). Until that report arrives (the case is still loading, or the page's scripts have
 * not run yet) the sidebar keeps the traveller that was selected before (`previousTravellerId`),
 * or the only traveller when there is just one, instead of dropping to "Choose a Traveller"
 * (owner list item 2). Either way the person must be in the owner's own traveller list, and the
 * layout's report replaces the guess as soon as it comes.
 */
export function workspaceNavigation(
  pathname: string,
  access: WorkspaceAccess,
  caseSubject?: { readonly route: string; readonly applicantId: string } | null,
  previousTravellerId?: string | null,
): WorkspaceNavigation {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[1] === 'admin') {
    if (!access.platform) return unavailable('Platform access unavailable');
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
        { href: '/app/admin#admin-usage', label: 'Costs & Plans', exact: true },
        { href: '/app/admin/security', label: 'Security' },
      ],
      tools: [
        { href: '/app/admin/packs', label: 'Rules & Packs' },
        ...(access.platform.ai ? [{ href: '/app/admin/ai-settings', label: 'AI Settings' }] : []),
        ...(access.platform.privacy
          ? [{ href: '/app/admin/privacy', label: 'Privacy Operations' }]
          : []),
        { href: '/app/admin/access', label: 'Platform Access' },
        ...(access.platform.complaints
          ? [{ href: '/app/admin/complaints', label: 'Complaints' }]
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
    ? access.travellers.find((item) => item.id === subjectId)
    : !casePath
      ? (access.travellers.find((item) => item.relationship === 'SELF') ??
        (access.travellers.length === 1 ? access.travellers[0] : undefined))
      : ((previousTravellerId
          ? access.travellers.find((item) => item.id === previousTravellerId)
          : undefined) ?? (access.travellers.length === 1 ? access.travellers[0] : undefined));

  if (segments[1] === 'applicant' && !person) return unavailable('Traveller Access Unavailable');
  const base = person ? `/app/applicant/${person.id}` : null;
  // The Record tab stays lit on every one of its sections (all but the hub itself).
  const recordPages = person
    ? recordSections(person.id)
        .slice(1)
        .map((section) => section.href)
    : [];
  return {
    kind: 'personal',
    name: person?.name ?? (casePath ? 'Visa Case' : 'Personal Space'),
    ...(person?.photo ? { photo: person.photo } : {}),
    ...(person ? { travellerId: person.id } : {}),
    caption:
      person?.relationship === 'SELF'
        ? 'Personal Space'
        : person
          ? 'Managed Traveller'
          : 'Choose a Traveller',
    // Four tabs (WP-V3 part 2): Home, Record, Cases, Sharing. Notifications and Countries follow,
    // so on a phone they sit under More. Profile, Documents, Dates & Expiry and History are
    // sections of Record: their pages keep their addresses and light up the Record tab.
    primary: base
      ? [
          { href: base, label: 'Home', exact: true, alsoExactFor: ['/app'] },
          {
            href: `${base}/record`,
            label: 'Record',
            alsoCurrentFor: recordPages,
          },
          { href: `${base}/missions`, label: 'Cases', alsoCurrentFor: ['/app/mission/'] },
          { href: `${base}/sharing`, label: 'Sharing' },
          { href: '/app/notifications', label: 'Notifications' },
          { href: '/app/countries', label: 'Countries' },
        ]
      : [
          { href: '/app', label: 'Home', exact: true },
          {
            href: '/app/applicants',
            label: access.travellers.length ? 'Choose a Traveller' : 'Add a Traveller',
          },
          { href: '/app/notifications', label: 'Notifications' },
          { href: '/app/countries', label: 'Countries' },
        ],
    tools: [
      { href: '/app/shared', label: 'Shared with Me' },
      // The account page is also Home's page, so this opens its permissions section; only one
      // link (Home) is ever current on /app.
      { href: '/app#permissions', label: 'Account and Permissions' },
      ...(base ? [{ href: `${base}/evidence`, label: 'Evidence Requests' }] : []),
    ],
    settings,
  };
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
