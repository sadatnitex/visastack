import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => ({
  read: (_name: string): { value: string } | undefined => undefined,
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: jar.read }) }));
const { hasSeenVersionNotice } = await import('./version-notice-state');

beforeEach(() => {
  jar.read = () => undefined;
});

describe('whether the root layout shows the notice about this version in full', () => {
  it('shows it without the cookie, and folds it away only for the exact word', async () => {
    expect(await hasSeenVersionNotice()).toBe(false);
    jar.read = (name) => (name === 'visastack_notice' ? { value: 'seen' } : undefined);
    expect(await hasSeenVersionNotice()).toBe(true);
    jar.read = () => ({ value: 'nonsense' });
    expect(await hasSeenVersionNotice()).toBe(false);
  });

  it('shows it, and never throws, when there is no request to read', async () => {
    jar.read = () => {
      throw new Error('cookies was called outside a request scope');
    };
    expect(await hasSeenVersionNotice()).toBe(false);
  });

  it("hands Next's own signals back unchanged, so a page is never frozen with the wrong answer", async () => {
    const signal = Object.assign(new Error('Dynamic server usage'), {
      digest: 'DYNAMIC_SERVER_USAGE',
    });
    jar.read = () => {
      throw signal;
    };
    await expect(hasSeenVersionNotice()).rejects.toBe(signal);
  });
});
