import { describe, expect, it } from 'vitest';
import { PRIMARY_NAV, agencyTabs, applicantTabs, isCurrentPath, platformTabs } from './navigation';

const labels = (links: readonly { readonly label: string }[]) => links.map((l) => l.label);

describe('traveller navigation names (directive Part 9 section 1)', () => {
  const travellerNames = [
    'Overview',
    'Profile',
    'Documents',
    'Cases',
    'Sharing',
    'Alerts',
    'Privacy',
  ];

  it('offers every destination the directive names for a traveller', () => {
    const offered = new Set([...labels(PRIMARY_NAV), ...labels(applicantTabs('a1'))]);
    for (const name of travellerNames) expect(offered, name).toContain(name);
  });

  it('uses the product words, not the old internal ones', () => {
    const offered = [...labels(PRIMARY_NAV), ...labels(applicantTabs('a1'))];
    expect(offered).not.toContain('Home');
    expect(offered).not.toContain('Notifications');
    expect(offered).not.toContain('Missions');
  });

  it('offers the country rules in the main menu without changing the phone bar or its first menu link', () => {
    expect(PRIMARY_NAV.find((l) => l.label === 'Countries')?.href).toBe('/app/countries');
    // The phone bar holds the first four links; the sheet behind "More" opens on the fifth.
    expect(labels(PRIMARY_NAV).slice(0, 5)).toEqual([
      'Overview',
      'Applicants',
      'Shared with Me',
      'Alerts',
      'Privacy',
    ]);
  });

  it('keeps the existing route segments so bookmarks still work', () => {
    const tabs = applicantTabs('abc');
    expect(tabs.find((t) => t.label === 'Cases')?.href).toBe('/app/applicant/abc/missions');
    expect(PRIMARY_NAV.find((l) => l.label === 'Alerts')?.href).toBe('/app/notifications');
    expect(PRIMARY_NAV.find((l) => l.label === 'Overview')?.href).toBe('/app');
  });

  it('never repeats a destination or a label inside one bar', () => {
    for (const bar of [PRIMARY_NAV, applicantTabs('a1')]) {
      expect(new Set(bar.map((l) => l.href)).size).toBe(bar.length);
      expect(new Set(labels(bar)).size).toBe(bar.length);
    }
  });
});

describe('isCurrentPath', () => {
  const overview = PRIMARY_NAV[0];
  const applicants = PRIMARY_NAV[1];
  const shared = PRIMARY_NAV[2];
  if (!overview || !applicants || !shared) throw new Error('fixture');

  it('marks an exact link current only on its own path', () => {
    expect(isCurrentPath('/app', overview)).toBe(true);
    expect(isCurrentPath('/app/', overview)).toBe(true);
    expect(isCurrentPath('/app/applicants', overview)).toBe(false);
    expect(isCurrentPath('/app/privacy', overview)).toBe(false);
  });

  it('marks a link current on its own path and on pages below it', () => {
    expect(isCurrentPath('/app/shared', shared)).toBe(true);
    expect(isCurrentPath('/app/shared/grant-1', shared)).toBe(true);
  });

  it('respects the path boundary', () => {
    expect(isCurrentPath('/app/shared-with-others', shared)).toBe(false);
    expect(isCurrentPath('/app/sharedfoo', shared)).toBe(false);
  });

  it('claims a workspace and its case pages for Applicants', () => {
    expect(isCurrentPath('/app/applicants', applicants)).toBe(true);
    expect(isCurrentPath('/app/applicant/a1', applicants)).toBe(true);
    expect(isCurrentPath('/app/applicant/a1/documents', applicants)).toBe(true);
    expect(isCurrentPath('/app/mission/m1', applicants)).toBe(true);
    expect(isCurrentPath('/app/privacy', applicants)).toBe(false);
  });

  it('highlights exactly one workspace tab on a deep page', () => {
    const tabs = applicantTabs('a1');
    const current = tabs.filter((t) => isCurrentPath('/app/applicant/a1/profile', t));
    expect(labels(current)).toEqual(['Profile']);
    const onOverview = tabs.filter((t) => isCurrentPath('/app/applicant/a1', t));
    expect(labels(onOverview)).toEqual(['Overview']);
    const onCases = tabs.filter((t) => isCurrentPath('/app/applicant/a1/missions', t));
    expect(labels(onCases)).toEqual(['Cases']);
  });
});

