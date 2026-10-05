import { beforeEach, describe, expect, it, vi } from 'vitest';
import { latinWords, localeState, renderServer, textOf } from '../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ isPlatformAdmin: vi.fn(), listMembershipsForAccount: vi.fn() }));

vi.mock('@visastack/services', () => ({
  listMembershipsForAccount: mocks.listMembershipsForAccount,
}));
vi.mock('@workos-inc/authkit-nextjs', () => ({ signOut: vi.fn() }));
vi.mock('../../../lib/admin', () => ({ isPlatformAdmin: mocks.isPlatformAdmin }));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('../../actions', () => ({ setLocaleAction: vi.fn() }));

const { default: Page } = await import('./page');

beforeEach(() => {
  vi.clearAllMocks();
  localeState.value = 'en';
  mocks.isPlatformAdmin.mockResolvedValue(true);
  mocks.listMembershipsForAccount.mockResolvedValue([{}]);
});

describe('Account', () => {
  it('offers Bangla from English and says which language it switches to', async () => {
    const html = await renderServer(Page());
    expect(textOf(html)).toContain('Switch to বাংলা');
    expect(html).toContain('name="locale" value="bn"');
  });

  it('offers English from Bangla, naming each language in its own script', async () => {
    localeState.value = 'bn';
    const html = await renderServer(Page());
    expect(textOf(html)).toContain('English-এ পরিবর্তন করুন');
    expect(html).toContain('name="locale" value="en"');
  });

  it('is entirely in Bangla for a Bangla reader', async () => {
    localeState.value = 'bn';
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('পছন্দ');
    expect(text).toContain('তথ্যের অধিকার');
    expect(text).toContain('এজেন্সি ডেস্ক');
    expect(text).toContain('প্ল্যাটফর্ম প্রশাসন');
    expect(text).toContain('সাইন আউট');
    expect([...new Set(latinWords(text))].sort()).toEqual(['English', 'com', 'example', 'traveller']);
  });

  it('shows the other-areas card only to someone who has one', async () => {
    mocks.isPlatformAdmin.mockResolvedValue(false);
    mocks.listMembershipsForAccount.mockResolvedValue([]);
    expect(textOf(await renderServer(Page()))).not.toContain('Other areas you can access');
  });
});
