import { describe, expect, it, vi } from 'vitest';

/**
 * `WorkosIdentityPort` (master directive §7 "PR 11"): a thin, honest wrapper
 * over WorkOS AuthKit's `withAuth()` — mocked here the same way
 * step-up.test.ts mocks WorkOS's other entry points, so this exercises the
 * port's own mapping logic without a real WorkOS session.
 */

const withAuth = vi.fn();

vi.mock('@workos-inc/authkit-nextjs', () => ({
  withAuth: (...args: unknown[]) => withAuth(...args),
}));

describe('WorkosIdentityPort', () => {
  it('resolves the signed-in user into a ResolvedIdentity', async () => {
    withAuth.mockResolvedValue({
      user: { id: 'user_123', email: 'applicant@example.com', emailVerified: true },
    });
    const { WorkosIdentityPort } = await import('./identity-provider');
    const identity = await new WorkosIdentityPort().currentIdentity();
    expect(identity).toEqual({
      providerId: 'user_123',
      email: 'applicant@example.com',
      emailVerified: true,
    });
  });

  it('is undefined when no user is signed in', async () => {
    withAuth.mockResolvedValue({ user: null });
    const { WorkosIdentityPort } = await import('./identity-provider');
    expect(await new WorkosIdentityPort().currentIdentity()).toBeUndefined();
  });

  it('is undefined for a session with no email, matching withSession’s own guard', async () => {
    withAuth.mockResolvedValue({ user: { id: 'user_123', email: null, emailVerified: false } });
    const { WorkosIdentityPort } = await import('./identity-provider');
    expect(await new WorkosIdentityPort().currentIdentity()).toBeUndefined();
  });
});

describe('NeonIdentityPort', () => {
  const reader = (data: unknown) => () => ({ getSession: async () => ({ data }) }) as never;

  it('resolves a signed-in Neon user, passing the verification flag through', async () => {
    const { NeonIdentityPort } = await import('./identity-provider');
    const verified = await new NeonIdentityPort(
      reader({ user: { id: 'n_1', email: 'a@example.com', emailVerified: true } }),
    ).currentIdentity();
    expect(verified).toEqual({ providerId: 'n_1', email: 'a@example.com', emailVerified: true });
    const unverified = await new NeonIdentityPort(
      reader({ user: { id: 'n_2', email: 'b@example.com', emailVerified: false } }),
    ).currentIdentity();
    expect(unverified?.emailVerified).toBe(false);
  });

  it('treats a missing verification flag as not verified', async () => {
    const { NeonIdentityPort } = await import('./identity-provider');
    const identity = await new NeonIdentityPort(
      reader({ user: { id: 'n_3', email: 'c@example.com' } }),
    ).currentIdentity();
    expect(identity?.emailVerified).toBe(false);
  });

  it('is undefined when nobody is signed in or the user has no email', async () => {
    const { NeonIdentityPort } = await import('./identity-provider');
    expect(await new NeonIdentityPort(reader(null)).currentIdentity()).toBeUndefined();
    expect(
      await new NeonIdentityPort(reader({ user: { id: 'n_4', email: null } })).currentIdentity(),
    ).toBeUndefined();
  });
});
