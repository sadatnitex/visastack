import { afterEach, describe, expect, it, vi } from 'vitest';
import { PilotBanner } from '../components/pilot-banner';
import { renderServer, textOf } from './next-mocks.test-support';
import { isPublicBetaOpen } from './public-beta';

vi.mock('./signed-in', () => ({ isSignedIn: async () => false }));
vi.mock('./identity-selection', () => ({ selectedIdentityProvider: () => 'neon_auth' }));

const { default: HomePage } = await import('../app/page');
const { default: TermsPage } = await import('../app/terms/page');
const { default: PrivacyPage } = await import('../app/privacy/page');

afterEach(() => vi.unstubAllEnvs());

function setMode(open: boolean) {
  vi.stubEnv('PUBLIC_BETA_OPEN', open ? 'true' : 'false');
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.placeholder.invalid/neondb/auth');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'x'.repeat(64));
}

/** The four places a visitor reads whether real details are welcome, under one real environment. */
async function surfaces() {
  const landing = textOf(await renderServer(HomePage({ searchParams: Promise.resolve({}) })));
  const banner = textOf(
    await renderServer(
      <PilotBanner mode="controlled_pilot" registrationOpen={isPublicBetaOpen()} />,
    ),
  );
  const terms = textOf(await renderServer(<TermsPage />));
  const privacy = textOf(await renderServer(<PrivacyPage />));
  return { landing, banner, terms, privacy };
}

describe('landing page, banner, Terms and Privacy Notice share one public-beta switch', () => {
  it('registration closed: every one asks for made-up details and none invites real ones', async () => {
    setMode(false);
    const s = await surfaces();
    expect(s.landing).toContain('Real applicant details are not accepted yet');
    expect(s.terms).toContain('Real applicant details are not accepted yet');
    expect(s.privacy).toContain('Real applicant details are not accepted yet');
    expect(s.banner).toContain('made-up details');
    for (const text of Object.values(s)) expect(text).not.toContain('at your own risk');
  });

  it('registration open: every one says own risk and none says real details are refused', async () => {
    setMode(true);
    const s = await surfaces();
    for (const text of Object.values(s)) {
      expect(text).toContain('at your own risk');
      expect(text).not.toContain('Real applicant details are not accepted yet');
    }
  });
});
