import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasAnyPlatformRole: vi.fn(),
  isPlatformOwner: vi.fn(),
  canPerformPlatformAction: vi.fn(),
  mintStaffScope: vi.fn(),
  proved: vi.fn(),
}));

vi.mock('@visastack/services', () => ({
  hasAnyPlatformRole: mocks.hasAnyPlatformRole,
  isPlatformOwner: mocks.isPlatformOwner,
  canPerformPlatformAction: mocks.canPerformPlatformAction,
  staffPrincipal: mocks.mintStaffScope,
}));
vi.mock('./staff-factor', () => ({ staffFactorProvedForSignIn: mocks.proved }));

const {
  isPlatformAdmin,
  isPlatformOwnerAccount,
  hasPlatformPermission,
  holdsPlatformRole,
  staffPrincipal,
} = await import('./admin');

const ctx = { accountId: 'acct-1', email: 'staff@example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasAnyPlatformRole.mockResolvedValue(true);
  mocks.isPlatformOwner.mockResolvedValue(true);
  mocks.canPerformPlatformAction.mockResolvedValue(true);
  mocks.mintStaffScope.mockResolvedValue({ ok: true, value: { kind: 'staff' } });
  mocks.proved.mockResolvedValue(true);
});

describe('every platform check also needs the authenticator proof (S3)', () => {
  it('passes only when the role is held and the code was proved in this sign-in', async () => {
    expect(await isPlatformAdmin({} as never, ctx)).toBe(true);
    expect(await isPlatformOwnerAccount({} as never, ctx)).toBe(true);
    expect(await hasPlatformPermission({} as never, ctx, 'AUDIT_TRAIL_VIEW')).toBe(true);
    const scope = await staffPrincipal(
      {} as never,
      { ...ctx, bootstrapEmails: [] },
      'AUDIT_TRAIL_VIEW',
    );
    expect(scope.ok).toBe(true);
  });

  it('refuses all of them when the code was not proved, even for a role holder', async () => {
    mocks.proved.mockResolvedValue(false);
    expect(await isPlatformAdmin({} as never, ctx)).toBe(false);
    expect(await isPlatformOwnerAccount({} as never, ctx)).toBe(false);
    expect(await hasPlatformPermission({} as never, ctx, 'AUDIT_TRAIL_VIEW')).toBe(false);
    const scope = await staffPrincipal(
      {} as never,
      { ...ctx, bootstrapEmails: [] },
      'AUDIT_TRAIL_VIEW',
    );
    expect(scope.ok).toBe(false);
    // The navigation entry still knows the person is staff, so it can send them to the code page.
    expect(await holdsPlatformRole({} as never, ctx)).toBe(true);
  });

  it('never asks for the proof from someone who does not hold the role', async () => {
    mocks.hasAnyPlatformRole.mockResolvedValue(false);
    mocks.isPlatformOwner.mockResolvedValue(false);
    mocks.canPerformPlatformAction.mockResolvedValue(false);
    mocks.mintStaffScope.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'x' },
    });
    expect(await isPlatformAdmin({} as never, ctx)).toBe(false);
    expect(await isPlatformOwnerAccount({} as never, ctx)).toBe(false);
    expect(await hasPlatformPermission({} as never, ctx, 'AUDIT_TRAIL_VIEW')).toBe(false);
    expect(
      (await staffPrincipal({} as never, { ...ctx, bootstrapEmails: [] }, 'AUDIT_TRAIL_VIEW')).ok,
    ).toBe(false);
    expect(mocks.proved).not.toHaveBeenCalled();
  });
});
