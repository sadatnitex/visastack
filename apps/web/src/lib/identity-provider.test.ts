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
