import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@workos-inc/authkit-nextjs', () => ({
  withAuth: vi.fn(async () => {
    throw new Error('WorkOS must not be consulted when Neon Auth is selected');
  }),
}));
const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));

const currentIdentity = vi.fn();
vi.mock('./identity-provider', () => ({
  NeonIdentityPort: class {
    currentIdentity = currentIdentity;
  },
}));
vi.mock('@visastack/db', () => ({
  resolveDatabaseUrl: () => {
    throw new Error('the database must not be touched before the identity checks pass');
  },
  createPooledDb: () => {
    throw new Error('the database must not be touched before the identity checks pass');
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('IDENTITY_PROVIDER', 'neon_auth');
});

describe('withSession with Neon Auth selected', () => {
  it('sends a visitor with no session to sign-in, never reaching WorkOS or the database', async () => {
    currentIdentity.mockResolvedValue(undefined);
    const { withSession } = await import('./session');
    const work = vi.fn();
    await expect(withSession(work)).rejects.toThrow('REDIRECT:/auth/sign-in');
    expect(work).not.toHaveBeenCalled();
  });

  it('sends an unconfirmed address to the confirmation page and gives it no account', async () => {
    currentIdentity.mockResolvedValue({
      providerId: 'neon-1',
      email: 'a@b.co',
      emailVerified: false,
    });
    const { withSession } = await import('./session');
    const work = vi.fn();
    await expect(withSession(work)).rejects.toThrow('REDIRECT:/auth/verify-email');
    expect(work).not.toHaveBeenCalled();
  });
});
