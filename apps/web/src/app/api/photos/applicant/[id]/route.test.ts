import { beforeEach, describe, expect, it, vi } from 'vitest';

const SIGN_IN = new Error('NEXT_REDIRECT /auth/sign-in');
const mocks = vi.hoisted(() => ({
  readApplicantPhoto: vi.fn(),
  photoAccess: vi.fn(),
  signedIn: true,
}));
vi.mock('@visastack/services', () => ({ readApplicantPhoto: mocks.readApplicantPhoto }));
vi.mock('../../../../../lib/profile-photos', () => ({ photoAccess: mocks.photoAccess }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) => {
    // The real helper redirects anyone not signed in before any database work.
    if (!mocks.signedIn) throw SIGN_IN;
    return fn({ db: {}, accountId: 'acct-1' });
  },
}));
vi.mock('../../../../../lib/storage', () => ({ createStorage: () => ({}) }));

const { GET } = await import('./route');

const APPLICANT = '11111111-2222-4333-8444-555555555555';
const call = (id: string) =>
  GET(new Request(`https://example.test/api/photos/applicant/${id}?v=abc`), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signedIn = true;
});

describe('the profile photo route', () => {
  it('needs a signed-in person and reads nothing otherwise', async () => {
    mocks.signedIn = false;
    await expect(call(APPLICANT)).rejects.toBe(SIGN_IN);
    expect(mocks.photoAccess).not.toHaveBeenCalled();
    expect(mocks.readApplicantPhoto).not.toHaveBeenCalled();
  });

  it('asks the access gate about exactly this record, for this person, to view it', async () => {
    mocks.photoAccess.mockResolvedValue(null);
    expect((await call(APPLICANT)).status).toBe(404);
    expect(mocks.photoAccess).toHaveBeenCalledWith({}, 'acct-1', APPLICANT, 'VIEW_METADATA');
    expect(mocks.readApplicantPhoto).not.toHaveBeenCalled();
  });

  it('serves the photo as a private, unsniffable inline JPEG that is never stored in a cache', async () => {
    const proof = { proof: true };
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]);
    mocks.photoAccess.mockResolvedValue(proof);
    mocks.readApplicantPhoto.mockResolvedValue({
      ok: true,
      value: { bytes, contentType: 'image/jpeg', version: 'abc' },
    });
    const response = await call(APPLICANT);
    expect(response.status).toBe(200);
    expect(mocks.readApplicantPhoto.mock.calls[0]?.[0]).toBe(proof);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('content-length')).toBe('7');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(response.headers.get('content-disposition')).toMatch(/^inline/);
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it('gives the same private not-found answer for a refusal, a missing photo and a malformed id', async () => {
    mocks.photoAccess.mockResolvedValue({ proof: true });
    mocks.readApplicantPhoto.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const refused = await call(APPLICANT);
    expect(refused.status).toBe(404);
    expect(refused.headers.get('cache-control')).toBe('private, no-store');
    mocks.readApplicantPhoto.mockResolvedValue({ ok: false, error: { code: 'not_found' } });
    expect((await call(APPLICANT)).status).toBe(404);
    mocks.photoAccess.mockClear();
    for (const id of ['../../etc/passwd', 'AAAAAAAA-2222-4333-8444-555555555555', 'x']) {
      expect((await call(id)).status).toBe(404);
    }
    expect(mocks.photoAccess).not.toHaveBeenCalled();
  });
});
