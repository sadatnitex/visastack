import { describe, expect, it } from 'vitest';
import { type NavLink, isCurrentPath } from './navigation';
import { type WorkspaceAccess, recordSections, workspaceNavigation } from './workspace-navigation';

const p1 = '10000000-0000-4000-8000-000000000001';
const p2 = '10000000-0000-4000-8000-000000000002';
const o1 = '20000000-0000-4000-8000-000000000001';
const o2 = '20000000-0000-4000-8000-000000000002';
const m1 = '30000000-0000-4000-8000-000000000001';
const access: WorkspaceAccess = {
  travellers: [
    { id: p1, name: 'Synthetic Self', relationship: 'SELF' },
    { id: p2, name: 'Synthetic Family', relationship: 'MINOR_GUARDIAN' },
  ],
  agencies: [
    { id: o1, name: 'Synthetic Agency One', admin: true },
    { id: o2, name: 'Synthetic Agency Two', admin: false },
  ],
  platform: { owner: true, ai: true, complaints: true, audit: true, privacy: true },
};
const labels = (path: string, actor = access) =>
  workspaceNavigation(path, actor).primary.map((link) => link.label);

describe('current contextual navigation contract', () => {
  it('uses the selected owned traveller for Home and the three entry points, then notifications and the country rules', () => {
    const nav = workspaceNavigation(`/app/applicant/${p2}/profile`, access);
    expect(nav.name).toBe('Synthetic Family');
    expect(nav.caption).toBe('Managed Traveller');
    expect(nav.primary.map((link) => link.label)).toEqual([
      'Home',
      'My Documents',
      'My Trips',
      'Sharing & Requests',
      'Notifications',
      'Countries',
    ]);
    expect(nav.primary.at(-1)).toEqual({ href: '/app/countries', label: 'Countries' });
    expect(
      nav.primary.slice(0, 4).every((link) => link.href.startsWith(`/app/applicant/${p2}`)),
    ).toBe(true);
    // The task under My Documents opens this traveller's own upload, never another's.
    expect(nav.primary[1]?.action).toEqual({
      href: `/app/applicant/${p2}/documents/add`,
      label: 'Add Documents',
    });
    expect([...nav.primary, ...nav.tools, ...nav.settings].map((link) => link.href)).not.toContain(
      '/app/privacy',
    );
    expect(nav.tools.map((link) => link.label)).toEqual(
      expect.arrayContaining(['Record', 'Shared with Me', 'Account Overview', 'Evidence Requests']),
    );
  });
  it('offers the country rules even before a traveller exists, and marks them current on their own pages', () => {
    const nav = workspaceNavigation('/app/countries/gb', {
      travellers: [],
      agencies: [],
      platform: null,
    });
    const link = nav.primary.find((item) => item.label === 'Countries');
    expect(link).toEqual({ href: '/app/countries', label: 'Countries' });
    if (!link) throw new Error('fixture');
    expect(isCurrentPath('/app/countries/gb', link)).toBe(true);
    expect(isCurrentPath('/app/countries', link)).toBe(true);
    expect(isCurrentPath('/app/privacy', link)).toBe(false);
  });
  it('keeps first-person creation and agency entry available without fabricated records', () => {
    const nav = workspaceNavigation('/app', { travellers: [], agencies: [], platform: null });
    expect(nav.primary).toContainEqual({ href: '/app/applicants', label: 'Add a Traveller' });
    expect(nav.primary.some((link) => link.href.includes('undefined'))).toBe(false);
  });
  it('never selects a stale or unauthorized traveller or organization', () => {
    expect(workspaceNavigation('/app/applicant/unknown/profile', access).kind).toBe('unavailable');
    expect(workspaceNavigation('/app/agency/unknown/cases', access).primary).toEqual([]);
  });
  it('keeps agency destinations scoped to the selected organization', () => {
    const nav = workspaceNavigation(`/app/agency/${o1}/cases`, access);
    expect(nav.primary.map((link) => link.label)).toEqual([
      'Overview',
      'Clients',
      'Cases',
      'Evidence Requests',
      'Team',
      'Case Activity',
      'Countries',
    ]);
    // The country rules open inside the agency workspace, so the sidebar does not switch to the personal space.
    expect(nav.primary.at(-1)).toEqual({ href: `/app/agency/${o1}/countries`, label: 'Countries' });
    expect(nav.primary.every((link) => link.href.startsWith(`/app/agency/${o1}`))).toBe(true);
    expect(nav.tools).toContainEqual({ href: `/app/agency/${o1}/plan`, label: 'Plan & Usage' });
  });
  it('offers Document Requests only where the chrome marked the member as a requester (UMPE P6, G3)', () => {
    const at = `/app/agency/${o1}`;
    expect(labels(at)).not.toContain('Document Requests');
    const on = (admin: boolean): WorkspaceAccess => ({
      ...access,
      agencies: [{ id: o1, name: 'Synthetic Agency One', admin, collectionRequests: true }],
    });
    const link = workspaceNavigation(at, on(true)).primary.find(
      (item) => item.label === 'Document Requests',
    );
    expect(link?.href).toBe(`/app/agency/${o1}/collection`);
    // A member with May Request Documents (G3): the chrome sets the mark, the page checks again.
    expect(labels(at, on(false))).toContain('Document Requests');
    // A worker without the mark never sees it, whatever the role flag says.
    const unmarked: WorkspaceAccess = {
      ...access,
      agencies: [{ id: o1, name: 'Synthetic Agency One', admin: true }],
    };
    expect(labels(at, unmarked)).not.toContain('Document Requests');
  });

  it('does not offer administrator-only agency actions to a case worker', () => {
    const nav = workspaceNavigation(`/app/agency/${o2}/cases`, access);
    expect(nav.primary.map((link) => link.label)).toEqual([
      'Overview',
      'Cases',
      'Case Activity',
      'Countries',
    ]);
    expect(nav.settings.some((link) => link.label === 'Settings')).toBe(false);
  });
  it('offers real platform categories and preserves specialized tools', () => {
    expect(labels('/app/admin')).toEqual([
      'Overview',
      'Members',
      'Organizations',
      'Activity',
      'Providers',
      'Costs & Plans',
      'Security',
    ]);
    expect(workspaceNavigation('/app/admin', access).tools.map((link) => link.label)).toEqual([
      'Rules & Packs',
      'AI Settings',
      'Privacy Operations',
      'Platform Access',
      'Complaints',
    ]);
  });
  it('shows Field Insights only with the feedback permission (UMPE P12)', () => {
    const tools = (insights: boolean | undefined) =>
      workspaceNavigation('/app/admin', {
        ...access,
        platform: {
          owner: true,
          ai: true,
          complaints: true,
          audit: true,
          privacy: true,
          ...(insights === undefined ? {} : { insights }),
        },
      }).tools.map((link) => [link.label, link.href]);
    expect(tools(undefined).map(([label]) => label)).not.toContain('Field Insights');
    expect(tools(false).map(([label]) => label)).not.toContain('Field Insights');
    expect(tools(true)).toContainEqual(['Field Insights', '/app/admin/insights']);
  });
  it('shows Removal Requests after Privacy Operations only when the removal flag is on', () => {
    const tools = (removals: boolean | undefined) =>
      workspaceNavigation('/app/admin', {
        ...access,
        platform: {
          owner: true,
          ai: true,
          complaints: true,
          audit: true,
          privacy: true,
          ...(removals === undefined ? {} : { removals }),
        },
      }).tools.map((link) => [link.label, link.href]);
    expect(tools(undefined).map(([label]) => label)).not.toContain('Removal Requests');
    expect(tools(false).map(([label]) => label)).not.toContain('Removal Requests');
    const on = tools(true);
    const at = on.findIndex(([label]) => label === 'Privacy Operations');
    expect(on[at + 1]).toEqual(['Removal Requests', '/app/admin/removals']);
  });
  it('hides the private account directory and restricted configuration for limited platform staff', () => {
    const limited = {
      ...access,
      platform: { owner: false, ai: false, complaints: false, audit: false, privacy: false },
    };
    expect(labels('/app/admin', limited)).not.toContain('Members');
    const tools = workspaceNavigation('/app/admin', limited).tools.map((link) => link.label);
    expect(tools).not.toContain('AI Settings');
    expect(tools).not.toContain('Complaints');
    expect(workspaceNavigation('/app/admin', { ...access, platform: null }).kind).toBe(
      'unavailable',
    );
  });
  it('keeps a real case and its snapshots tied to the authorized subject, not the default self', () => {
    const subject = { route: `/app/mission/${m1}`, applicantId: p2 };
    const path = `${subject.route}/snapshots/synthetic`;
    const nav = workspaceNavigation(path, access, subject);
    expect(nav.name).toBe('Synthetic Family');
    expect(
      nav.primary.filter((link) => isCurrentPath(path, link)).map((link) => link.label),
    ).toEqual(['My Trips']);
    expect(workspaceNavigation('/app/mission/another-case', access, subject).name).toBe(
      'Visa Case',
    );
  });
  it('never guesses the traveller on a case page before the case reports its own (owner item 2)', () => {
    // No report yet (still loading, or a case that is not this account's): a neutral case state,
    // with no traveller's links and no request to choose one.
    const loading = workspaceNavigation(`/app/mission/${m1}`, access, null);
    expect(loading.name).toBe('Visa Case');
    expect(loading.caption).toBe('Case Workspace');
    const labels = loading.primary.map((link) => link.label);
    expect(labels).not.toContain('Choose a Traveller');
    expect(labels).toContain('All Travellers');
    expect(loading.primary.some((link) => link.href.startsWith('/app/applicant/'))).toBe(false);
    // Even with a single traveller nothing is assumed: the case may not be theirs.
    const family = access.travellers[1];
    if (!family) throw new Error('fixture');
    const single: WorkspaceAccess = { ...access, travellers: [family] };
    expect(workspaceNavigation(`/app/mission/${m1}`, single).name).toBe('Visa Case');
    // Another case's report never stands in for this one.
    const otherCase = workspaceNavigation(`/app/mission/${m1}`, access, {
      route: '/app/mission/another-case',
      applicantId: p2,
    });
    expect(otherCase.name).toBe('Visa Case');
  });
  it("shows the case's own traveller as soon as the case reports it, on every page of the case", () => {
    const subject = { route: `/app/mission/${m1}`, applicantId: p1 };
    expect(workspaceNavigation(`/app/mission/${m1}`, access, subject).name).toBe('Synthetic Self');
    const sub = workspaceNavigation(`/app/mission/${m1}/snapshots/s1`, access, subject);
    expect(sub.name).toBe('Synthetic Self');
    expect(sub.primary.map((link) => link.href)).toContain(`/app/applicant/${p1}/missions`);
  });
  it('never shows a reported traveller outside the owner-authorized list', () => {
    const nav = workspaceNavigation(`/app/mission/${m1}`, access, {
      route: `/app/mission/${m1}`,
      applicantId: 'unknown',
    });
    expect(nav.name).toBe('Visa Case');
  });
  it('does not accept a subject outside the existing owner-authorized context list', () => {
    const nav = workspaceNavigation(`/app/mission/${m1}`, access, {
      route: `/app/mission/${m1}`,
      applicantId: 'unknown',
    });
    expect(nav.primary.some((link) => link.href.includes('unknown'))).toBe(false);
  });
  it('highlights nested pages once, preserves ordinary deep-link fragments and exact section destinations', () => {
    const path = `/app/applicant/${p1}/documents#review`;
    const nav = workspaceNavigation(path, access);
    expect(
      nav.primary.filter((link) => isCurrentPath(path, link)).map((link) => link.label),
    ).toEqual(['My Documents']);
    const providers = workspaceNavigation('/app/admin', access).primary.find(
      (link) => link.label === 'Providers',
    );
    expect(providers && isCurrentPath('/app/admin#admin-provider-operations', providers)).toBe(
      true,
    );
    expect(providers && isCurrentPath('/app/admin', providers)).toBe(false);
  });
});

