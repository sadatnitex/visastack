import { describe, expect, it, vi } from 'vitest';

vi.mock('@workos-inc/authkit-nextjs', () => ({
  withAuth: vi.fn(async () => {
    throw new Error('WorkOS must not be consulted when Neon Auth is selected');
  }),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

describe('withSession with Neon Auth selected', () => {
  it('refuses to run until account linking exists, and never reaches WorkOS or the database', async () => {
    vi.stubEnv('IDENTITY_PROVIDER', 'neon_auth');
    const { withSession } = await import('./session');
    const work = vi.fn();
    await expect(withSession(work)).rejects.toThrow(/not linked to accounts yet/);
    expect(work).not.toHaveBeenCalled();
  });
});
