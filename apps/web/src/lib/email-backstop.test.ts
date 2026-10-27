import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ after: vi.fn(), drain: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('./jobs', () => ({ drainWaitingEmails: mocks.drain }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('the waiting-email safety net', () => {
  it('asks at most once a minute per server, after the response', async () => {
    const { sendWaitingEmailsSoon } = await import('./email-backstop');
    sendWaitingEmailsSoon(1_000_000);
    sendWaitingEmailsSoon(1_030_000);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await (mocks.after.mock.calls[0]?.[0] as () => Promise<unknown>)();
    expect(mocks.drain).toHaveBeenCalledTimes(1);
    sendWaitingEmailsSoon(1_061_000);
    expect(mocks.after).toHaveBeenCalledTimes(2);
  });

  it('does not use up its minute when it cannot run here', async () => {
    const { sendWaitingEmailsSoon } = await import('./email-backstop');
    mocks.after.mockImplementationOnce(() => {
      throw new Error('outside a request');
    });
    sendWaitingEmailsSoon(2_000_000);
    sendWaitingEmailsSoon(2_000_500);
    expect(mocks.after).toHaveBeenCalledTimes(2);
  });
});
