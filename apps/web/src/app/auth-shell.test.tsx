import { type ReactElement, type ReactNode, isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer } from '../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  currentIdentity: vi.fn(),
  signOutCurrentUser: vi.fn(),
  reportServerError: vi.fn(),
}));

vi.mock('next/font/local', () => ({ default: () => ({ variable: 'test-font' }) }));
vi.mock('../lib/providers', () => ({
  createIdentityPort: () => ({ currentIdentity: mocks.currentIdentity }),
}));
vi.mock('../lib/sign-out', () => ({ signOutCurrentUser: mocks.signOutCurrentUser }));
vi.mock('../lib/server-error', () => ({ reportServerError: mocks.reportServerError }));
vi.mock('../lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../lib/deployment-mode', () => ({ getDeploymentMode: () => 'development' }));
vi.mock('./actions', () => ({ setLocaleAction: vi.fn() }));
vi.mock('../lib/admin', () => ({ isPlatformAdmin: async () => false }));
vi.mock('../lib/workspace-chrome', () => ({
  loadWorkspaceChrome: async () => ({
    accountName: 'Your Account',
    travellers: [],
    agencies: [],
    platform: null,
  }),
}));
vi.mock('../lib/session', () => ({
  withSession: (fn: (ctx: unknown) => unknown) =>
    fn({ db: {}, accountId: 'a1', email: 'a@example.com' }),
}));

const { default: RootLayout } = await import('./layout');
const { default: AppLayout } = await import('./app/layout');
const { default: DeniedPage } = await import('./pilot-access-denied/page');

function formAction(node: ReactNode): (() => Promise<void>) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const action = formAction(child);
      if (action) return action;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  const element = node as ReactElement<{
    children?: ReactNode;
    signOut?: ReactNode;
    action?: () => Promise<void>;
  }>;
  if (element.type === 'form' && element.props.action) return element.props.action;
  return formAction(element.props.children) ?? formAction(element.props.signOut);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.currentIdentity.mockResolvedValue(undefined);
  mocks.signOutCurrentUser.mockResolvedValue(undefined);
});

describe('selected identity in the application shell', () => {
  it('shows Workspace for a Neon session', async () => {
    mocks.currentIdentity.mockResolvedValue({
      providerId: 'neon-1',
      email: 'traveller@example.com',
      emailVerified: true,
    });
    const html = await renderServer(RootLayout({ children: null }));
    expect(html).toContain('Workspace');
    expect(html).not.toContain('>Sign in<');
  });

  it('shows Sign in for an unsigned-in visitor without a provider fallback', async () => {
    const html = await renderServer(RootLayout({ children: null }));
    expect(html).toContain('Sign in');
    expect(html).not.toContain('Workspace');
  });

  it('keeps public navigation signed out and reports a selected-provider outage', async () => {
    const error = new Error('selected provider unavailable');
    mocks.currentIdentity.mockRejectedValue(error);
    const html = await renderServer(RootLayout({ children: null }));
    expect(html).toContain('Sign in');
    expect(html).not.toContain('Workspace');
    expect(mocks.reportServerError).toHaveBeenCalledWith('public navigation identity', error);
  });

  it('ends the selected provider session from the workspace sign-out form', async () => {
    const action = formAction(await AppLayout({ children: null }));
    expect(action).toBeDefined();
    await action?.();
    expect(mocks.signOutCurrentUser).toHaveBeenCalledOnce();
  });

  it('shows the denied identity without provisioning an account', async () => {
    mocks.currentIdentity.mockResolvedValue({
      providerId: 'neon-2',
      email: 'denied@example.com',
      emailVerified: true,
    });
    const html = await renderServer(DeniedPage());
    expect(html).toContain('denied@example.com');
  });

  it('keeps denial generic when the selected provider cannot be read', async () => {
    const error = new Error('selected provider unavailable');
    mocks.currentIdentity.mockRejectedValue(error);
    const html = await renderServer(DeniedPage());
    expect(html).toContain('This account');
    expect(html).not.toContain('selected provider unavailable');
    expect(mocks.reportServerError).toHaveBeenCalledWith('pilot denial identity', error);
  });
});
