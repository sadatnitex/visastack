import { describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';
const state = vi.hoisted(() => ({ signedIn: false }));
vi.mock('next/font/local', () => ({ default: () => ({ variable: 'synthetic-font' }) }));
vi.mock('../lib/signed-in', () => ({ isSignedIn: async () => state.signedIn }));
vi.mock('../lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../lib/deployment-mode', () => ({ getDeploymentMode: () => 'controlled_pilot' }));
vi.mock('../lib/public-beta', () => ({ isPublicBetaOpen: () => true }));
vi.mock('./actions', () => ({ setLocaleAction: async () => undefined }));
const { default: RootLayout } = await import('./layout');
describe('public beta notice audience', () => {
  it('retains the public notice for a signed-out visitor', async () => {
    state.signedIn = false;
    expect(textOf(await renderServer(RootLayout({ children: <p>Public page</p> })))).toContain(
      'Registration is open.',
    );
  });
  it('does not render the notice for a signed-in user', async () => {
    state.signedIn = true;
    const html = await renderServer(RootLayout({ children: <p>Signed-in page</p> }));
    expect(html).not.toContain('pilot-banner');
    expect(textOf(html)).not.toContain('Registration is open.');
  });
});
