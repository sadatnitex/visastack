import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ fail: null as Error | null, nonce: 'abc' as string | null }));
vi.mock('next/headers', () => ({
  headers: async () => {
    if (state.fail) throw state.fail;
    return new Headers(state.nonce ? { 'x-nonce': state.nonce } : {});
  },
}));

const { ScenesBoot, requestNonce } = await import('./scenes-boot');

describe('the early scenes mark outside a request', () => {
  it("reads this request's nonce", async () => {
    state.fail = null;
    state.nonce = 'abc';
    expect(await requestNonce()).toBe('abc');
    expect(await ScenesBoot()).not.toBeNull();
  });
  it('renders nothing with no request to read (unit tests, static renders)', async () => {
    state.fail = new Error('`headers` was called outside a request scope.');
    expect(await requestNonce()).toBe(null);
    expect(await ScenesBoot()).toBeNull();
  });
  it("lets Next's own signals travel on", async () => {
    state.fail = new Error('NEXT_REDIRECT;replace;/x');
    (state.fail as Error & { digest?: string }).digest = 'NEXT_REDIRECT;replace;/x;307;';
    await expect(requestNonce()).rejects.toThrow(/NEXT_REDIRECT/);
    state.fail = null;
  });
  it('renders nothing without a nonce', async () => {
    state.nonce = null;
    expect(await ScenesBoot()).toBeNull();
    state.nonce = 'abc';
  });
});
