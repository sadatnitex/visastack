import { describe, expect, it, vi } from 'vitest';
import { magicLinkSignIn, signInLinksEnabled } from './sign-in-links';

describe('signInLinksEnabled', () => {
  it('is on only for "on"', () => {
    expect(signInLinksEnabled(() => undefined)).toBe(false);
    expect(signInLinksEnabled(() => 'true')).toBe(false);
    expect(signInLinksEnabled(() => ' ON ')).toBe(true);
  });
});

describe('magicLinkSignIn', () => {
  it("finds Neon Auth's link sender on its endpoint proxy and keeps its this", async () => {
    const calls: unknown[] = [];
    const signIn = new Proxy(
      {},
      {
        get: (_target, prop) =>
          prop === 'magicLink'
            ? async (args: unknown) => {
                calls.push(args);
                return { error: null };
              }
            : undefined,
      },
    );
    const send = magicLinkSignIn({ signIn });
    expect(send).not.toBeNull();
    await send?.({ email: 'a@b.c', callbackURL: 'x', errorCallbackURL: 'y' });
    expect(calls).toHaveLength(1);
  });

  it('is null when the sender is missing', () => {
    expect(magicLinkSignIn(null)).toBeNull();
    expect(magicLinkSignIn({})).toBeNull();
    expect(magicLinkSignIn({ signIn: { email: vi.fn() } })).toBeNull();
  });
});
