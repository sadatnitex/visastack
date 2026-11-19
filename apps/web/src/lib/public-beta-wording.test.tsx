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

  it('registration open: none says own risk or that real details are refused, and the Terms keep the full notice', async () => {
    setMode(true);
    const s = await surfaces();
    for (const text of Object.values(s)) {
      expect(text).not.toContain('Real applicant details are not accepted yet');
      if (text !== s.terms) {
        expect(text).not.toContain('own risk');
        expect(text).not.toContain('virus');
      }
    }
    expect(s.terms).toContain('virus scanning of uploads');
    expect(s.banner).toContain('VisaStack Public Beta');
  });

  /**
   * Owner decision, 19 Nov 2026: "stop telling madeup details etc". With every owner deferral set,
   * real personal data is on in the controlled pilot: no page asks for made-up details, even with
   * registration closed, and the Terms keep the quiet as-is paragraph. Unsetting them rolls back.
   */
  it('real personal data on: no page asks for made-up details, and unsetting the deferrals rolls back', async () => {
    setMode(false);
    vi.stubEnv('DEPLOYMENT_MODE', 'controlled_pilot');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'x');
    vi.stubEnv('STEP_UP_SIGNING_SECRET', 'x');
    for (const [name, id] of REAL_DATA_DEFERRALS) vi.stubEnv(name, id);
    const on = await surfaces();
    for (const text of [on.landing, on.terms, on.privacy]) {
      expect(text).not.toContain('made-up');
      expect(text).not.toContain('Real applicant details are not accepted yet');
    }
    expect(on.terms).toContain('Uploads are not checked for viruses yet');
    expect(on.terms).toContain('you use it at your own risk');
    for (const [name] of REAL_DATA_DEFERRALS) vi.stubEnv(name, undefined);
    const off = await surfaces();
    expect(off.landing).toContain('Real applicant details are not accepted yet');
    expect(off.terms).toContain('Real applicant details are not accepted yet');
    expect(off.privacy).toContain('Real applicant details are not accepted yet');
    expect(off.terms).not.toContain('Uploads are not checked for viruses yet');
  });
});

/** The owner deferrals of 19 Nov 2026 (docs/roadmap/DEFERRED-COMMERCIAL-HARDENING.md). */
const REAL_DATA_DEFERRALS: readonly (readonly [string, string])[] = [
  ['COMMERCIAL_READINESS_DEFER_REAL_MALWARE_SCANNER', 'H29'],
  ['COMMERCIAL_READINESS_DEFER_REAL_KEY_MANAGEMENT', 'H33'],
  ['COMMERCIAL_READINESS_DEFER_INCIDENT_OWNER', 'H34'],
  ['COMMERCIAL_READINESS_DEFER_TERMS_AND_PRIVACY_NOTICE', 'H35'],
  ['COMMERCIAL_READINESS_DEFER_BACKUP_RESTORE_VERIFICATION', 'H36'],
  ['COMMERCIAL_READINESS_DEFER_AUTHENTICATED_PRODUCTION_E2E', 'H37'],
  ['COMMERCIAL_READINESS_DEFER_TENANT_ISOLATION_SUITE', 'H38'],
  ['COMMERCIAL_READINESS_DEFER_PERMISSION_MATRIX', 'H39'],
  ['COMMERCIAL_READINESS_DEFER_EXTERNAL_OBJECT_DELETION_VERIFICATION', 'H40'],
  ['COMMERCIAL_READINESS_DEFER_NO_CRITICAL_HIGH_FINDINGS', 'H41'],
  ['COMMERCIAL_READINESS_DEFER_PRIVACY_CONSENT_CONFIGURATION', 'H42'],
];
