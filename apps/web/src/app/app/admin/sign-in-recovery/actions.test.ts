import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  connectSignInToAccount: vi.fn(),
  tryEstablishStepUp: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  connectSignInToAccount: mocks.connectSignInToAccount,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-admin', email: 'admin@example.com' }),
}));
vi.mock('../../../../lib/admin', () => ({
  bootstrapAdminEmails: () => [],
  staffPrincipal: mocks.staffPrincipal,
}));
vi.mock('../../../../lib/step-up', () => ({
  tryEstablishStepUp: mocks.tryEstablishStepUp,
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'Step-up is not configured here.',
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
import { SIGN_IN_RECOVERY_REFUSED } from '@visastack/services';
import { connectSignInAction } from './actions';

const SCOPE = { kind: 'staff', platformAction: 'ACCOUNT_SIGN_IN_RECOVERY' };
const INITIAL = { ok: true, message: '' };
const ACCOUNT = '3b85b469-4d6f-4d94-8eeb-bab0e47fde42';
const stepUpNeeded = { ok: false, error: { code: 'step_up_required', message: 'x' } };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ accountId: ACCOUNT, ...fields })) {
    data.set(key, value);
  }
  return data;
}

beforeEach(() => {
  mocks.staffPrincipal.mockResolvedValue({ ok: true, value: SCOPE });
  mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'satisfied' });
});
afterEach(() => {
  vi.resetAllMocks();
});

describe('connectSignInAction', () => {
  it('needs the confirmation tick and a reason before anything else runs', async () => {
    const unconfirmed = await connectSignInAction(INITIAL, form({ reason: 'called them' }));
    expect(unconfirmed.ok).toBe(false);
    const noReason = await connectSignInAction(INITIAL, form({ confirmed: 'yes', reason: ' ' }));
    expect(noReason).toMatchObject({ ok: false, field: 'reason' });
    expect(mocks.staffPrincipal).not.toHaveBeenCalled();
    expect(mocks.connectSignInToAccount).not.toHaveBeenCalled();
  });

  it('refuses staff without the sign-in recovery permission', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const result = await connectSignInAction(
      INITIAL,
      form({ confirmed: 'yes', reason: 'called them' }),
    );
    expect(result.message).toContain('security admin or platform owner');
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('ACCOUNT_SIGN_IN_RECOVERY');
    expect(mocks.connectSignInToAccount).not.toHaveBeenCalled();
  });

  it('asks for a fresh sign-in check, then connects with the same staff and owner input', async () => {
    mocks.connectSignInToAccount
      .mockResolvedValueOnce(stepUpNeeded)
      .mockResolvedValueOnce({ ok: true, value: { accountId: ACCOUNT } });
    const result = await connectSignInAction(
      INITIAL,
      form({ confirmed: 'yes', reason: 'called them' }),
    );
    expect(result.ok).toBe(true);
    expect(mocks.tryEstablishStepUp).toHaveBeenCalledWith(
      { accountId: 'synthetic-admin', action: 'ACCOUNT_SIGN_IN_RECOVERY', resourceId: ACCOUNT },
      '/app/admin/sign-in-recovery',
    );
    expect(mocks.connectSignInToAccount.mock.calls[1]?.[2]).toEqual({
      accountId: ACCOUNT,
      reason: 'called them',
      owner: { accountId: 'synthetic-admin', email: 'admin@example.com', bootstrapEmails: [] },
      stepUpSatisfied: true,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/admin/sign-in-recovery');
  });

  it('sends a stale session to the password re-check', async () => {
    mocks.connectSignInToAccount.mockResolvedValue(stepUpNeeded);
    mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'reauth_required', reauthUrl: '/re' });
    await expect(
      connectSignInAction(INITIAL, form({ confirmed: 'yes', reason: 'called them' })),
    ).rejects.toThrow('NEXT_REDIRECT:/re');
  });

  it('explains each refusal in plain words', async () => {
    for (const message of Object.values(SIGN_IN_RECOVERY_REFUSED)) {
      mocks.connectSignInToAccount.mockResolvedValueOnce({
        ok: false,
        error: { code: 'invalid', message },
      });
      const result = await connectSignInAction(
        INITIAL,
        form({ confirmed: 'yes', reason: 'called them' }),
      );
      expect(result.ok).toBe(false);
      expect(result.message).not.toBe(message);
      expect(result.message).toMatch(/^[A-Z]/);
    }
  });
});
