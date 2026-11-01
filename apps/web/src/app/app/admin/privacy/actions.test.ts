import { beforeEach, describe, expect, it, vi } from 'vitest';

/** WP-SB7: the picker's server search keeps the privacy page's own role check. */

const mocks = vi.hoisted(() => ({
  isPlatformAdmin: vi.fn(),
  staffPrincipal: vi.fn(),
  listAllApplicants: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { tag: 'db' }, accountId: 'acct-1', email: 'admin@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  isPlatformAdmin: (...args: unknown[]) => mocks.isPlatformAdmin(...args),
  staffPrincipal: (...args: unknown[]) => mocks.staffPrincipal(...args),
  bootstrapAdminEmails: () => ['boot@example.com'],
}));
vi.mock('@visastack/services', () => ({
  listAllApplicants: (...args: unknown[]) => mocks.listAllApplicants(...args),
}));

const { searchApplicantsAction } = await import('./actions');

const SCOPE = { kind: 'staff', action: 'APPLICANT_DIRECTORY_VIEW' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isPlatformAdmin.mockResolvedValue(true);
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: SCOPE });
  mocks.listAllApplicants.mockResolvedValue({
    ok: true,
    value: [{ id: 'ap1', displayName: 'Rahim Uddin', ownerAccountId: 'leak' }],
  });
});

describe('searchApplicantsAction', () => {
  it('searches with the applicant directory permission and returns only ids and names', async () => {
    const result = await searchApplicantsAction(`  Rahim ${'x'.repeat(200)}`);
    expect(mocks.staffPrincipal).toHaveBeenCalledWith(
      { tag: 'db' },
      { accountId: 'acct-1', email: 'admin@example.com', bootstrapEmails: ['boot@example.com'] },
      'APPLICANT_DIRECTORY_VIEW',
    );
    const [, scope, query] = mocks.listAllApplicants.mock.calls[0] ?? [];
    expect(scope).toBe(SCOPE);
    expect((query as { search: string }).search).toHaveLength(100);
    expect(result).toEqual({ ok: true, matches: [{ id: 'ap1', displayName: 'Rahim Uddin' }] });
  });

  it('refuses a non-administrator and a role without the directory, reading nothing', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false);
    expect(await searchApplicantsAction('Rahim')).toEqual({
      ok: false,
      message: 'Not authorized.',
    });
    mocks.isPlatformAdmin.mockResolvedValue(true);
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect(await searchApplicantsAction('Rahim')).toEqual({
      ok: false,
      message: 'Not authorized.',
    });
    expect(mocks.listAllApplicants).not.toHaveBeenCalled();
  });

  it('treats anything that is not text as an empty search', async () => {
    await searchApplicantsAction({ toString: () => 'Rahim' });
    expect(mocks.listAllApplicants).toHaveBeenCalledWith({ tag: 'db' }, SCOPE, { search: '' });
  });
});
