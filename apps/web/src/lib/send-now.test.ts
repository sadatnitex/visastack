import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ trigger: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./jobs', () => ({ triggerNotificationWorker: mocks.trigger }));
const { sendEmailNow } = await import('./send-now');

beforeEach(() => vi.clearAllMocks());

describe('sending one record email while the person waits', () => {
  it('sends only that record, within a short wait', async () => {
    mocks.trigger.mockResolvedValue({ sent: 1, retrying: 0, failed: 0 });
    expect(await sendEmailNow('inv-1')).toBe('sent');
    expect(mocks.trigger).toHaveBeenCalledWith({
      resourceId: 'inv-1',
      limit: 3,
      timeBudgetMs: 8_000,
    });
  });

  it('says "failed" only when nothing will try again', async () => {
    mocks.trigger.mockResolvedValue({ sent: 0, retrying: 0, failed: 1 });
    expect(await sendEmailNow('inv-1')).toBe('failed');
  });

  it('says "pending" while a retry is due or the pass could not run', async () => {
    mocks.trigger.mockResolvedValueOnce({ sent: 0, retrying: 1, failed: 0 });
    expect(await sendEmailNow('inv-1')).toBe('pending');
    mocks.trigger.mockResolvedValueOnce({ sent: 0, retrying: 0, failed: 0, unavailable: true });
    expect(await sendEmailNow('inv-1')).toBe('pending');
  });
});