/*
 * Characterization of every link the workspace navigation offers, label and destination,
 * for each kind of workspace. It pins the whole list so any change to the navigation is a
 * deliberate, reviewed edit of this file rather than a side effect.
 *
 * WP-V3 part 2 changed the traveller workspace to four tabs. The list from before that change
 * is kept below, frozen, so a test can prove every earlier destination is still one step away.
 */

const self = '10000000-0000-4000-8000-000000000001';
const org = '20000000-0000-4000-8000-000000000001';
const member = '20000000-0000-4000-8000-000000000002';
const linkAccess: WorkspaceAccess = {
  travellers: [{ id: self, name: 'Synthetic Self', relationship: 'SELF' }],
  agencies: [
    { id: org, name: 'Synthetic Agency', admin: true },
    { id: member, name: 'Synthetic Member Agency', admin: false },
  ],
  platform: { owner: true, ai: true, complaints: true, audit: true, privacy: true },
};
const none: WorkspaceAccess = { travellers: [], agencies: [], platform: null };

const pairs = (links: readonly NavLink[]) => links.map((link) => [link.label, link.href]);
const base = `/app/applicant/${self}`;

describe('workspace navigation link list (characterization)', () => {
  it('a traveller workspace: Home and the three entry points, then Notifications and Countries', () => {
    const nav = workspaceNavigation(base, linkAccess);
    expect(pairs(nav.primary)).toEqual([
      ['Home', base],
      ['My Documents', `${base}/documents`],
      ['My Trips', `${base}/missions`],
      ['Sharing & Requests', `${base}/sharing`],
      ['Notifications', '/app/notifications'],
      ['Countries', '/app/countries'],
    ]);
    expect(
      nav.primary.flatMap((link) => (link.action ? [[link.action.label, link.action.href]] : [])),
    ).toEqual([
      ['Add Documents', `${base}/documents/add`],
      ['Start a Trip', '/app/mission/start'],
    ]);
    expect(pairs(nav.tools)).toEqual([
      ['Record', `${base}/record`],
      ['Evidence Requests', `${base}/evidence`],
      ['Group Trips', '/app/trips'],
      ['Answers to Agencies', '/collect/account/answers'],
      ['Shared with Me', '/app/shared'],
      ['Account Overview', '/app'],
    ]);
    expect(nav.settings).toEqual([]);
    expect(pairs(recordSections(self))).toEqual([
      ['All Records', `${base}/record`],
      ['My Profile', `${base}/profile`],
      ['Documents', `${base}/documents`],
      ['Dates & Expiry', `${base}/expiry`],
      ['History', `${base}/history`],
    ]);
  });

  it('a personal space with no traveller yet', () => {
    const nav = workspaceNavigation('/app', none);
    expect(pairs(nav.primary)).toEqual([
      ['Account Overview', '/app'],
      ['Add a Traveller', '/app/applicants'],
      ['Notifications', '/app/notifications'],
      ['Countries', '/app/countries'],
    ]);
    expect(pairs(nav.tools)).toEqual([
      ['Group Trips', '/app/trips'],
      ['Answers to Agencies', '/collect/account/answers'],
      ['Shared with Me', '/app/shared'],
    ]);
  });

  it('an agency workspace, for an administrator and for a case worker', () => {
    const admin = workspaceNavigation(`/app/agency/${org}`, linkAccess);
    const a = `/app/agency/${org}`;
    expect(pairs(admin.primary)).toEqual([
      ['Overview', a],
      ['Clients', `${a}/clients`],
      ['Cases', `${a}/cases`],
      ['Evidence Requests', `${a}/clients#agency-evidence-requests`],
      ['Team', `${a}/team`],
      ['Case Activity', `${a}/activity`],
      ['Countries', `${a}/countries`],
    ]);
    expect(pairs(admin.tools)).toEqual([['Plan & Usage', `${a}/plan`]]);
    expect(pairs(admin.settings)).toEqual([['Agency Settings', `${a}/settings`]]);
    const m = `/app/agency/${member}`;
    const worker = workspaceNavigation(m, linkAccess);
    expect(pairs(worker.primary)).toEqual([
      ['Overview', m],
      ['Cases', `${m}/cases`],
      ['Case Activity', `${m}/activity`],
      ['Countries', `${m}/countries`],
    ]);
    expect(pairs(worker.settings)).toEqual([]);
  });

  it('the platform workspace', () => {
    const nav = workspaceNavigation('/app/admin', linkAccess);
    expect(pairs(nav.primary)).toEqual([
      ['Overview', '/app/admin'],
      ['Members', '/app/admin/members'],
      ['Organizations', '/app/admin/organizations'],
      ['Activity', '/app/admin/audit'],
      ['Providers', '/app/admin#admin-provider-operations'],
      ['Costs & Plans', '/app/admin/plans'],
      ['Security', '/app/admin/security'],
    ]);
    expect(pairs(nav.tools)).toEqual([
      ['Rules & Packs', '/app/admin/packs'],
      ['AI Settings', '/app/admin/ai'],
      ['Privacy Operations', '/app/admin/privacy'],
      ['Platform Access', '/app/admin/access'],
      ['Complaints', '/app/admin/complaints'],
    ]);
    expect(pairs(nav.settings)).toEqual([['Platform Settings', '/app/admin/settings']]);
    expect(pairs(nav.billing ?? [])).toEqual([['Billing', '/app/admin/billing']]);
  });

  it('sends only the owner to the plans, and lists each Billing and Plans page only for the role that can open it', () => {
    const staff = (platform: NonNullable<WorkspaceAccess['platform']>) =>
      workspaceNavigation('/app/admin', { ...none, platform });
    const limited = {
      owner: false,
      ai: false,
      complaints: false,
      audit: false,
      privacy: false,
    };
    expect(pairs(staff(limited).primary)).toContainEqual([
      'Costs & Plans',
      '/app/admin#admin-usage',
    ]);
    expect(pairs(staff(limited).billing ?? [])).toEqual([]);
    expect(pairs(staff({ ...limited, email: true }).billing ?? [])).toEqual([
      ['Email Delivery', '/app/admin/email'],
    ]);
    expect(pairs(staff({ ...limited, protection: true, recovery: true }).billing ?? [])).toEqual([
      ['Document Protection', '/app/admin/document-protection'],
      ['Sign-In Recovery', '/app/admin/sign-in-recovery'],
    ]);
    expect(pairs(staff({ ...limited, owner: true }).billing ?? [])).toEqual([
      ['Billing', '/app/admin/billing'],
    ]);
  });
});

