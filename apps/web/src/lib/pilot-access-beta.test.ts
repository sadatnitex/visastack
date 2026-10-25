import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.fn(async (..._args: unknown[]) => ({
  allowed: true,
  invitationId: null,
  mustClaimInvitation: false,
}));
vi.mock('@visastack/services', () => ({
  checkPilotAccess: (...args: unknown[]) => service(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('DEPLOYMENT_MODE', 'controlled_pilot');
  vi.stubEnv('PUBLIC_BETA_OPEN', '');
  vi.stubEnv('IDENTITY_PROVIDER', '');
});

describe('invitation check in a real deployment', () => {
  it('stays in force by default', async () => {
    const { checkPilotAccess } = await import('./pilot-access');
    await checkPilotAccess({} as never, { email: 'a@b.co' });
    expect(service).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bypass: false }),
    );
  });

  it('stays in force when sign-in is not configured, even if the beta switch is set', async () => {
    vi.stubEnv('PUBLIC_BETA_OPEN', 'true');
    const { checkPilotAccess } = await import('./pilot-access');
    await checkPilotAccess({} as never, { email: 'a@b.co' });
    expect(service).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bypass: false }),
    );
  });

  it('is skipped only for the public beta with Neon sign-in configured', async () => {
    vi.stubEnv('PUBLIC_BETA_OPEN', 'true');
    vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/db');
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'c'.repeat(40));
    const { checkPilotAccess } = await import('./pilot-access');
    await checkPilotAccess({} as never, { email: 'a@b.co' });
    expect(service).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bypass: true }),
    );
  });
});
