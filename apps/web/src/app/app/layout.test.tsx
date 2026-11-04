import { type ReactElement, isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const EMAIL = 'synthetic.layout@example.test';
vi.mock('../../lib/session', () => ({
  withSession: (fn: (ctx: Record<string, unknown>) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-synthetic', email: EMAIL, displayName: 'Synthetic Self' }),
}));
vi.mock('../../lib/workspace-chrome', () => ({
  loadWorkspaceChrome: async () => ({
    accountName: 'Synthetic Self',
    toolbar: { unread: 0, personalPlan: null, agencyPlans: [] },
    travellers: [],
    agencies: [],
    platform: null,
  }),
}));
vi.mock('../../lib/sign-out', () => ({ signOutCurrentUser: async () => undefined }));
const jar = vi.hoisted(() => ({ values: {} as Record<string, string> }));
const headerJar = vi.hoisted(() => ({ path: null as string | null }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name in jar.values ? { name, value: jar.values[name] } : undefined),
  }),
  headers: async () => ({
    get: (name: string) => (name === 'x-vs-pathname' ? headerJar.path : null),
  }),
}));
const mocks = vi.hoisted(() => ({ getMissionForOwner: vi.fn() }));
vi.mock('@visastack/services', () => mocks);
vi.mock('./workspace-shell', () => ({ WorkspaceShell: () => null }));
const { default: RawAppLayout } = await import('./layout');

interface ShellProps {
  readonly accountEmail?: string;
  readonly sidebarState?: string;
  readonly access: { readonly accountName: string };
  readonly initialCaseSubject: { readonly route: string; readonly applicantId: string } | null;
}

/** The layout hands the page address to the shared frame; render the frame to see what it passes the shell. */
async function AppLayout({
  children,
}: { readonly children: null }): Promise<ReactElement<ShellProps>> {
  const frame = (await RawAppLayout({ children })) as ReactElement<{ pathname: string | null }>;
  const Frame = frame.type as (props: unknown) => Promise<ReactElement<ShellProps>>;
  return Frame(frame.props);
}

describe('app layout hands the signed-in address only to the account menu', () => {
  it('passes the address once, as its own prop, and never inside the access object', async () => {
    const element = await AppLayout({ children: null });
    expect(isValidElement(element)).toBe(true);
    expect(element.props.accountEmail).toBe(EMAIL);
    const { access } = element.props;
    expect(access).not.toHaveProperty('accountEmail');
    expect(JSON.stringify(access)).not.toContain(EMAIL);
    expect(access.accountName).toBe('Synthetic Self');
  });
});

describe('app layout reads the sidebar choice of this device', () => {
  it('draws the sidebar open unless the cookie says collapsed', async () => {
    jar.values = {};
    let element = await AppLayout({ children: null });
    expect(element.props.sidebarState).toBe('expanded');
    jar.values = { visastack_sidebar: 'collapsed' };
    element = await AppLayout({ children: null });
    expect(element.props.sidebarState).toBe('collapsed');
    jar.values = { visastack_sidebar: 'anything-else' };
    element = await AppLayout({ children: null });
    expect(element.props.sidebarState).toBe('expanded');
    jar.values = {};
  });
});

const CASE = '00000000-0000-4000-8000-0000000000c1';

describe('app layout names the traveller of a case page on the first paint', () => {
  beforeEach(() => {
    headerJar.path = null;
    mocks.getMissionForOwner.mockReset();
  });

  it('seeds the shell with the owner-checked traveller for a case address', async () => {
    mocks.getMissionForOwner.mockResolvedValue({
      ok: true,
      value: { applicantId: 'synthetic-family' },
    });
    headerJar.path = `/app/mission/${CASE}/snapshots`;
    const element = await AppLayout({ children: null });
    expect(mocks.getMissionForOwner).toHaveBeenCalledWith({}, 'acct-synthetic', CASE);
    expect(element.props.initialCaseSubject).toEqual({
      route: `/app/mission/${CASE}`,
      applicantId: 'synthetic-family',
    });
  });

  it("gives a case that is not this account's the same result as a missing case, and nothing in the page", async () => {
    headerJar.path = `/app/mission/${CASE}`;
    const results = [];
    for (const code of ['forbidden', 'not_found']) {
      mocks.getMissionForOwner.mockResolvedValue({ ok: false, error: { code } });
      const element = await AppLayout({ children: null });
      results.push(JSON.stringify(element.props));
      expect(element.props.initialCaseSubject).toBeNull();
    }
    expect(results[0]).toBe(results[1]);
  });

  it('looks nothing up when the address is not a case, is Start a Trip, or is missing', async () => {
    for (const path of [null, '/app', '/app/mission/start', '/app/applicant/x/missions']) {
      headerJar.path = path;
      const element = await AppLayout({ children: null });
      expect(element.props.initialCaseSubject, String(path)).toBeNull();
    }
    expect(mocks.getMissionForOwner).not.toHaveBeenCalled();
  });

  it("cannot be pointed at another account's case: the owner check still decides", async () => {
    headerJar.path = `/app/mission/${CASE}`;
    mocks.getMissionForOwner.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const element = await AppLayout({ children: null });
    expect(mocks.getMissionForOwner).toHaveBeenCalledWith({}, 'acct-synthetic', CASE);
    expect(element.props.initialCaseSubject).toBeNull();
    expect(JSON.stringify(element.props)).not.toContain('synthetic-family');
  });
});
