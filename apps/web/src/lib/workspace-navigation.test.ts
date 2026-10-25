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
  platform: { owner: true, ai: true, complaints: true },
};
const labels = (path: string, actor = access) =>
  workspaceNavigation(path, actor).primary.map((link) => link.label);

describe('current contextual navigation contract', () => {
  it('uses the selected owned traveller for the four tabs, then notifications and the country rules', () => {
    const nav = workspaceNavigation(`/app/applicant/${p2}/profile`, access);
    expect(nav.name).toBe('Synthetic Family');
    expect(nav.caption).toBe('Managed Traveller');
    expect(nav.primary.map((link) => link.label)).toEqual([
      'Home',
      'Record',
      'Cases',
      'Sharing',
      'Notifications',
      'Countries',
    ]);
    expect(nav.primary.at(-1)).toEqual({ href: '/app/countries', label: 'Countries' });
    expect(
      nav.primary.slice(0, 4).every((link) => link.href.startsWith(`/app/applicant/${p2}`)),
    ).toBe(true);
    expect([...nav.primary, ...nav.tools, ...nav.settings].map((link) => link.href)).not.toContain(
      '/app/privacy',
    );
    expect(nav.tools.map((link) => link.label)).toEqual(
      expect.arrayContaining(['Shared with Me', 'Account and Permissions', 'Evidence Requests']),
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
  it('hides the private account directory and restricted configuration for limited platform staff', () => {
    const limited = { ...access, platform: { owner: false, ai: false, complaints: false } };
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
    ).toEqual(['Cases']);
    expect(workspaceNavigation('/app/mission/another-case', access, subject).name).toBe(
      'Visa Case',
    );
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
    ).toEqual(['Record']);
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
  platform: { owner: true, ai: true, complaints: true },
};
const none: WorkspaceAccess = { travellers: [], agencies: [], platform: null };

const pairs = (links: readonly NavLink[]) => links.map((link) => [link.label, link.href]);
const base = `/app/applicant/${self}`;

describe('workspace navigation link list (characterization)', () => {
  it('a traveller workspace: four tabs, then Notifications and Countries', () => {
    const nav = workspaceNavigation(base, linkAccess);
    expect(pairs(nav.primary)).toEqual([
      ['Home', base],
      ['Record', `${base}/record`],
      ['Cases', `${base}/missions`],
      ['Sharing', `${base}/sharing`],
      ['Notifications', '/app/notifications'],
      ['Countries', '/app/countries'],
    ]);
    expect(pairs(nav.tools)).toEqual([
      ['Shared with Me', '/app/shared'],
      ['Account and Permissions', '/app#permissions'],
      ['Evidence Requests', `${base}/evidence`],
    ]);
    expect(nav.settings).toEqual([]);
    expect(pairs(recordSections(self))).toEqual([
      ['All Records', `${base}/record`],
      ['Profile', `${base}/profile`],
      ['Documents', `${base}/documents`],
      ['Dates & Expiry', `${base}/expiry`],
      ['History', `${base}/history`],
    ]);
  });

  it('a personal space with no traveller yet', () => {
    const nav = workspaceNavigation('/app', none);
    expect(pairs(nav.primary)).toEqual([
      ['Home', '/app'],
      ['Add a Traveller', '/app/applicants'],
      ['Notifications', '/app/notifications'],
      ['Countries', '/app/countries'],
    ]);
    expect(pairs(nav.tools)).toEqual([
      ['Shared with Me', '/app/shared'],
      ['Account and Permissions', '/app#permissions'],
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
      ['Costs & Plans', '/app/admin#admin-usage'],
      ['Security', '/app/admin/security'],
    ]);
    expect(pairs(nav.tools)).toEqual([
      ['Rules & Packs', '/app/admin/packs'],
      ['AI Settings', '/app/admin/ai-settings'],
      ['Privacy Operations', '/app/admin/privacy'],
      ['Platform Access', '/app/admin/access'],
      ['Complaints', '/app/admin/complaints'],
    ]);
    expect(pairs(nav.settings)).toEqual([['Platform Settings', '/app/admin/settings']]);
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

  it('each Record section lights up the Record tab and only that tab', () => {
    const nav = workspaceNavigation(base, linkAccess);
    for (const section of recordSections(self)) {
      for (const path of [section.href, `${section.href}/synthetic`]) {
        if (section.label === 'All Records' && path.endsWith('/synthetic')) continue;
        expect(
          nav.primary.filter((link) => isCurrentPath(path, link)).map((link) => link.label),
          path,
        ).toEqual(['Record']);
      }
    }
    expect(
      nav.primary.filter((link) => isCurrentPath(`${base}/evidence`, link)).map((l) => l.label),
    ).toEqual([]);
  });

  it('the account page has one name in the navigation: only Home is current on /app', () => {
    for (const [who, nav] of [
      ['a traveller', workspaceNavigation('/app', linkAccess)],
      ['no traveller yet', workspaceNavigation('/app', none)],
    ] as const) {
      const current = [...nav.primary, ...nav.tools].filter((link) => isCurrentPath('/app', link));
      expect(
        current.map((link) => link.label),
        who,
      ).toEqual(['Home']);
    }
  });
});
