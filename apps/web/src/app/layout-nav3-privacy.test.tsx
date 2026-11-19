import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderServer } from '../lib/next-mocks.test-support';

// Real public-account.ts, real layout: only the outside services are replaced.
const state = vi.hoisted(() => ({
  identity: {
    displayName: 'Asha Rahman Chowdhury',
    email: 'asha.private@example.test',
  } as Record<string, unknown>,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../lib/version-notice-state', () => ({ hasSeenVersionNotice: async () => true }));
vi.mock('next/font/local', () => ({ default: () => ({ variable: 'synthetic-font' }) }));
vi.mock('../lib/signed-in', () => ({ isSignedIn: async () => true }));
vi.mock('../lib/providers', () => ({
  createIdentityPort: () => ({ currentIdentity: async () => state.identity }),
}));
vi.mock('../lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../lib/language-choice', () => ({ LANGUAGE_CHOICE_ENABLED: true }));
vi.mock('../lib/deployment-mode', () => ({ getDeploymentMode: () => 'controlled_pilot' }));
vi.mock('../lib/public-beta', () => ({ isPublicBetaOpen: () => true }));
vi.mock('./actions', () => ({ setLocaleAction: async () => undefined }));
const { default: RootLayout } = await import('./layout');

describe('what a signed-in public page carries of the person (NAV3)', () => {
  afterEach(() => {
    state.identity = {
      displayName: 'Asha Rahman Chowdhury',
      email: 'asha.private@example.test',
    };
  });

  it('has the first name and two letters, never the rest of the name or the email', async () => {
    const html = await renderServer(RootLayout({ children: <p>Page</p> }));
    expect(html).toContain('aria-label="Asha, Account Menu"');
    expect(html).toMatch(/account-public-avatar[^>]*>AR</);
    expect(html).not.toContain('Rahman');
    expect(html).not.toContain('Chowdhury');
    expect(html).not.toContain('asha.private');
    expect(html).not.toContain('example.test');
  });

  it('never prints an address used as the name', async () => {
    state.identity = {
      displayName: 'asha.private@example.test',
      email: 'asha.private@example.test',
    };
    const html = await renderServer(RootLayout({ children: <p>Page</p> }));
    expect(html).not.toContain('asha.private');
    expect(html).toContain('aria-label="Account, Account Menu"');
  });
});
