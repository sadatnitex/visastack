import { describe, expect, it, vi } from 'vitest';

// The real sign-in packages are not needed here: each test hands in its own session reader.

const reported = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('./server-error', () => ({
  reportServerError: (...args: unknown[]) => {
    reported.calls.push(args);
  },
}));

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

  it("hands Next's own signals back to Next instead of reporting them as failures", async () => {
    const { redirect } = await import('next/navigation');
    const signal = {
      currentIdentity: async () => {
        redirect('/auth/sign-in');
      },
    };
    await expect(isSignedIn(signal)).rejects.toThrow('NEXT_REDIRECT');
  });

  it("reads Next's refusal to set a cookie while a page is drawn as signed out, without reporting it", async () => {
    reported.calls.length = 0;
    // The shape Next throws (ReadonlyRequestCookiesError), directly and wrapped by the sign-in package.
    const refusal = new Error(
      'Cookies can only be modified in a Server Action or Route Handler. Read more: https://nextjs.org/docs/app/api-reference/functions/cookies#options',
    );
    for (const thrown of [refusal, new Error('session refresh failed', { cause: refusal })]) {
      const reader = {
        currentIdentity: async () => {
          throw thrown;
        },
      };
      expect(await isSignedIn(reader)).toBe(false);
    }
    expect(reported.calls).toEqual([]);
  });

  it('still reports every other failure', async () => {
    reported.calls.length = 0;
    const reader = {
      currentIdentity: async () => {
        throw new Error('Cookies are broken in another way');
      },
    };
    expect(await isSignedIn(reader)).toBe(false);
    expect(reported.calls).toHaveLength(1);
  });
});
