import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Owner list item 3, on the server: cancelling a case is final, so the stage action refuses it
 * unless the request carries the answer to the page's own question. Other stages move as before.
 */

const mocks = vi.hoisted(() => ({ transitionMission: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@visastack/services', () => ({ transitionMission: mocks.transitionMission }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
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

const { transitionMissionAction } = await import('./actions');

const PREV = { ok: true, message: '' };
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transitionMission.mockResolvedValue({ ok: true, value: {} });
});

describe('transitionMissionAction and cancelling', () => {
  it('refuses to cancel without the confirmation, and changes nothing', async () => {
    const result = await transitionMissionAction(PREV, form({ missionId: 'm1', to: 'CANCELLED' }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Confirm that you want to cancel/);
    expect(mocks.transitionMission).not.toHaveBeenCalled();
    const wrong = await transitionMissionAction(
      PREV,
      form({ missionId: 'm1', to: 'CANCELLED', confirmCancel: 'true' }),
    );
    expect(wrong.ok).toBe(false);
    expect(mocks.transitionMission).not.toHaveBeenCalled();
  });

  it('cancels once confirmed, through the existing owner-checked service', async () => {
    const result = await transitionMissionAction(
      PREV,
      form({ missionId: 'm1', to: 'CANCELLED', confirmCancel: 'yes' }),
    );
    expect(result).toEqual({ ok: true, message: 'This case is cancelled.' });
    expect(mocks.transitionMission).toHaveBeenCalledWith(
      { tag: 'db' },
      { actorAccountId: 'owner', missionId: 'm1', to: 'CANCELLED' },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/mission/m1');
  });

  it('moves other stages without any confirmation, as before', async () => {
    const result = await transitionMissionAction(
      PREV,
      form({ missionId: 'm1', to: 'IN_PROGRESS' }),
    );
    expect(result).toEqual({ ok: true, message: 'Case moved to In Progress.' });
  });
});
