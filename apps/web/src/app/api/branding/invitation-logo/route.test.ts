import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../../../../lib/invitation-preview', () => ({ loadInvitationLogo: mocks.load }));

const { GET } = await import('./route');

const TOKEN = `${'Ab3_'.repeat(10)}Ab3`;
const call = (query: string) =>
  GET(new Request(`https://app.example.test/api/branding/invitation-logo${query}`));

beforeEach(() => mocks.load.mockReset());

describe('the public invitation logo route', () => {
  it('serves the picture inline, uncacheable by shared caches, and as nothing a browser may run', async () => {
    mocks.load.mockResolvedValue({
      state: 'found',
      bytes: new Uint8Array([137, 80, 78, 71]),
      contentType: 'image/png',
    });
    const response = await call(`?token=${TOKEN}&v=abc`);
    expect(response.status).toBe(200);
    expect(mocks.load).toHaveBeenCalledWith(TOKEN);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(response.headers.get('content-disposition')).toContain('inline');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it('gives the same plain 404 for a missing token, a badly formed one, a closed link or no logo', async () => {
    const bodies: string[] = [];
    for (const query of ['', '?token=short', `?token=${TOKEN}`]) {
      mocks.load.mockResolvedValue({ state: 'none' });
      const response = await call(query);
      expect(response.status).toBe(404);
      bodies.push(await response.text());
    }
    expect(new Set(bodies).size).toBe(1);
    // A badly formed token is never even looked up.
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it('refuses with a plain 429 when the address has asked too often', async () => {
    mocks.load.mockResolvedValue({ state: 'busy' });
    const response = await call(`?token=${TOKEN}`);
    expect(response.status).toBe(429);
  });
});
