import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ readOrganizationLogo: vi.fn() }));
vi.mock('@visastack/services', () => ({ readOrganizationLogo: mocks.readOrganizationLogo }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'acct-1' }),
}));
vi.mock('../../../../../lib/storage', () => ({ createStorage: () => ({}) }));

const { GET } = await import('./route');

const ORG = '11111111-2222-3333-4444-555555555555';
const call = (orgId: string) =>
  GET(new Request(`https://example.test/api/branding/logo/${orgId}`), {
    params: Promise.resolve({ orgId }),
  });

beforeEach(() => vi.clearAllMocks());

describe('the agency logo route', () => {
  it('serves the stored image with its own type, inline, and with every protective header', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    mocks.readOrganizationLogo.mockResolvedValue({ bytes, contentType: 'image/png' });
    const response = await call(ORG);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe('7');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('content-disposition')).toMatch(/^inline/);
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(mocks.readOrganizationLogo.mock.calls[0]?.[2]).toBe(ORG);
  });

  it('says not found for an organization with no logo, and refuses a malformed id before reading anything', async () => {
    mocks.readOrganizationLogo.mockResolvedValue(undefined);
    expect((await call(ORG)).status).toBe(404);
    mocks.readOrganizationLogo.mockClear();
    expect((await call('../../etc/passwd')).status).toBe(404);
    expect(mocks.readOrganizationLogo).not.toHaveBeenCalled();
  });
});
