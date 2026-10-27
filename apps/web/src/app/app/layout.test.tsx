import { type ReactElement, isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

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
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name in jar.values ? { name, value: jar.values[name] } : undefined),
  }),
}));
vi.mock('./workspace-shell', () => ({ WorkspaceShell: () => null }));
const { default: AppLayout } = await import('./layout');

interface ShellProps {
  readonly accountEmail?: string;
  readonly sidebarState?: string;
  readonly access: { readonly accountName: string };
}

describe('app layout hands the signed-in address only to the account menu', () => {
  it('passes the address once, as its own prop, and never inside the access object', async () => {
    const element = (await AppLayout({ children: null })) as ReactElement<ShellProps>;
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
    let element = (await AppLayout({ children: null })) as ReactElement<ShellProps>;
    expect(element.props.sidebarState).toBe('expanded');
    jar.values = { visastack_sidebar: 'collapsed' };
    element = (await AppLayout({ children: null })) as ReactElement<ShellProps>;
    expect(element.props.sidebarState).toBe('collapsed');
    jar.values = { visastack_sidebar: 'anything-else' };
    element = (await AppLayout({ children: null })) as ReactElement<ShellProps>;
    expect(element.props.sidebarState).toBe('expanded');
    jar.values = {};
  });
});
