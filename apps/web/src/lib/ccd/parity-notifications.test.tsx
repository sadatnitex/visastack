import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { renderServer } from '../next-mocks.test-support';
import { registerParity } from './parity-kit.test-support';

/** Notifications (screen 07): see parity-kit.test-support.ts for how the comparison works. */

const state = vi.hoisted(() => ({ notifications: [] as unknown[], depth: 'auto' }));

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
  },
  render: async () => await renderServer(NotificationsPage()),
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
  const levels = async () => {
    const doc = new JSDOM(await renderServer(NotificationsPage())).window.document;
    return [...doc.querySelectorAll('.rows > .row')].map(
      (row) => row.getAttribute('data-level') ?? 'glance',
    );
  };

  it('shows unread at Glance, the ten most recent read at Browse, the rest at Everything', async () => {
    state.notifications = [
      note('n1', false, 27),
      ...Array.from({ length: 12 }, (_, i) => note(`r${i}`, true, 25 - i)),
    ];
    expect(await levels()).toEqual([
      'glance',
      ...Array<string>(10).fill('browse'),
      'everything',
      'everything',
    ]);
  });

  it('starts the list at Browse when nothing is unread, with a calm line at Glance', async () => {
    state.notifications = [note('r1', true, 20)];
    const html = await renderServer(NotificationsPage());
    const doc = new JSDOM(html).window.document;
    expect(doc.querySelector('article.card')?.getAttribute('data-level')).toBe('browse');
    expect(doc.querySelector('[data-only="glance"]')?.textContent).toContain('Nothing unread');
  });
});
