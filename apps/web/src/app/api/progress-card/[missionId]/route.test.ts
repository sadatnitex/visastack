import { beforeEach, describe, expect, it, vi } from 'vitest';

const SIGN_IN = new Error('NEXT_REDIRECT /auth/sign-in');
const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  readCaseProgressCounts: vi.fn(),
  signedIn: true,
}));
vi.mock('@visastack/services', () => ({
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess: mocks.requireAccess,
  readCaseProgressCounts: mocks.readCaseProgressCounts,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) => {
    // The real helper redirects anyone not signed in before any database work.
    if (!mocks.signedIn) throw SIGN_IN;
    return fn({ db: {}, accountId: 'acct-1' });
  },
}));

const { GET } = await import('./route');

const CASE = '11111111-2222-4333-8444-555555555555';
const call = (id: string) =>
  GET(new Request(`https://example.test/api/progress-card/${id}`), {
    params: Promise.resolve({ missionId: id }),
  });
const PROOF = { proof: true };
const COUNTS = {
  missionId: CASE,
  satisfiedRequired: 8,
  requiredCount: 12,
  destination: 'Japan',
  finished: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signedIn = true;
  vi.stubEnv('PROGRESS_CARD', 'on');
  mocks.requireAccess.mockResolvedValue({ ok: true, value: PROOF });
  mocks.readCaseProgressCounts.mockResolvedValue({ ok: true, value: COUNTS });
});

async function expectPrivateNotFound(response: Response) {
  expect(response.status).toBe(404);
  expect(await response.text()).toBe('not found');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  expect(response.headers.get('content-type')).not.toMatch(/image/);
}

describe('the progress card route', () => {
  it('answers like an unknown page while the switch is off, before any sign-in or database work', async () => {
    for (const value of ['', 'off', 'false', '0']) {
      vi.stubEnv('PROGRESS_CARD', value);
      mocks.signedIn = false;
      await expectPrivateNotFound(await call(CASE));
    }
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.readCaseProgressCounts).not.toHaveBeenCalled();
  });

  it('needs a signed-in person and reads nothing otherwise', async () => {
    mocks.signedIn = false;
    await expect(call(CASE)).rejects.toBe(SIGN_IN);
    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });

  it('asks the access gate about exactly this case, for this person, to view it', async () => {
    await call(CASE);
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'acct-1' },
      'VIEW_METADATA',
      { missionId: CASE },
      { purpose: 'self' },
    );
    expect(mocks.readCaseProgressCounts).toHaveBeenCalledWith(PROOF);
  });

  it('gives the same private not-found for a refusal, a non-owner, no checklist and a malformed id', async () => {
    mocks.requireAccess.mockResolvedValueOnce({ ok: false, error: { code: 'not_found' } });
    await expectPrivateNotFound(await call(CASE));
    // An agency member or a person the record is shared with passes the gate but not the owner check.
    mocks.readCaseProgressCounts.mockResolvedValueOnce({ ok: false, error: { code: 'not_found' } });
    await expectPrivateNotFound(await call(CASE));
    mocks.requireAccess.mockClear();
    for (const id of ['../../etc/passwd', 'AAAAAAAA-2222-4333-8444-555555555555', 'x']) {
      await expectPrivateNotFound(await call(id));
    }
    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });

  it('draws the owner a private PNG that is never kept in a cache and cannot be embedded by other sites', async () => {
    const response = await call(CASE);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('content-disposition')).toMatch(/^inline/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }, 60_000);
});
