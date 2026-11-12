import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/locale', () => ({ getLocale: async () => 'bn' }));
vi.mock('../../lib/session', () => ({
  withSession: async (run: (ctx: Record<string, unknown>) => unknown) =>
    run({ db: {}, accountId: 'a1', email: 'a@example.com' }),
}));
vi.mock('../../lib/workspace-chrome', () => ({
  loadWorkspaceChrome: async () => ({ accountName: 'A', toolbar: null }),
}));
vi.mock('../../lib/case-subject', () => ({ caseSubjectFor: async () => null }));
vi.mock('../../lib/sidebar-state', () => ({ getSidebarState: async () => 'open' }));
vi.mock('../../lib/sign-out', () => ({ signOutCurrentUser: async () => undefined }));
vi.mock('../../lib/base-url', () => ({ resolveBaseUrl: () => 'https://example.test' }));
vi.mock('./workspace-shell', () => ({ WorkspaceShell: () => null }));

const { WorkspaceFrame } = await import('./workspace-frame');

describe('WorkspaceFrame language', () => {
  it('translates the sign-out button even when no page or layout primed the language', () => {
    // Pages such as /collect/account/answers never call primeLocale; the frame must not rely on it.
    return WorkspaceFrame({ children: null }).then((element) => {
      const signOut = (element.props as { signOut: React.ReactElement }).signOut;
      const html = renderToStaticMarkup(signOut);
      expect(html).toContain('সাইন আউট করুন');
      expect(html).not.toContain('Sign Out');
    });
  });
});
