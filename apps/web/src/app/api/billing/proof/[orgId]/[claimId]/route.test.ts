import { beforeEach, describe, expect, it, vi } from 'vitest';

const SIGN_IN = new Error('NEXT_REDIRECT /auth/sign-in');
const mocks = vi.hoisted(() => ({
  readClaimProofFile: vi.fn(),
  isPlatformOwnerAccount: vi.fn(),
  signedIn: true,
}));
vi.mock('@visastack/services', () => ({ readClaimProofFile: mocks.readClaimProofFile }));
vi.mock('../../../../../../lib/admin', () => ({
  isPlatformOwnerAccount: mocks.isPlatformOwnerAccount,
  bootstrapAdminEmails: () => ['boot@example.test'],
}));
vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string; email: string }) => unknown) => {
    // The real helper redirects anyone not signed in before any database work.
    if (!mocks.signedIn) throw SIGN_IN;
    return fn({ db: {}, accountId: 'acct-1', email: 'person@example.test' });
  },
}));
vi.mock('../../../../../../lib/storage', () => ({ createStorage: () => ({ storage: true }) }));

const { GET } = await import('./route');

const ORG = '11111111-2222-4333-8444-555555555555';
const CLAIM = '66666666-7777-4888-8999-000000000000';
const call = (orgId: string, claimId: string) =>
  GET(new Request(`https://example.test/api/billing/proof/${orgId}/${claimId}`), {
    params: Promise.resolve({ orgId, claimId }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signedIn = true;
  mocks.isPlatformOwnerAccount.mockResolvedValue(false);
});

describe('the payment proof route', () => {
  it('needs a signed-in person and reads nothing otherwise', async () => {
    mocks.signedIn = false;
    await expect(call(ORG, CLAIM)).rejects.toBe(SIGN_IN);
    expect(mocks.readClaimProofFile).not.toHaveBeenCalled();
  });

  it('asks the service about exactly this agency and report, for this person, with no staff standing', async () => {
    mocks.readClaimProofFile.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect((await call(ORG, CLAIM)).status).toBe(404);
    expect(mocks.readClaimProofFile).toHaveBeenCalledWith(
      {},
      { storage: true },
      { actorAccountId: 'acct-1', organizationId: ORG, claimId: CLAIM },
    );
  });

  it('passes the staff standing only for a platform owner', async () => {
    mocks.isPlatformOwnerAccount.mockResolvedValue(true);
    mocks.readClaimProofFile.mockResolvedValue({ ok: false, error: { code: 'not_found' } });
    await call(ORG, CLAIM);
    expect(mocks.readClaimProofFile.mock.calls[0]?.[2]).toEqual({
      actorAccountId: 'acct-1',
      organizationId: ORG,
      claimId: CLAIM,
      actorEmail: 'person@example.test',
      bootstrapEmails: ['boot@example.test'],
    });
  });

  it('serves the file as a private download the browser may not sniff or run, never cached', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2]);
    mocks.readClaimProofFile.mockResolvedValue({
      ok: true,
      value: { bytes, contentType: 'application/pdf' },
    });
    const response = await call(ORG, CLAIM);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-length')).toBe('7');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="proof-of-payment.pdf"',
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it('gives the same private not-found answer for a refusal, a missing file and a malformed id', async () => {
    mocks.readClaimProofFile.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const refused = await call(ORG, CLAIM);
    expect(refused.status).toBe(404);
    expect(refused.headers.get('cache-control')).toBe('private, no-store');
    mocks.readClaimProofFile.mockClear();
    for (const [org, claim] of [
      ['../../etc/passwd', CLAIM],
      [ORG, 'AAAAAAAA-2222-4333-8444-555555555555'],
      ['x', 'y'],
    ] as const) {
      expect((await call(org, claim)).status).toBe(404);
    }
    expect(mocks.readClaimProofFile).not.toHaveBeenCalled();
  });
});
