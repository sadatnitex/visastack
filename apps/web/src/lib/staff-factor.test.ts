import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  withSession: vi.fn(),
  isPlatformAdmin: vi.fn(),
  neonSessionRef: vi.fn(),
  getStaffFactorStatus: vi.fn(),
  isStaffFactorFresh: vi.fn(),
}));

vi.mock('./session', () => ({ withSession: mocks.withSession }));
vi.mock('./admin', () => ({ isPlatformAdmin: mocks.isPlatformAdmin }));
vi.mock('./neon-recency', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./neon-recency')>()),
  neonSessionRef: mocks.neonSessionRef,
  neonSessionAgeSeconds: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  STAFF_FACTOR_FRESH_MS: 300_000,
  getStaffFactorStatus: mocks.getStaffFactorStatus,
  isStaffFactorFresh: mocks.isStaffFactorFresh,
}));

const { staffFactorGate, staffFactorMode, staffCodeUrl } = await import('./staff-factor');

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function setMode(value: string | undefined): void {
  setEnv('STAFF_SECOND_FACTOR', value);
}

beforeEach(() => {
  vi.clearAllMocks();
  setMode('required');
  mocks.withSession.mockImplementation(async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'staff@example.com' }),
  );
  mocks.isPlatformAdmin.mockResolvedValue(true);
  mocks.neonSessionRef.mockResolvedValue('ref-1');
  mocks.getStaffFactorStatus.mockResolvedValue({
    state: 'active',
    verifiedAt: new Date(),
    recoveryCodesLeft: 10,
  });
  mocks.isStaffFactorFresh.mockResolvedValue(true);
});

describe('the staff authenticator mode', () => {
  it('is off when unset, empty or off, and required for anything else', () => {
    for (const value of [undefined, '', 'off', 'OFF', ' off ']) {
      setMode(value);
      expect(staffFactorMode()).toBe('off');
    }
    for (const value of ['required', 'REQUIRED', 'on', 'true', 'of', 'offf']) {
      setMode(value);
      expect(staffFactorMode()).toBe('required');
    }
  });
});

describe('the staff authenticator gate', () => {
  it('lets everything through while the rule is off, without reading anything', async () => {
    setMode(undefined);
    expect(await staffFactorGate('acct-1', '/app/admin')).toEqual({ kind: 'ok' });
    expect(mocks.withSession).not.toHaveBeenCalled();
  });

  it('does not ask people who hold no platform role', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false);
    expect(await staffFactorGate('acct-1', '/app/privacy')).toEqual({ kind: 'ok' });
    expect(mocks.getStaffFactorStatus).not.toHaveBeenCalled();
  });

  it('lets staff through with a code proved in this sign-in', async () => {
    expect(await staffFactorGate('acct-1', '/app/admin')).toEqual({ kind: 'ok' });
    expect(mocks.isStaffFactorFresh).toHaveBeenCalledWith(
      {},
      { accountId: 'acct-1', sessionRef: 'ref-1', maxAgeMs: 300_000 },
    );
  });

  it('asks for any age of proof only when told to (opening the platform area)', async () => {
    await staffFactorGate('acct-1', '/app/admin', { anyAge: true });
    expect(mocks.isStaffFactorFresh).toHaveBeenCalledWith(
      {},
      { accountId: 'acct-1', sessionRef: 'ref-1', maxAgeMs: null },
    );
  });

  it('sends staff without a fresh proof to the code page, with a safe return path', async () => {
    mocks.isStaffFactorFresh.mockResolvedValue(false);
    expect(await staffFactorGate('acct-1', '/app/admin/access')).toEqual({
      kind: 'redirect',
      url: staffCodeUrl('/app/admin/access'),
    });
    expect(staffCodeUrl('https://evil.example')).toBe('/app/staff-code?returnTo=%2Fapp');
    expect(staffCodeUrl('//evil.example')).toBe('/app/staff-code?returnTo=%2Fapp');
  });

  it('sends staff who have not set the app up, or are halfway, to the same page', async () => {
    for (const state of ['none', 'pending'] as const) {
      mocks.getStaffFactorStatus.mockResolvedValue({ state });
      expect((await staffFactorGate('acct-1', '/app/admin')).kind).toBe('redirect');
    }
    expect(mocks.isStaffFactorFresh).not.toHaveBeenCalled();
  });

  it('fails closed when the table is missing, there is no readable sign-in, or the account differs', async () => {
    mocks.getStaffFactorStatus.mockResolvedValue({ state: 'unavailable' });
    expect(await staffFactorGate('acct-1', '/app/admin')).toEqual({ kind: 'unavailable' });
    mocks.getStaffFactorStatus.mockResolvedValue({
      state: 'active',
      verifiedAt: null,
      recoveryCodesLeft: 1,
    });
    mocks.neonSessionRef.mockResolvedValue(null);
    expect(await staffFactorGate('acct-1', '/app/admin')).toEqual({ kind: 'unavailable' });
    mocks.neonSessionRef.mockResolvedValue('ref-1');
    expect(await staffFactorGate('someone-else', '/app/admin')).toEqual({ kind: 'unavailable' });
  });
});
