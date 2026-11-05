import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Owner, 5 Nov 2026: a cancelled case can be deleted. The server action is final, so it refuses
 * unless the request carries the answer to the page's own question, proves the caller may manage
 * this case before asking the service, shows the service's refusal in its own words, and only a
 * real deletion sends the person to their list of cases.
 */

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  deleteCancelledMission: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));
vi.mock('@visastack/services', () => ({
  accountPrincipal: (id: string) => ({ kind: 'account', accountId: id }),
  requireAccess: mocks.requireAccess,
  deleteCancelledMission: mocks.deleteCancelledMission,
}));
vi.mock('../../../../lib/server-error', () => ({ reportServerError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('../../../../lib/ai', () => ({ resolveAiExplainer: vi.fn() }));
vi.mock('../../../../lib/base-url', () => ({ resolveBaseUrl: () => 'https://example.test' }));
vi.mock('../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('../../../../lib/step-up', () => ({
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'step up',
  tryEstablishStepUp: vi.fn(),
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { tag: 'db' }, accountId: 'owner' }),
}));

const { deleteCancelledCaseAction } = await import('./actions');

const PREV = { ok: true, message: '' };
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const PROOF = { applicant: { id: 'person-1' } };
const ASKED = { missionId: 'case-1', applicantId: 'person-1', confirmDelete: 'yes' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue({ ok: true, value: PROOF });
  mocks.deleteCancelledMission.mockResolvedValue({ ok: true, value: {} });
});

describe('deleteCancelledCaseAction', () => {
  it('refuses without the confirmation, and asks nothing of the service', async () => {
    const none = await deleteCancelledCaseAction(PREV, form({ ...ASKED, confirmDelete: '' }));
    expect(none.ok).toBe(false);
    expect(none.message).toMatch(/Confirm that you want to delete this case/);
    const wrong = await deleteCancelledCaseAction(PREV, form({ ...ASKED, confirmDelete: 'true' }));
    expect(wrong.ok).toBe(false);
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.deleteCancelledMission).not.toHaveBeenCalled();
  });

  it('refuses a request that does not name the case and the person', async () => {
    const result = await deleteCancelledCaseAction(PREV, form({ confirmDelete: 'yes' }));
    expect(result).toEqual({ ok: false, message: 'Missing case.' });
    expect(mocks.deleteCancelledMission).not.toHaveBeenCalled();
  });

  it('proves the caller may manage this case first, and stops there when they may not', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const result = await deleteCancelledCaseAction(PREV, form(ASKED));
    expect(result).toEqual({ ok: false, message: 'Not authorized.' });
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      { tag: 'db' },
      { kind: 'account', accountId: 'owner' },
      'MANAGE',
      { missionId: 'case-1' },
      { purpose: 'owner_delete_cancelled_case' },
    );
    expect(mocks.deleteCancelledMission).not.toHaveBeenCalled();
  });

  it('refuses when the case belongs to a different person than the form says', async () => {
    const result = await deleteCancelledCaseAction(
      PREV,
      form({ ...ASKED, applicantId: 'someone-else' }),
    );
    expect(result).toEqual({ ok: false, message: 'Not authorized.' });
    expect(mocks.deleteCancelledMission).not.toHaveBeenCalled();
  });

  it("shows the service's refusal in its own words and does not leave the page", async () => {
    mocks.deleteCancelledMission.mockResolvedValue({
      ok: false,
      error: {
        code: 'invalid',
        message: 'This case is under a legal hold, so it cannot be deleted for now.',
      },
    });
    const result = await deleteCancelledCaseAction(PREV, form(ASKED));
    expect(result).toEqual({
      ok: false,
      message: 'This case is under a legal hold, so it cannot be deleted for now.',
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('says nothing was changed, in plain words, when the deletion itself fails, and does not leave the page', async () => {
    mocks.deleteCancelledMission.mockRejectedValue(new Error('deadlock detected'));
    const result = await deleteCancelledCaseAction(PREV, form(ASKED));
    expect(result).toEqual({
      ok: false,
      message: 'We could not delete this case, and nothing was changed. Try again in a moment.',
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('deletes through the proof and sends the person to their cases, which say it is gone', async () => {
    await expect(deleteCancelledCaseAction(PREV, form(ASKED))).rejects.toThrow(
      'NEXT_REDIRECT /app/applicant/person-1/missions?deleted=1',
    );
    expect(mocks.deleteCancelledMission).toHaveBeenCalledWith(PROOF);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/applicant/person-1/missions');
  });
});
