import { describe, expect, it } from 'vitest';

// The real sign-in packages are not needed here: each test hands in its own session reader.

const { isSignedIn } = await import('./signed-in');

describe('isSignedIn', () => {
  it('is true when the sign-in system knows who the visitor is', async () => {
    expect(await isSignedIn({ currentIdentity: async () => ({ email: 'a@example.test' }) })).toBe(
      true,
    );
  });

  it('is false when nobody is signed in', async () => {
    expect(await isSignedIn({ currentIdentity: async () => undefined })).toBe(false);
  });

  it('is false, never an error, when the session cannot be read', async () => {
    const broken = {
      currentIdentity: async () => {
        throw new Error('provider unreachable');
      },
    };
    expect(await isSignedIn(broken)).toBe(false);
  });
});
