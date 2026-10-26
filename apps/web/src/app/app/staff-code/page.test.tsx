import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  isPlatformAdmin: vi.fn(),
  getStaffFactorStatus: vi.fn(),
  isStaffFactorFresh: vi.fn(),
  revealPendingStaffEnrolment: vi.fn(),
  neonSessionRef: vi.fn(),
  createKeyManagementPort: vi.fn(),
}));

vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'staff@example.com' }),
}));
vi.mock('../../../lib/admin', () => ({
  isPlatformAdmin: mocks.isPlatformAdmin,
  bootstrapAdminEmails: () => [],
}));
vi.mock('../../../lib/neon-recency', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/neon-recency')>()),
  neonSessionRef: mocks.neonSessionRef,
}));
vi.mock('../../../lib/providers', () => ({
  createKeyManagementPort: mocks.createKeyManagementPort,
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getStaffFactorStatus: mocks.getStaffFactorStatus,
  isStaffFactorFresh: mocks.isStaffFactorFresh,
  revealPendingStaffEnrolment: mocks.revealPendingStaffEnrolment,
}));
vi.mock('./actions', () => ({
  startStaffEnrolmentAction: vi.fn(),
  verifyStaffCodeAction: vi.fn(),
  confirmStaffEnrolmentAction: vi.fn(),
  regenerateRecoveryCodesAction: vi.fn(),
}));

const { default: Page } = await import('./page');

const params = (value: Record<string, string> = {}) => ({
  searchParams: Promise.resolve(value),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isPlatformAdmin.mockResolvedValue(true);
  mocks.neonSessionRef.mockResolvedValue('ref-1');
  mocks.createKeyManagementPort.mockReturnValue({});
  mocks.isStaffFactorFresh.mockResolvedValue(false);
  mocks.getStaffFactorStatus.mockResolvedValue({ state: 'none' });
});

describe('the authenticator code page', () => {
  it('sends anyone who is not platform staff back to the app', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false);
    await expect(renderServer(Page(params()))).rejects.toThrow('NEXT_REDIRECT:/app');
  });

  it('offers to start setup when nothing is set up, in plain words', async () => {
    const text = textOf(await renderServer(Page(params())));
    expect(text).toContain('Set Up Your Authenticator App');
    expect(text).toContain('Start Setup');
    expect(text).not.toMatch(/TOTP|MFA|hash|step-up/i);
  });

  it('shows the picture to scan, the key to type, and the first code box while setup is pending', async () => {
    mocks.getStaffFactorStatus.mockResolvedValue({ state: 'pending' });
    mocks.revealPendingStaffEnrolment.mockResolvedValue({
      ok: true,
      value: {
        otpauthUri: 'otpauth://totp/VisaStack:staff%40example.com?secret=ABCDEFGH&issuer=VisaStack',
        manualKey: 'ABCD EFGH',
      },
    });
    const html = await renderServer(Page(params()));
    expect(html).toContain('<svg');
    expect(html).toContain('role="img"');
    expect(textOf(html)).toContain('ABCD EFGH');
    expect(textOf(html)).toContain('6 Digit Code From Your App');
    // The secret is never put in a link or an image address.
    expect(html).not.toContain('otpauth://');
  });

  it('asks for a code when set up but not yet proved in this sign-in', async () => {
    mocks.getStaffFactorStatus.mockResolvedValue({
      state: 'active',
      verifiedAt: null,
      recoveryCodesLeft: 10,
    });
    const text = textOf(await renderServer(Page(params({ returnTo: '/app/admin/access' }))));
    expect(text).toContain('Enter Your Authenticator Code');
    expect(text).toContain('backup code');
  });

  it('never loops back to itself: a return path to this page becomes the platform home', async () => {
    mocks.getStaffFactorStatus.mockResolvedValue({
      state: 'active',
      verifiedAt: null,
      recoveryCodesLeft: 10,
    });
    const html = await renderServer(Page(params({ returnTo: '/app/staff-code?x=1' })));
    expect(html).toContain('value="/app/admin"');
  });

  it('refuses an off-site return path', async () => {
    mocks.getStaffFactorStatus.mockResolvedValue({
      state: 'active',
      verifiedAt: null,
      recoveryCodesLeft: 10,
    });
    const html = await renderServer(Page(params({ returnTo: 'https://evil.example/x' })));
    expect(html).not.toContain('evil.example');
  });

  it('shows the error text for a wrong code and a lock', async () => {
    mocks.getStaffFactorStatus.mockResolvedValue({
      state: 'active',
      verifiedAt: null,
      recoveryCodesLeft: 10,
    });
    expect(textOf(await renderServer(Page(params({ e: 'wrong' }))))).toContain(
      'That code did not work',
    );
    expect(textOf(await renderServer(Page(params({ e: 'slow' }))))).toContain('Too many tries');
  });

  it('says so, and offers nothing else, when codes cannot be checked', async () => {
    mocks.getStaffFactorStatus.mockResolvedValue({ state: 'unavailable' });
    const text = textOf(await renderServer(Page(params())));
    expect(text).toContain('cannot be checked right now');
    expect(text).not.toContain('Start Setup');
  });

  it('shows the confirmed state, and backup code management only when asked', async () => {
    mocks.getStaffFactorStatus.mockResolvedValue({
      state: 'active',
      verifiedAt: new Date(),
      recoveryCodesLeft: 4,
    });
    mocks.isStaffFactorFresh.mockResolvedValue(true);
    expect(textOf(await renderServer(Page(params())))).toContain('You Are Confirmed');
    expect(textOf(await renderServer(Page(params({ manage: '1' }))))).toContain(
      'Make New Backup Codes',
    );
  });
});
