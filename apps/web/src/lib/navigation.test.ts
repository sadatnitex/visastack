import { describe, expect, it } from 'vitest';
import { PRIMARY_NAV, applicantTabs, isCurrentPath } from './navigation';

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