/** The traveller links as they were before WP-V3 part 2 (origin/main 2ec8f72). Frozen: never edit. */
const BEFORE_TRAVELLER: readonly (readonly [string, string])[] = [
  ['Overview', base],
  ['My Profile', `${base}/profile`],
  ['Documents', `${base}/documents`],
  ['Visa Cases', `${base}/missions`],
  ['Sharing', `${base}/sharing`],
  ['Notifications', '/app/notifications'],
  ['Countries', '/app/countries'],
  ['Shared with Me', '/app/shared'],
  ['Account Overview', '/app'],
  ['Evidence Requests', `${base}/evidence`],
  ['Dates & Expiry', `${base}/expiry`],
  ['History', `${base}/history`],
];
const BEFORE_EMPTY: readonly (readonly [string, string])[] = [
  ['Overview', '/app'],
  ['Add a Traveller', '/app/applicants'],
  ['Notifications', '/app/notifications'],
  ['Countries', '/app/countries'],
  ['Shared with Me', '/app/shared'],
  ['Account Overview', '/app'],
];

describe('no destination is lost by the four-tab change', () => {
  it('every earlier traveller destination is still a tab, a tool or a Record section', () => {
    const nav = workspaceNavigation(base, linkAccess);
    // A link to a section of a page still reaches that page.
    const offered = new Set(
      [...nav.primary, ...nav.tools, ...recordSections(self)].map(
        (link) => link.href.split('#')[0],
      ),
    );
    for (const [label, href] of BEFORE_TRAVELLER) {
      expect(offered.has(href), `${label} (${href})`).toBe(true);
    }
  });

  it('every earlier destination with no traveller is still offered', () => {
    const nav = workspaceNavigation('/app', none);
    const offered = new Set([...nav.primary, ...nav.tools].map((link) => link.href.split('#')[0]));
    for (const [label, href] of BEFORE_EMPTY) {
      expect(offered.has(href), `${label} (${href})`).toBe(true);
    }
  });

  it('each Record section lights up My Documents and only that entry point (UMPE P13)', () => {
    const nav = workspaceNavigation(base, linkAccess);
    for (const section of recordSections(self)) {
      for (const path of [section.href, `${section.href}/synthetic`]) {
        if (section.label === 'All Records' && path.endsWith('/synthetic')) continue;
        expect(
          nav.primary.filter((link) => isCurrentPath(path, link)).map((link) => link.label),
          path,
        ).toEqual(['My Documents']);
      }
    }
    // Requests belong to Sharing & Requests; trips and cases to My Trips.
    for (const [path, label] of [
      [`${base}/evidence`, 'Sharing & Requests'],
      ['/app/shared/synthetic', 'Sharing & Requests'],
      [`/app/mission/${m1}`, 'My Trips'],
      ['/app/mission/start', 'My Trips'],
      ['/app/trips/synthetic', 'My Trips'],
    ] as const) {
      expect(
        nav.primary.filter((link) => isCurrentPath(path, link)).map((l) => l.label),
        path,
      ).toEqual([label]);
    }
  });

  it('Start a Trip never guesses a traveller: it keeps the neutral case frame (UMPE P13)', () => {
    // A managed traveller's Start a Trip task must not swap the sidebar to someone else.
    const nav = workspaceNavigation('/app/mission/start', access);
    expect(nav.name).toBe('Visa Case');
    expect(nav.primary.some((link) => link.href.startsWith('/app/applicant/'))).toBe(false);
  });

  it('the account page has one name in the navigation: only Account Overview is current on /app', () => {
    for (const [who, nav] of [
      ['a traveller', workspaceNavigation('/app', linkAccess)],
      ['no traveller yet', workspaceNavigation('/app', none)],
    ] as const) {
      const current = [...nav.primary, ...nav.tools].filter((link) => isCurrentPath('/app', link));
      expect(
        current.map((link) => link.label),
        who,
      ).toEqual(['Account Overview']);
    }
  });
});