describe('agency navigation (directive Part 9 section 1)', () => {
  it('offers Dashboard, Clients, Cases, Team, Usage & billing and Settings to an administrator', () => {
    expect(labels(agencyTabs('o1', { admin: true }))).toEqual([
      'Dashboard',
      'Clients',
      'Cases',
      'Team',
      'Usage & Billing',
      'Settings',
    ]);
  });

  it('shows a member who is not an administrator only what they can use', () => {
    expect(labels(agencyTabs('o1', { admin: false }))).toEqual([
      'Dashboard',
      'Cases',
      'Usage & Billing',
    ]);
  });

  it('keeps the plan route for Usage & billing and puts the rest under the organization', () => {
    const tabs = agencyTabs('o1', { admin: true });
    expect(tabs.map((t) => t.href)).toEqual([
      '/app/agency/o1',
      '/app/agency/o1/clients',
      '/app/agency/o1/cases',
      '/app/agency/o1/team',
      '/app/agency/o1/plan',
      '/app/agency/o1/settings',
    ]);
  });

  it('never leaks the internal admin-only marker into a link', () => {
    for (const tab of agencyTabs('o1', { admin: true })) {
      expect(Object.keys(tab)).not.toContain('adminOnly');
    }
  });

  it('highlights exactly one tab on every page of the console', () => {
    const tabs = agencyTabs('o1', { admin: true });
    const onlyCurrent = (path: string) => labels(tabs.filter((tab) => isCurrentPath(path, tab)));
    expect(onlyCurrent('/app/agency/o1')).toEqual(['Dashboard']);
    expect(onlyCurrent('/app/agency/o1/clients')).toEqual(['Clients']);
    expect(onlyCurrent('/app/agency/o1/cases')).toEqual(['Cases']);
    expect(onlyCurrent('/app/agency/o1/team')).toEqual(['Team']);
    expect(onlyCurrent('/app/agency/o1/plan')).toEqual(['Usage & Billing']);
    expect(onlyCurrent('/app/agency/o1/settings')).toEqual(['Settings']);
  });
});

describe('platform navigation (directive Part 9 section 1)', () => {
  const all = { ai: true, complaints: true, audit: true, privacy: true };

  it('offers Organizations, Rules, AI, Operations, Privacy and Audit in the directive order', () => {
    expect(labels(platformTabs(all)).slice(0, 6)).toEqual([
      'Organizations',
      'Rules',
      'AI',
      'Operations',
      'Privacy',
      'Audit',
    ]);
  });

  it('keeps the shipped Access and Complaints areas as extra tabs', () => {
    expect(labels(platformTabs(all)).slice(6)).toEqual(['Access', 'Complaints']);
  });

  it('hides AI and Complaints from an administrator who may not use them', () => {
    const names = labels(platformTabs({ ai: false, complaints: false, audit: false, privacy: false }));
    expect(names).not.toContain('AI');
    expect(names).not.toContain('Complaints');
    expect(names).not.toContain('Audit');
    expect(names).not.toContain('Privacy');
    expect(names).toContain('Operations');
  });

  it('makes Operations the landing page that matches only its own path', () => {
    const tabs = platformTabs(all);
    const operations = tabs.find((t) => t.label === 'Operations');
    expect(operations?.href).toBe('/app/admin');
    const onlyCurrent = (path: string) => labels(tabs.filter((tab) => isCurrentPath(path, tab)));
    expect(onlyCurrent('/app/admin')).toEqual(['Operations']);
    expect(onlyCurrent('/app/admin/audit')).toEqual(['Audit']);
    expect(onlyCurrent('/app/admin/packs/p1/diff')).toEqual(['Rules']);
    expect(onlyCurrent('/app/admin/organizations/o1')).toEqual(['Organizations']);
    expect(onlyCurrent('/app/admin/ai-settings')).toEqual(['AI']);
  });
});
