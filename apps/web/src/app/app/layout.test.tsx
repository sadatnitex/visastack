import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  latinWords,
  localeState,
  navigationState,
  renderServer,
  textOf,
} from '../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ isPlatformAdmin: vi.fn() }));

vi.mock('@workos-inc/authkit-nextjs', () => ({ signOut: vi.fn() }));
vi.mock('../../lib/admin', () => ({ isPlatformAdmin: mocks.isPlatformAdmin }));
vi.mock('../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));

const { default: Layout } = await import('./layout');

const links = (html: string) =>
  [...html.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);

beforeEach(() => {
  vi.clearAllMocks();
  localeState.value = 'en';
  navigationState.pathname = '/app/privacy';
  mocks.isPlatformAdmin.mockResolvedValue(false);
});

describe('the signed-in bar in English', () => {
  it('names the six sections as before and marks the current one', async () => {
    const html = await renderServer(await Layout({ children: <p>page</p> }));
    expect(links(html).slice(0, 6)).toEqual([
      ['/app', 'Overview'],
      ['/app/applicants', 'Applicants'],
      ['/app/shared', 'Shared with me'],
      ['/app/notifications', 'Alerts'],
      ['/app/privacy', 'Privacy'],
      ['/app/account', 'Account'],
    ]);
    expect(html).toContain('<a href="/app/privacy" aria-current="page">Privacy</a>');
    expect(textOf(html)).toContain('Agency');
    expect(textOf(html)).toContain('Sign out');
    expect(textOf(html)).not.toContain('Admin');
  });

  it('adds Admin for a platform administrator', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(true);
    expect(textOf(await renderServer(await Layout({ children: <p>page</p> })))).toContain('Admin');
  });
});

describe('the signed-in bar in Bangla', () => {
  beforeEach(() => {
    localeState.value = 'bn';
  });

  it('names every section in Bangla and keeps where each one goes and which is current', async () => {
    const html = await renderServer(await Layout({ children: <p>page</p> }));
    expect(links(html).slice(0, 6)).toEqual([
      ['/app', 'সারসংক্ষেপ'],
      ['/app/applicants', 'আবেদনকারী'],
      ['/app/shared', 'আমার সাথে শেয়ার করা'],
      ['/app/notifications', 'বিজ্ঞপ্তি'],
      ['/app/privacy', 'গোপনীয়তা'],
      ['/app/account', 'অ্যাকাউন্ট'],
    ]);
    expect(html).toContain('<a href="/app/privacy" aria-current="page">গোপনীয়তা</a>');
    expect(html).toContain('aria-label="প্রধান"');
  });

  it('translates the Agency, Admin and Sign out controls too', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(true);
    const html = await renderServer(await Layout({ children: <p>পাতা</p> }));
    const text = textOf(html);
    expect(text).toContain('এজেন্সি');
    expect(text).toContain('অ্যাডমিন');
    expect(text).toContain('সাইন আউট');
    expect(latinWords(text)).toEqual([]);
  });
});
