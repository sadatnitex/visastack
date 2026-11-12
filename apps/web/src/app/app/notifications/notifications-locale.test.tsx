import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../lib/axe.test-support';
import { renderServer, textOf } from '../../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
// The locale is set here directly, as the auth screens' test does.
const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'bn',
  generation: 0,
  notifications: [] as unknown[],
}));
vi.mock('../../../lib/locale', () => ({ getLocale: async () => state.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T extends (...args: never[]) => unknown>(build: T): T => {
    let seen = -1;
    let value: unknown;
    const cached = (...args: Parameters<T>) => {
      if (seen !== state.generation || args.length > 0) {
        seen = state.generation;
        value = build(...args);
      }
      return value;
    };
    return cached as unknown as T;
  },
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listNotificationsForAccount: async () => state.notifications,
}));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));

import { I18nProvider } from '../../../components/i18n-provider';
import { appNotificationsCatalog } from '../../../i18n/app-notifications';

const { default: NotificationsPage } = await import('./page');

const BENGALI = /[ঀ-৿]/;
const bn = appNotificationsCatalog.bn as Record<string, string>;
const en = appNotificationsCatalog.en as Record<string, string>;

const note = (id: string, read: boolean) => ({
  id,
  subject: `Update ${id}`,
  summary: `What changed in ${id}.`,
  deepLinkPath: `/app/applicant/a1/evidence#${id}`,
  read,
  createdAt: new Date('2026-10-20T08:00:00Z'),
});

async function markup(locale: 'en' | 'bn', notifications: unknown[]) {
  state.locale = locale;
  state.generation += 1;
  state.notifications = notifications;
  const page = await NotificationsPage({ searchParams: Promise.resolve({}) });
  return renderServer(<I18nProvider locale={locale}>{page}</I18nProvider>);
}
const render = async (locale: 'en' | 'bn', notifications: unknown[]) =>
  textOf(await markup(locale, notifications));

describe('notifications under Bengali', () => {
  it('empty state: the Bengali drafts under bn, the unchanged English under en', async () => {
    const shown = await render('bn', []);
    expect(shown).toContain(bn['appNotifications.appNotificationsPage.notifications']);
    expect(shown).toContain(bn['appNotifications.appNotificationsPage.noNotificationsYet']);
    expect(shown).toContain(
      bn['appNotifications.appNotificationsPage.thisIsWhereVisastackTellsYou'],
    );
    expect(shown).toMatch(BENGALI);
    const english = await render('en', []);
    expect(english).toContain('Notifications');
    expect(english).toContain('No Notifications Yet');
    expect(english).not.toMatch(BENGALI);
  });

  it('list state with unread and read items: action labels and list name in Bengali, items as sent', async () => {
    const shown = await render('bn', [note('n1', false), note('r1', true)]);
    expect(shown).toContain(bn['appNotifications.appNotificationsNotificationList.markRead']);
    expect(shown).toContain(bn['appNotifications.appNotificationsNotificationList.markAllRead']);
    expect(shown).toContain('Update n1');
    const english = await render('en', [note('n1', false), note('r1', true)]);
    expect(english).toContain(en['appNotifications.appNotificationsNotificationList.markRead']);
    expect(english).not.toMatch(BENGALI);
  });

  it('all-read state: the dates use Bengali digits, the calm line stays English (no draft)', async () => {
    const shown = await render('bn', [note('r1', true)]);
    expect(shown).toContain('Update r1');
    // 20 October 2026 with Bengali digits and a Bengali month, never "20 Oct 2026".
    expect(shown).toContain('২০');
    expect(shown).not.toContain('20 Oct 2026');
    const english = await render('en', [note('r1', true)]);
    expect(english).toContain('20 Oct 2026');
  });

  it('has no accessibility violations under Bengali, empty or with items', async () => {
    expect(await axeViolations(await markup('bn', []))).toEqual([]);
    expect(await axeViolations(await markup('bn', [note('n1', false), note('r1', true)]))).toEqual(
      [],
    );
  });
});
