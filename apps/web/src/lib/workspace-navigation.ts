import type { NavLink } from './navigation';

export interface TravellerContext {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
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
  };
}

export interface WorkspaceNavigation {
  readonly kind: 'personal' | 'agency' | 'platform' | 'unavailable';
  readonly name: string;
  readonly caption: string;
  readonly primary: readonly NavLink[];
  readonly tools: readonly NavLink[];
  readonly settings: readonly NavLink[];
}

const settings: readonly NavLink[] = [];

/** Navigation describes only the current server-authorized context list; it grants no access. */
export function workspaceNavigation(
  pathname: string,
  access: WorkspaceAccess,
  caseSubject?: { readonly route: string; readonly applicantId: string } | null,
): WorkspaceNavigation {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[1] === 'admin') {
    if (!access.platform) return unavailable('Platform access unavailable');
    return {
      kind: 'platform',
      name: 'VisaStack',
      caption: 'Platform operations',
      primary: [
        { href: '/app/admin', label: 'Overview', exact: true },
        ...(access.platform.owner ? [{ href: '/app/admin/members', label: 'Members' }] : []),
        { href: '/app/admin/organizations', label: 'Organizations' },
        { href: '/app/admin/audit', label: 'Activity' },
        { href: '/app/admin#admin-provider-operations', label: 'Providers', exact: true },
        { href: '/app/admin#admin-usage', label: 'Costs & plans', exact: true },
        { href: '/app/admin/security', label: 'Security' },
      ],
      tools: [
        { href: '/app/admin/packs', label: 'Rules & packs' },
        ...(access.platform.ai ? [{ href: '/app/admin/ai-settings', label: 'AI settings' }] : []),
        { href: '/app/admin/privacy', label: 'Privacy operations' },
        { href: '/app/admin/access', label: 'Platform access' },
        ...(access.platform.complaints
          ? [{ href: '/app/admin/complaints', label: 'Complaints' }]
          : []),
      ],
      settings: [{ href: '/app/admin/settings', label: 'Platform settings' }],
    };
  }

  if (segments[1] === 'agency' && segments[2]) {
    const agency = access.agencies.find((item) => item.id === segments[2]);
    if (!agency) return unavailable('Agency access unavailable');
    const base = `/app/agency/${agency.id}`;
    return {
      kind: 'agency',
      name: agency.name,
      caption: 'Agency workspace',
      primary: [
        { href: base, label: 'Overview', exact: true },
        ...(agency.admin ? [{ href: `${base}/clients`, label: 'Clients', exact: true }] : []),
        { href: `${base}/cases`, label: 'Cases' },
        ...(agency.admin
          ? [
              {
                href: `${base}/clients#agency-evidence-requests`,
                label: 'Evidence requests',
                exact: true,
              },
            ]
          : []),
        ...(agency.admin ? [{ href: `${base}/team`, label: 'Team' }] : []),
        { href: `${base}/activity`, label: 'Case activity' },
      ],
      tools: [{ href: `${base}/plan`, label: 'Plan & usage' }],
      settings: [...(agency.admin ? [{ href: `${base}/settings`, label: 'Agency settings' }] : [])],
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
      : undefined;

  if (segments[1] === 'applicant' && !person) return unavailable('Traveller access unavailable');
  const base = person ? `/app/applicant/${person.id}` : null;
  return {
    kind: 'personal',
    name: person?.name ?? (casePath ? 'Visa case' : 'Personal space'),
    caption:
      person?.relationship === 'SELF'
        ? 'Personal space'
        : person
          ? 'Managed traveller'
          : 'Choose a traveller',
    primary: base
      ? [
          { href: base, label: 'Overview', exact: true, alsoExactFor: ['/app'] },
          { href: `${base}/profile`, label: 'My profile' },
          { href: `${base}/documents`, label: 'Documents' },
          { href: `${base}/missions`, label: 'Visa cases', alsoCurrentFor: ['/app/mission/'] },
          { href: `${base}/sharing`, label: 'Sharing' },
          { href: '/app/notifications', label: 'Notifications' },
        ]
      : [
          { href: '/app', label: 'Overview', exact: true },
          {
            href: '/app/applicants',
            label: access.travellers.length ? 'Choose a traveller' : 'Add a traveller',
          },
          { href: '/app/notifications', label: 'Notifications' },
        ],
    tools: [
      { href: '/app/applicants', label: 'All travellers' },
      { href: '/app/shared', label: 'Shared with me' },
      { href: '/app', label: 'Account overview', exact: true },
      ...(base
        ? [
            { href: `${base}/evidence`, label: 'Evidence requests' },
            { href: `${base}/expiry`, label: 'Dates & expiry' },
            { href: `${base}/history`, label: 'History' },
          ]
        : []),
    ],
    settings,
  };
}

function unavailable(name: string): WorkspaceNavigation {
  return {
    kind: 'unavailable',
    name,
    caption: 'Choose an available workspace',
    primary: [],
    tools: [],
    settings,
  };
}
