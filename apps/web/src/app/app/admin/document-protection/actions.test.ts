import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  staffPrincipal: vi.fn(),
  setDocumentProtection: vi.fn(),
  tryEstablishStepUp: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  setDocumentProtection: mocks.setDocumentProtection,
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
import { setDocumentProtectionAction } from './actions';

const SCOPE = { kind: 'staff', platformAction: 'DOCUMENT_PROTECTION_MANAGE' };
const INITIAL = { ok: true, message: '' };
const changed = {
  ok: true,
  value: {
    changed: true,
    confirmationRequired: false,
    restrictedBefore: true,
    restrictedAfter: false,
  },
};
const stepUpNeeded = { ok: false, error: { code: 'step_up_required', message: 'x' } };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ scope: 'CATEGORY', key: 'medical', ...fields })) {
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

describe('setDocumentProtectionAction', () => {
  it('refuses anyone without the document protection permission', async () => {
    mocks.staffPrincipal.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const result = await setDocumentProtectionAction(INITIAL, form({ choice: 'on' }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('security admin or platform owner');
    expect(mocks.staffPrincipal.mock.calls[0]?.[2]).toBe('DOCUMENT_PROTECTION_MANAGE');
    expect(mocks.setDocumentProtection).not.toHaveBeenCalled();
  });

  it('will not turn protection off until the admin confirms', async () => {
    const result = await setDocumentProtectionAction(INITIAL, form({ choice: 'off' }));
    expect(result).toEqual({
      ok: false,
      message: 'Confirm that you want to turn this protection off.',
    });
    expect(mocks.staffPrincipal).not.toHaveBeenCalled();
    expect(mocks.setDocumentProtection).not.toHaveBeenCalled();
  });

  it('asks for a fresh sign-in check, then turns protection off', async () => {
    mocks.setDocumentProtection.mockResolvedValueOnce(stepUpNeeded).mockResolvedValueOnce(changed);
    const result = await setDocumentProtectionAction(
      INITIAL,
      form({ choice: 'off', confirmed: 'yes', reason: 'Agencies asked for it' }),
    );
    expect(result).toEqual({
      ok: true,
      message: 'Saved. These documents now open without a fresh sign-in check.',
    });
    expect(mocks.setDocumentProtection.mock.calls.map((call) => call[2])).toEqual([
      {
        scope: 'CATEGORY',
        key: 'medical',
        restricted: false,
        removalConfirmed: true,
        reason: 'Agencies asked for it',
        stepUpSatisfied: false,
      },
      {
        scope: 'CATEGORY',
        key: 'medical',
        restricted: false,
        removalConfirmed: true,
        reason: 'Agencies asked for it',
        stepUpSatisfied: true,
      },
    ]);
    expect(mocks.tryEstablishStepUp.mock.calls[0]).toEqual([
      {
        accountId: 'synthetic-admin',
        action: 'DOCUMENT_PROTECTION_CHANGE',
        resourceId: 'CATEGORY:medical',
      },
      '/app/admin/document-protection',
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/admin/document-protection');
  });

  it('tells the admin to reload when a stale page resets a switch that now removes protection', async () => {
    mocks.setDocumentProtection.mockResolvedValue({
      ok: true,
      value: {
        changed: false,
        confirmationRequired: true,
        restrictedBefore: true,
        restrictedAfter: false,
      },
    });
    const result = await setDocumentProtectionAction(INITIAL, form({ choice: 'default' }));
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain('Reload the page');
    // The same stale reset refused by the service for a missing reason gets the same answer,
    // because the page showed no confirmation or required reason to fill in.
    mocks.setDocumentProtection.mockResolvedValue({
      ok: false,
      error: {
        code: 'invalid',
        message: 'Say why you are removing this protection before saving.',
      },
    });
    const refused = await setDocumentProtectionAction(INITIAL, form({ choice: 'default' }));
    expect(refused.message).toContain('Reload the page');
    expect(mocks.setDocumentProtection.mock.calls[0]?.[2]).toMatchObject({
      restricted: null,
      removalConfirmed: false,
    });
    expect(mocks.tryEstablishStepUp).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses to remove protection without a reason', async () => {
    for (const reason of ['', '   ']) {
      const result = await setDocumentProtectionAction(
        INITIAL,
        form({ choice: 'off', confirmed: 'yes', reason }),
      );
      expect(result).toEqual({
        ok: false,
        message: 'Say why you are removing this protection before saving.',
        field: 'reason',
      });
    }
    expect(mocks.setDocumentProtection).not.toHaveBeenCalled();
    // A reset that removes protection is refused by the service the same way.
    mocks.setDocumentProtection.mockResolvedValue({
      ok: false,
      error: {
        code: 'invalid',
        message: 'Say why you are removing this protection before saving.',
      },
    });
    const reset = await setDocumentProtectionAction(
      INITIAL,
      form({ choice: 'default', confirmed: 'yes' }),
    );
    expect(reset).toMatchObject({ ok: false, field: 'reason' });
    expect(mocks.tryEstablishStepUp).not.toHaveBeenCalled();
  });

  it('sends the admin to the sign-in check when their session is not fresh', async () => {
    mocks.setDocumentProtection.mockResolvedValue(stepUpNeeded);
    mocks.tryEstablishStepUp.mockResolvedValue({
      kind: 'reauth_required',
      reauthUrl: '/auth/reauth',
    });
    await expect(
      setDocumentProtectionAction(
        INITIAL,
        form({ choice: 'off', confirmed: 'yes', reason: 'Feedback' }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT:/auth/reauth');
    expect(mocks.setDocumentProtection).toHaveBeenCalledTimes(1);
  });

  it('says plainly when the sign-in check is not set up here', async () => {
    mocks.setDocumentProtection.mockResolvedValue(stepUpNeeded);
    mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'not_configured' });
    const result = await setDocumentProtectionAction(
      INITIAL,
      form({ choice: 'off', confirmed: 'yes', reason: 'Feedback' }),
    );
    expect(result).toEqual({ ok: false, message: 'Step-up is not configured here.' });
    expect(mocks.setDocumentProtection).toHaveBeenCalledTimes(1);
  });

  it('turns protection on, or back to the standard setting, in one step', async () => {
    mocks.setDocumentProtection.mockResolvedValue(changed);
    const on = await setDocumentProtectionAction(
      INITIAL,
      form({ scope: 'DOCUMENT_TYPE', key: 'SALARY_SLIP', choice: 'on' }),
    );
    expect(on.ok).toBe(true);
    expect(on.message).toContain('confirm it is them');
    const reset = await setDocumentProtectionAction(INITIAL, form({ choice: 'default' }));
    expect(reset.message).toBe('Saved. This switch is back to the standard setting.');
    expect(mocks.setDocumentProtection.mock.calls.map((call) => call[2].restricted)).toEqual([
      true,
      null,
    ]);
    expect(mocks.tryEstablishStepUp).not.toHaveBeenCalled();
  });

  it('refuses a switch that does not exist and an overlong reason before saving', async () => {
    for (const fields of [
      { scope: 'SOMETHING', choice: 'on' },
      { key: '', choice: 'on' },
      { choice: 'maybe' },
    ]) {
      expect((await setDocumentProtectionAction(INITIAL, form(fields))).ok).toBe(false);
    }
    const long = await setDocumentProtectionAction(
      INITIAL,
      form({ choice: 'on', reason: 'x'.repeat(501) }),
    );
    expect(long).toMatchObject({ ok: false, field: 'reason' });
    expect(mocks.setDocumentProtection).not.toHaveBeenCalled();
  });

  it('says nothing changed when the switch already works that way', async () => {
    mocks.setDocumentProtection.mockResolvedValue({
      ok: true,
      value: {
        changed: false,
        confirmationRequired: false,
        restrictedBefore: true,
        restrictedAfter: true,
      },
    });
    const result = await setDocumentProtectionAction(INITIAL, form({ choice: 'on' }));
    expect(result.message).toBe('Nothing to change. This switch already works this way.');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('returns from the fresh sign-in check to the category tab the switch is on', async () => {
    mocks.setDocumentProtection.mockResolvedValue(stepUpNeeded);
    mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'not_configured' });
    const fields = { choice: 'off', confirmed: 'yes', reason: 'Agencies asked for it' };
    await setDocumentProtectionAction(INITIAL, form({ ...fields, category: 'financial' }));
    expect(mocks.tryEstablishStepUp.mock.calls[0]?.[1]).toBe(
      '/app/admin/document-protection?category=financial#document-categories',
    );
    // A category value that is not a plain key never reaches the return address.
    for (const category of ['//evil.example', 'a b', '../x', 'x'.repeat(65), '']) {
      mocks.tryEstablishStepUp.mockClear();
      await setDocumentProtectionAction(INITIAL, form({ ...fields, category }));
      expect(mocks.tryEstablishStepUp.mock.calls[0]?.[1]).toBe('/app/admin/document-protection');
    }
  });
});
