import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  latinWords,
  localeState,
  navigationState,
  renderServer,
  textOf,
} from '../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ getApplicant: vi.fn() }));

vi.mock('@visastack/services', () => ({ getApplicant: mocks.getApplicant }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));

const { default: Layout } = await import('./layout');

const props = { children: <p>পাতা</p>, params: Promise.resolve({ id: 'a1' }) };
const tabs = (html: string) =>
  [...html.matchAll(/<a href="[^"]*"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);

beforeEach(() => {
  vi.clearAllMocks();
  localeState.value = 'en';
  navigationState.pathname = '/app/applicant/a1/documents';
  mocks.getApplicant.mockResolvedValue({
    id: 'a1',
    ownerAccountId: 'acct-1',
    displayName: 'রহিম উদ্দিন',
    relationship: 'FAMILY_MEMBER',
  });
});

describe('an applicant workspace', () => {
  it('shows the eight tabs and the relationship in English', async () => {
    const html = await renderServer(await Layout(props));
    expect(tabs(html)).toEqual([
      'Overview',
      'Profile',
      'Documents',
      'Cases',
      'Sharing',
      'Evidence',
      'Expiry',
      'History',
    ]);
    expect(html).toContain('aria-label="Applicant sections"');
    expect(textOf(html)).toContain('Applicant');
    expect(textOf(html)).toContain('Family member');
  });

  it('shows them in Bangla, with the name exactly as stored and the current tab marked', async () => {
    localeState.value = 'bn';
    const html = await renderServer(await Layout(props));
    expect(tabs(html)).toEqual([
      'সারসংক্ষেপ',
      'প্রোফাইল',
      'নথি',
      'কেস',
      'শেয়ারিং',
      'প্রমাণ',
      'মেয়াদ',
      'ইতিহাস',
    ]);
    expect(html).toContain('aria-current="page">নথি</a>');
    expect(html).toContain('aria-label="আবেদনকারীর বিভাগসমূহ"');
    expect(textOf(html)).toContain('রহিম উদ্দিন');
    expect(textOf(html)).toContain('পরিবারের সদস্য');
    expect(latinWords(textOf(html))).toEqual([]);
  });

  it('is not found for someone who does not own the applicant', async () => {
    mocks.getApplicant.mockResolvedValue({ id: 'a1', ownerAccountId: 'someone-else' });
    await expect(Layout(props)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
