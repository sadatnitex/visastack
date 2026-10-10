import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  release: vi.fn(async () => undefined),
  attribute: vi.fn(),
  touch: vi.fn(),
  end: vi.fn(async () => undefined),
  report: vi.fn(),
  provision: vi.fn(),
}));
vi.mock('@workos-inc/authkit-nextjs', () => ({ withAuth: vi.fn() }));
vi.mock('./identity-provider', () => ({
  NeonIdentityPort: class {
    async currentIdentity() {
      return { providerId: 'neon-test', email: 'test@example.test', emailVerified: true };
    }
  },
}));
vi.mock('@visastack/db', () => ({
  resolveDatabaseUrl: () => 'test-only',
  createPooledDb: () => ({ db: {}, pool: { on: vi.fn(), end: mocks.end } }),
}));
vi.mock('@visastack/services', () => ({
  provisionNeonAccount: mocks.provision,
  provisionAccount: vi.fn(),
  claimInvitation: vi.fn(async () => true),
  releaseInvitationClaim: mocks.release,
  attributeInvitation: mocks.attribute,
  touchAccountActivity: mocks.touch,
}));
vi.mock('./pilot-access', () => ({
  checkPilotAccess: vi.fn(async () => ({ allowed: true, invitationId: 'invite-test' })),
}));
vi.mock('./server-error', () => ({ reportServerError: mocks.report }));
vi.mock('./session-age', () => ({ isStaffContext: vi.fn(), enforceSessionAgeLimit: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect(to: string) {
    throw Object.assign(new Error(`REDIRECT:${to}`), { digest: `NEXT_REDIRECT;${to}` });
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('IDENTITY_PROVIDER', 'neon_auth');
});

it('releases the invitation and shows recovery without granting account access', async () => {
  mocks.provision.mockResolvedValue({
    ok: false,
    error: {
      code: 'identity_recovery_required',
      message: 'Account access needs additional verification.',
    },
  });
  const { withSession } = await import('./session');
  const work = vi.fn();
  await expect(withSession(work)).rejects.toThrow('REDIRECT:/auth/account-recovery');
  expect(mocks.release).toHaveBeenCalledWith({}, 'invite-test');
  expect(mocks.attribute).not.toHaveBeenCalled();
  expect(mocks.touch).not.toHaveBeenCalled();
  expect(work).not.toHaveBeenCalled();
  expect(mocks.report).not.toHaveBeenCalled();
  expect(mocks.end).toHaveBeenCalledOnce();
}, 30_000);
