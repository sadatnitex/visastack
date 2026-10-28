import { CALENDAR_FEED_SHARING_NEEDED, CALENDAR_FEED_UNAVAILABLE } from '@visastack/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  turnOnCalendarFeed: vi.fn(),
  replaceCalendarFeedLink: vi.fn(),
  turnOffCalendarFeed: vi.fn(),
  getCalendarFeedStatus: vi.fn(),
  reportServerError: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  requireAccess: mocks.requireAccess,
  turnOnCalendarFeed: mocks.turnOnCalendarFeed,
  replaceCalendarFeedLink: mocks.replaceCalendarFeedLink,
  turnOffCalendarFeed: mocks.turnOffCalendarFeed,
  getCalendarFeedStatus: mocks.getCalendarFeedStatus,
}));
vi.mock('../../../../../lib/server-error', () => ({ reportServerError: mocks.reportServerError }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { db: true }, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('../../../../../lib/base-url', () => ({ resolveBaseUrl: () => 'https://vs.example.test' }));

const { calendarFeedAction } = await import('./feed-actions');

const SECRET = 'q'.repeat(43);
const owner = { ok: true, value: { actor: { kind: 'applicant_owner', applicantId: 'a1' } } };
const form = (intent: string, applicantId = 'a1') => {
  const data = new FormData();
  data.set('intent', intent);
  data.set('applicantId', applicantId);
  return data;
};
const act = (intent: string, applicantId?: string) =>
  calendarFeedAction({ ok: true, message: '' }, form(intent, applicantId));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue(owner);
});

describe('changing the calendar link', () => {
  it('asks the gate as the signed-in owner for this traveller, whatever the form says', async () => {
    mocks.turnOnCalendarFeed.mockResolvedValue({
      ok: true,
      value: { secret: SECRET, linkMadeAt: new Date() },
    });
    const result = await act('on');
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      { db: true },
      { kind: 'account', accountId: 'acct-1' },
      'MANAGE',
      { applicantId: 'a1' },
      { purpose: 'self' },
    );
    expect(mocks.turnOnCalendarFeed).toHaveBeenCalledWith(owner.value);
    expect(result).toMatchObject({
      ok: true,
      feed: 'on',
      link: `https://vs.example.test/api/calendar-feed/${SECRET}.ics`,
    });
    expect(result.message).toContain('shown only this once');
  });

  it('refuses anyone but the owner, including someone the traveller shared with', async () => {
    mocks.requireAccess.mockResolvedValue({
      ok: true,
      value: { actor: { kind: 'individual_recipient', accountId: 'acct-1' } },
    });
    for (const intent of ['on', 'new', 'off']) {
      const result = await act(intent);
      expect(result.ok, intent).toBe(false);
      expect(result.link).toBeUndefined();
    }
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'not_found' } });
    expect((await act('on')).ok).toBe(false);
    expect(mocks.turnOnCalendarFeed).not.toHaveBeenCalled();
    expect(mocks.replaceCalendarFeedLink).not.toHaveBeenCalled();
    expect(mocks.turnOffCalendarFeed).not.toHaveBeenCalled();
  });

  it('makes a new link, stops a link, and says plainly when it cannot', async () => {
    mocks.replaceCalendarFeedLink.mockResolvedValue({
      ok: true,
      value: { secret: SECRET, linkMadeAt: new Date() },
    });
    expect(await act('new')).toMatchObject({ ok: true, feed: 'on' });
    mocks.turnOffCalendarFeed.mockResolvedValue({ ok: true, value: undefined });
    const off = await act('off');
    expect(off).toMatchObject({ ok: true, feed: 'off' });
    expect(off.link).toBeUndefined();

    // A change that did not happen says how the link stands now, read again from the server.
    mocks.getCalendarFeedStatus.mockResolvedValue({ ok: true, value: { state: 'on' } });
    mocks.turnOnCalendarFeed.mockResolvedValue({
      ok: false,
      error: { code: 'stale', message: 'already on' },
    });
    expect(await act('on')).toMatchObject({ ok: false, feed: 'on' });
    mocks.getCalendarFeedStatus.mockResolvedValue({ ok: true, value: { state: 'off' } });
    mocks.replaceCalendarFeedLink.mockResolvedValue({
      ok: false,
      error: { code: 'not_found', message: 'not on' },
    });
    expect(await act('new')).toMatchObject({ ok: false, feed: 'off' });
    expect(mocks.getCalendarFeedStatus).toHaveBeenCalledWith(owner.value);

    mocks.getCalendarFeedStatus.mockResolvedValue({ ok: true, value: { state: 'on' } });
    mocks.turnOffCalendarFeed.mockResolvedValue({
      ok: false,
      error: { code: 'upstream_error', message: 'could not' },
    });
    expect(await act('off')).toMatchObject({ ok: false, feed: 'on' });
    // When even the state cannot be read, the answer says nothing about it (the page keeps the last one).
    mocks.getCalendarFeedStatus.mockRejectedValue(new Error('database down'));
    const unknown = await act('off');
    expect(unknown.ok).toBe(false);
    expect(unknown.feed).toBeUndefined();
    expect(mocks.reportServerError).toHaveBeenCalled();
    mocks.turnOffCalendarFeed.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: CALENDAR_FEED_UNAVAILABLE },
    });
    expect(await act('off')).toMatchObject({ ok: false, feed: 'unavailable' });
  });

  it('ignores a form with no known choice', async () => {
    const result = await act('delete-everything');
    expect(result.ok).toBe(false);
    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });

  it('names the setting to turn on when sharing is not allowed', async () => {
    mocks.getCalendarFeedStatus.mockResolvedValue({ ok: true, value: { state: 'off' } });
    mocks.turnOnCalendarFeed.mockResolvedValue({
      ok: false,
      error: { code: 'consent_required', message: CALENDAR_FEED_SHARING_NEEDED },
    });
    const result = await act('on');
    expect(result).toMatchObject({ ok: false, feed: 'off' });
    expect(result.message).toContain('Let Me Share with Others');
    expect(result.link).toBeUndefined();
  });
});
