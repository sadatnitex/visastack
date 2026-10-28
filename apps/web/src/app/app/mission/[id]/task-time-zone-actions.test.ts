import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A task's due date is read in the time zone chosen beside it. The picker fills in the device's
 * zone, so the zone is sent only together with a due date.
 */

const mocks = vi.hoisted(() => ({ createTask: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@visastack/services', () => ({ createTask: mocks.createTask }));
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

const { createTaskAction } = await import('./actions');

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const PREV = { ok: true, message: '' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createTask.mockResolvedValue({ ok: true, value: {} });
});

describe('the time zone of a task due date', () => {
  it('saves the chosen zone with the due date', async () => {
    await createTaskAction(
      PREV,
      form({
        missionId: 'm1',
        description: 'Translate',
        dueDate: '2026-10-29',
        dueTimezone: 'Asia/Dhaka',
      }),
    );
    expect(mocks.createTask).toHaveBeenCalledWith(
      { tag: 'db' },
      expect.objectContaining({ dueTimezone: 'Asia/Dhaka', dueDate: new Date('2026-10-29') }),
    );
  });

  it('leaves the zone out when there is no due date', async () => {
    await createTaskAction(
      PREV,
      form({ missionId: 'm1', description: 'Translate', dueTimezone: 'Asia/Dhaka' }),
    );
    const input = mocks.createTask.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(input).not.toHaveProperty('dueTimezone');
    expect(input).not.toHaveProperty('dueDate');
  });
});
