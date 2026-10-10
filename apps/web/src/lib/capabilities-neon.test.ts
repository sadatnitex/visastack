import { beforeEach, describe, expect, it, vi } from 'vitest';

const NEON = {
  IDENTITY_PROVIDER: 'neon_auth',
  NEON_AUTH_BASE_URL: 'https://auth.example.test/db',
  NEON_AUTH_COOKIE_SECRET: 'c'.repeat(40),
};

function useEnv(values: Record<string, string>) {
  for (const key of [
    'IDENTITY_PROVIDER',
    'NEON_AUTH_BASE_URL',
    'NEON_AUTH_COOKIE_SECRET',
    'PUBLIC_BETA_OPEN',
    'DEPLOYMENT_MODE',
    'WORKOS_API_KEY',
    'WORKOS_CLIENT_ID',
    'WORKOS_COOKIE_PASSWORD',
    'NEXT_PUBLIC_WORKOS_REDIRECT_URI',
  ]) {
    vi.stubEnv(key, '');
  }
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe('sign-in configuration follows the selected provider', () => {
  // First import loads the provider graph; keep startup bounded on shared CI.
  it('is available with Neon settings and no WorkOS settings', async () => {
    useEnv({ ...NEON, DEPLOYMENT_MODE: 'controlled_pilot' });
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().authentication).toBe('available');
  }, 15_000);

  it.each([
    ['a missing address', { ...NEON, NEON_AUTH_BASE_URL: '' }],
    ['a non-https address', { ...NEON, NEON_AUTH_BASE_URL: 'http://auth.example.test' }],
    ['a short secret', { ...NEON, NEON_AUTH_COOKIE_SECRET: 'short' }],
  ])('is unconfigured with %s', async (_label, values) => {
    useEnv({ ...values, DEPLOYMENT_MODE: 'controlled_pilot' });
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().authentication).toBe('unconfigured');
  });
});

describe('public beta', () => {
  it('opens sign-up only, and nothing commercial', async () => {
    useEnv({ ...NEON, PUBLIC_BETA_OPEN: 'true', DEPLOYMENT_MODE: 'controlled_pilot' });
    const { getPlatformCapabilities } = await import('./capabilities');
    const capabilities = getPlatformCapabilities();
    expect(capabilities.publicSignup).toBe('available');
    expect(capabilities.realApplicantData).toBe('disabled');
    expect(capabilities.commercialClaims).toBe('disabled');
    expect(capabilities.payments).toBe('unconfigured');
  });

  it('stays closed without the switch, or with WorkOS selected', async () => {
    useEnv({ ...NEON, DEPLOYMENT_MODE: 'controlled_pilot' });
    const { getPlatformCapabilities } = await import('./capabilities');
    expect(getPlatformCapabilities().publicSignup).toBe('disabled');
    useEnv({ PUBLIC_BETA_OPEN: 'true', DEPLOYMENT_MODE: 'controlled_pilot' });
    expect(getPlatformCapabilities().publicSignup).toBe('disabled');
  });
});
