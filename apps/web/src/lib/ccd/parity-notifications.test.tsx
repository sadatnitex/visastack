import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { renderServer } from '../next-mocks.test-support';
import { registerParity } from './parity-kit.test-support';

/** Notifications (screen 07): see parity-kit.test-support.ts for how the comparison works. */

const state = vi.hoisted(() => ({
  notifications: [] as unknown[],
  depth: 'auto',
  /** The address the page is rendered at (WP-SB1: `show` is the Show More target). */
  search: {} as Record<string, string>,
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listNotificationsForAccount: async () => state.notifications,
}));
vi.mock('../session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('./depth.server', () => ({ readDepth: async () => state.depth }));

const { default: NotificationsPage } = await import('../../app/app/notifications/page');

const note = (id: string, read: boolean, day: number) => ({
  id,
  subject: `Update ${id}`,
  summary: `What changed in ${id}.`,
  deepLinkPath: `/app/applicant/a1/evidence#${id}`,
  read,
  createdAt: new Date(`2026-10-${String(day).padStart(2, '0')}T08:00:00Z`),
});

registerParity({
  name: 'notifications',
  reset: () => {
    state.notifications = [];
    state.depth = 'auto';
    state.search = {};
  },
  render: async () =>
    await renderServer(NotificationsPage({ searchParams: Promise.resolve(state.search) })),
  states: [
    { name: 'nothing yet', setup: () => undefined },
    {
      name: 'two new and fourteen read',
      setup: () => {
        state.notifications = [
          note('n1', false, 27),
          note('n2', false, 26),
          ...Array.from({ length: 14 }, (_, i) => note(`r${i}`, true, 25 - i)),
        ];
        // WP-SB1 (plan section 6): ten show first; every one of the 16 is on the Show More page.
        state.search = { show: '20' };
      },
    },
    {
      name: 'only read ones',
      setup: () => {
        state.notifications = [note('r1', true, 20), note('r2', true, 19)];
      },
    },
  ],
});

describe('notification levels', () => {
  const levels = async (search: Record<string, string> = {}) => {
    const doc = new JSDOM(
      await renderServer(NotificationsPage({ searchParams: Promise.resolve(search) })),
    ).window.document;
    return [...doc.querySelectorAll('.rows > .row')].map(
      (row) => row.getAttribute('data-level') ?? 'glance',
    );
  };

  it('shows unread at Glance, the ten most recent read at Browse, the rest at Everything', async () => {
    state.notifications = [
      note('n1', false, 27),
      ...Array.from({ length: 12 }, (_, i) => note(`r${i}`, true, 25 - i)),
    ];
    // WP-SB1 (plan section 6): the first ten, unread first, keep the same level rule.
    expect(await levels()).toEqual(['glance', ...Array<string>(9).fill('browse')]);
    // The Show More page shows all thirteen, so no notification is lost.
    expect(await levels({ show: '20' })).toEqual([
      'glance',
      ...Array<string>(10).fill('browse'),
      'everything',
      'everything',
    ]);
  });

  it('shows ten of sixteen first, says how many there are, and the next page holds the rest (WP-SB1)', async () => {
    state.notifications = [
      note('n1', false, 27),
      note('n2', false, 26),
      ...Array.from({ length: 14 }, (_, i) => note(`r${i}`, true, 25 - i)),
    ];
    const ids = (doc: Document) =>
      [...doc.querySelectorAll('.rows > .row .row-key')].map((key) =>
        key.childNodes[0]?.textContent?.replace('Update ', ''),
      );
    const first = new JSDOM(await renderServer(NotificationsPage())).window.document;
    expect(ids(first)).toEqual(['n1', 'n2', ...Array.from({ length: 8 }, (_, i) => `r${i}`)]);
    expect(first.querySelector('.show-more-count')?.textContent).toBe(
      'Showing 10 of 16 notifications.',
    );
    const link = first.querySelector('a.show-more-link');
    expect(link?.getAttribute('href')).toBe('/app/notifications?show=20#notification-11');

    const next = new JSDOM(
      await renderServer(NotificationsPage({ searchParams: Promise.resolve({ show: '20' }) })),
    ).window.document;
    expect(ids(next)).toEqual(['n1', 'n2', ...Array.from({ length: 14 }, (_, i) => `r${i}`)]);
    expect(next.querySelector('a.show-more-link')).toBeNull();
  });

  it('starts the list at Browse when nothing is unread, with a calm line at Glance', async () => {
    state.notifications = [note('r1', true, 20)];
    const html = await renderServer(NotificationsPage());
    const doc = new JSDOM(html).window.document;
    expect(doc.querySelector('article.card')?.getAttribute('data-level')).toBe('browse');
    expect(doc.querySelector('[data-only="glance"]')?.textContent).toContain('Nothing unread');
  });
});
