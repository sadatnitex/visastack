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
vi.mock('./workspace-shell', () => ({ WorkspaceShell: () => null }));
const { default: AppLayout } = await import('./layout');

interface ShellProps {
  readonly accountEmail?: string;
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
