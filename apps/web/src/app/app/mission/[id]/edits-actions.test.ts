import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Rewording a checklist item: the action. Synthetic values only; the services are stand-ins. */

const mocks = vi.hoisted(() => ({ access: vi.fn(), set: vi.fn(), revalidate: vi.fn() }));
vi.mock('@visastack/services', async (load) => ({
  ...(await load<typeof import('@visastack/services')>()),
  requireAccess: mocks.access,
  setChecklistWording: mocks.set,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'signed-in-account', email: 'owner@example.test' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));

const { saveWordingAction } = await import('./edits-actions');

const CASE = '20000000-0000-4000-8000-000000000001';
const ITEM = '30000000-0000-4000-8000-000000000001';
const START = { ok: true, message: '' };
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ ok: true, value: { proof: true } });
  mocks.set.mockResolvedValue({ ok: true, value: { wording: 'My words' } });
});

describe('saveWordingAction', () => {
  it('asks for the case proof for the signed-in account and saves the sentence', async () => {
    const result = await saveWordingAction(
      START,
      form({ missionId: CASE, packRequirementId: ITEM, wording: 'My words' }),
    );
    expect(result).toEqual({ ok: true, message: 'Wording saved.' });
    expect(mocks.access.mock.calls[0]?.[2]).toBe('MANAGE');
    expect(mocks.access.mock.calls[0]?.[3]).toEqual({ missionId: CASE });
    expect(mocks.set).toHaveBeenCalledWith(
      { proof: true },
      { missionId: CASE, packRequirementId: ITEM, wording: 'My words' },
    );
    expect(mocks.revalidate).toHaveBeenCalledWith(`/app/mission/${CASE}`);
  });

  it('Back to Original sends an empty sentence whatever the box holds', async () => {
    mocks.set.mockResolvedValue({ ok: true, value: { wording: null } });
    const result = await saveWordingAction(
      START,
      form({ missionId: CASE, packRequirementId: ITEM, wording: 'Typed', intent: 'original' }),
    );
    expect(mocks.set.mock.calls[0]?.[1].wording).toBe('');
    expect(result).toEqual({ ok: true, message: 'Original wording is back.' });
  });

  it('refuses ids that are not ids before asking for anything', async () => {
    expect(
      (await saveWordingAction(START, form({ missionId: 'x', packRequirementId: ITEM }))).ok,
    ).toBe(false);
    expect(
      (await saveWordingAction(START, form({ missionId: CASE, packRequirementId: 'y' }))).ok,
    ).toBe(false);
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it('says the case is not available when the proof is refused, and saves nothing', async () => {
    mocks.access.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const result = await saveWordingAction(
      START,
      form({ missionId: CASE, packRequirementId: ITEM, wording: 'x' }),
    );
    expect(result).toEqual({ ok: false, message: 'This case is not available to you.' });
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('shows the service refusal in plain words and refreshes nothing', async () => {
    mocks.set.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'This case is finished, so its list cannot change.' },
    });
    const result = await saveWordingAction(
      START,
      form({ missionId: CASE, packRequirementId: ITEM, wording: 'x' }),
    );
    expect(result).toEqual({
      ok: false,
      message: 'This case is finished, so its list cannot change.',
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
