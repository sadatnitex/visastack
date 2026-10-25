import { describe, expect, it } from 'vitest';

describe('NeonIdentityPort', () => {
  const reader = (data: unknown) => () => ({ getSession: async () => ({ data }) }) as never;

  it('passes a multiword Neon account name as display metadata without using it for identity binding', async () => {
    const { NeonIdentityPort } = await import('./identity-provider');
    const identity = await new NeonIdentityPort(
      reader({
        user: {
          id: 'n_name',
          name: 'Synthetic Noor Agency Owner',
          email: 'name@example.test',
          emailVerified: true,
        },
      }),
    ).currentIdentity();
    expect(identity?.displayName).toBe('Synthetic Noor Agency Owner');
    expect(identity?.providerId).toBe('n_name');
  });
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
