import { describe, expect, it } from 'vitest';
import { isCurrentPath } from './navigation';
import { type WorkspaceAccess, workspaceNavigation } from './workspace-navigation';

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
  it('uses the selected owned traveller for all six principal destinations', () => {
    const nav = workspaceNavigation(`/app/applicant/${p2}/profile`, access);
    expect(nav.name).toBe('Synthetic Family');
    expect(nav.caption).toBe('Managed traveller');
    expect(nav.primary.map((link) => link.label)).toEqual([
      'Overview',
      'My profile',
      'Documents',
      'Visa cases',
      'Sharing',
      'Notifications',
    ]);
    expect(
      nav.primary.slice(0, 5).every((link) => link.href.startsWith(`/app/applicant/${p2}`)),
    ).toBe(true);
    expect([...nav.primary, ...nav.tools, ...nav.settings].map((link) => link.href)).not.toContain(
      '/app/privacy',
    );
    expect(nav.tools.map((link) => link.label)).toEqual(
      expect.arrayContaining(['Shared with me', 'Evidence requests', 'Dates & expiry', 'History']),
    );
  });
  it('keeps first-person creation and agency entry available without fabricated records', () => {
    const nav = workspaceNavigation('/app', { travellers: [], agencies: [], platform: null });
    expect(nav.primary).toContainEqual({ href: '/app/applicants', label: 'Add a traveller' });
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
      'Evidence requests',
      'Team',
      'Case activity',
    ]);
    expect(nav.primary.every((link) => link.href.startsWith(`/app/agency/${o1}`))).toBe(true);
    expect(nav.tools).toContainEqual({ href: `/app/agency/${o1}/plan`, label: 'Plan & usage' });
  });
  it('does not offer administrator-only agency actions to a case worker', () => {
    const nav = workspaceNavigation(`/app/agency/${o2}/cases`, access);
    expect(nav.primary.map((link) => link.label)).toEqual(['Overview', 'Cases', 'Case activity']);
    expect(nav.settings.some((link) => link.label === 'Settings')).toBe(false);
  });
  it('offers real platform categories and preserves specialized tools', () => {
    expect(labels('/app/admin')).toEqual([
      'Overview',
      'Members',
      'Organizations',
      'Activity',
      'Providers',
      'Costs & plans',
      'Security',
    ]);
    expect(workspaceNavigation('/app/admin', access).tools.map((link) => link.label)).toEqual([
      'Rules & packs',
      'AI settings',
      'Privacy operations',
      'Platform access',
      'Complaints',
    ]);
  });
  it('hides the private account directory and restricted configuration for limited platform staff', () => {
    const limited = { ...access, platform: { owner: false, ai: false, complaints: false } };
    expect(labels('/app/admin', limited)).not.toContain('Members');
    const tools = workspaceNavigation('/app/admin', limited).tools.map((link) => link.label);
    expect(tools).not.toContain('AI settings');
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
    ).toEqual(['Visa cases']);
    expect(workspaceNavigation('/app/mission/another-case', access, subject).name).toBe(
      'Visa case',
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
    ).toEqual(['Documents']);
    const providers = workspaceNavigation('/app/admin', access).primary.find(
      (link) => link.label === 'Providers',
    );
    expect(providers && isCurrentPath('/app/admin#admin-provider-operations', providers)).toBe(
      true,
    );
    expect(providers && isCurrentPath('/app/admin', providers)).toBe(false);
  });
});
