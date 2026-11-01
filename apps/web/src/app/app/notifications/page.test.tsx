import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../lib/next-mocks.test-support';

const service = vi.hoisted(() => ({
  listNotificationsForAccount: vi.fn(),
  markNotificationRead: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { default: NotificationsPage } = await import('./page');
const { markAllNotificationsReadAction } = await import('./actions');
const page = (search: Record<string, string> = {}) =>
  renderServer(NotificationsPage({ searchParams: Promise.resolve(search) }));

/** `count` notifications, the first `unread` of them unread, newest first within each group. */
function list(count: number, unread: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    eventType: 'CASE_MOVED',
    subject: `Notice ${i + 1}`,
    summary: 'Something changed.',
    deepLinkPath: '/app',
    read: i >= unread,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, 500 - i)),
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  service.listNotificationsForAccount.mockResolvedValue([]);
});

describe('Notifications within the scroll budget (WP-SB1)', () => {
  it('reads unread first, shows ten in a fixed panel, and offers ten more', async () => {
    service.listNotificationsForAccount.mockResolvedValue(list(11, 30));
    const html = await page();
    expect(service.listNotificationsForAccount).toHaveBeenCalledWith({}, 'owner', {
      unreadFirst: true,
      limit: 11,
    });
    expect(html).toContain('class="activity-log-scroll notifications-scroll"');
    expect(html).toContain('aria-label="Notification List"');
    expect(html.match(/id="notification-\d+"/g)).toHaveLength(10);
    const text = textOf(html);
    expect(text).toContain('Mark All Read');
    expect(text).toContain('Showing the first 10 notifications.');
    expect(html).toContain('href="/app/notifications?show=20#notification-11"');
  });

  it('grows by ten through the address and stops when nothing more exists', async () => {
    service.listNotificationsForAccount.mockResolvedValue(list(14, 0));
    const html = await page({ show: '20' });
    expect(service.listNotificationsForAccount).toHaveBeenCalledWith({}, 'owner', {
      unreadFirst: true,
      limit: 21,
    });
    expect(html.match(/id="notification-\d+"/g)).toHaveLength(14);
    const text = textOf(html);
    expect(text).toContain('Showing all 14 notifications.');
    expect(text).not.toContain('Mark All Read');
    expect(html).not.toContain('show-more-link');
  });

  it('never reads more than the ceiling, whatever the address says', async () => {
    await page({ show: '100000' });
    expect(service.listNotificationsForAccount).toHaveBeenCalledWith({}, 'owner', {
      unreadFirst: true,
      limit: 101,
    });
  });

  it('keeps the empty state', async () => {
    expect(textOf(await page())).toContain('No Notifications Yet');
  });
});

describe('Mark All Read (WP-SB1)', () => {
  it('marks only the unread notifications the list shows, each through the owner check', async () => {
    service.listNotificationsForAccount.mockResolvedValue(list(5, 3));
    service.markNotificationRead.mockResolvedValue({ ok: true, value: undefined });
    await markAllNotificationsReadAction();
    expect(service.listNotificationsForAccount).toHaveBeenCalledWith({}, 'owner', {
      unreadFirst: true,
      limit: 100,
    });
    expect(service.markNotificationRead.mock.calls.map((call) => call[1])).toEqual([
      { actorAccountId: 'owner', notificationId: 'n0' },
      { actorAccountId: 'owner', notificationId: 'n1' },
      { actorAccountId: 'owner', notificationId: 'n2' },
    ]);
  });
});

describe('Mark All Read past one batch (WP-SB1)', () => {
  it('keeps reading batches of 100 until none is unread, and stops when nothing can be marked', async () => {
    service.listNotificationsForAccount
      .mockResolvedValueOnce(list(100, 100))
      .mockResolvedValueOnce(list(30, 20))
      .mockResolvedValue([]);
    service.markNotificationRead.mockResolvedValue({ ok: true, value: undefined });
    await markAllNotificationsReadAction();
    expect(service.listNotificationsForAccount).toHaveBeenCalledTimes(2);
    expect(service.markNotificationRead).toHaveBeenCalledTimes(120);

    vi.resetAllMocks();
    // A refused mark (never addressed to this person) cannot make the click loop.
    service.listNotificationsForAccount.mockResolvedValue(list(100, 100));
    service.markNotificationRead.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    await markAllNotificationsReadAction();
    expect(service.listNotificationsForAccount).toHaveBeenCalledTimes(1);
  });
});