describe('archived travellers (LC-E)', () => {
  const p3 = '10000000-0000-4000-8000-000000000003';
  const p4 = '10000000-0000-4000-8000-000000000004';
  const withArchived: WorkspaceAccess = {
    ...access,
    archivedTravellers: [{ id: p3, name: 'Synthetic Archived', relationship: 'FAMILY_MEMBER' }],
  };

  it('keeps the frame and tabs of an archived traveller page opened by link', () => {
    const nav = workspaceNavigation(`/app/applicant/${p3}`, withArchived);
    expect(nav.kind).toBe('personal');
    expect(nav.name).toBe('Synthetic Archived');
    expect(nav.primary.slice(0, 4).map((link) => link.label)).toEqual([
      'Home',
      'My Documents',
      'My Trips',
      'Sharing & Requests',
    ]);
    expect(nav.primary.every((link) => !link.href.includes(p1))).toBe(true);
  });

  it('never chooses an archived traveller by default, and the switcher list holds only everyday ones', () => {
    const onlyArchived: WorkspaceAccess = { ...withArchived, travellers: [] };
    expect(workspaceNavigation('/app', onlyArchived).name).toBe('Personal Space');
    expect(withArchived.travellers.map((t) => t.id)).toEqual([p1, p2]);
  });

  it('still refuses a traveller in neither list (Recently Deleted, being removed, or not owned)', () => {
    expect(workspaceNavigation(`/app/applicant/${p4}`, withArchived).kind).toBe('unavailable');
  });
});
