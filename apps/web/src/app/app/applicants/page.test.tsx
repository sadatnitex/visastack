import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  latinWords,
  localeState,
  renderServer,
  stub,
  stubProps,
  textOf,
} from '../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ getConsents: vi.fn(), listApplicants: vi.fn() }));

vi.mock('@visastack/services', () => mocks);
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('../add-applicant-form', () => ({ AddApplicantForm: stub('AddApplicantForm') }));

const { default: Page } = await import('./page');

beforeEach(() => {
  vi.clearAllMocks();
  localeState.value = 'en';
  mocks.getConsents.mockResolvedValue({ CORE_PROCESSING: true });
  mocks.listApplicants.mockResolvedValue([
    { id: 'a1', displayName: 'রহিম উদ্দিন', relationship: 'SELF' },
    { id: 'a2', displayName: 'Karim Uddin', relationship: 'MINOR_GUARDIAN' },
  ]);
});

describe('Applicants in English', () => {
  it('lists the people with their relationship and the right plural', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('People on your account');
    expect(text).toContain('2 records');
    expect(text).toContain('রহিম উদ্দিন');
    expect(text).toContain('Myself');
    expect(text).toContain('Minor (guardian)');
  });

  it('says "1 record", not "1 record(s)"', async () => {
    mocks.listApplicants.mockResolvedValue([{ id: 'a1', displayName: 'A', relationship: 'SELF' }]);
    expect(textOf(await renderServer(Page()))).toContain('1 record');
    expect(textOf(await renderServer(Page()))).not.toContain('1 records');
  });

  it('points to Overview for the consent it needs, with the emphasis in the same place', async () => {
    mocks.getConsents.mockResolvedValue({});
    const html = await renderServer(Page());
    expect(html).toContain('<strong>Core processing</strong>');
    expect(html).toContain('<a href="/app">Overview</a>');
    expect(html).not.toContain('AddApplicantForm');
  });
});

describe('Applicants in Bangla', () => {
  beforeEach(() => {
    localeState.value = 'bn';
  });

  it('is in Bangla, with names exactly as typed and no English interface words', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('আপনার অ্যাকাউন্টে থাকা ব্যক্তিরা');
    expect(text).toContain('২টি রেকর্ড');
    expect(text).toContain('রহিম উদ্দিন');
    expect(text).toContain('নিজে');
    expect(text).toContain('নাবালক (অভিভাবক)');
    expect([...new Set(latinWords(text))]).toEqual(['Karim', 'Uddin']);
  });

  it('hands the form Bangla words, with the authority statement for the reviewer to check', async () => {
    const html = await renderServer(Page());
    const [form] = stubProps<{ messages: Record<string, string> }>(html, 'AddApplicantForm');
    expect(form?.messages['account.add.name']).toBe('পূর্ণ নাম');
    expect(form?.messages['consent.authority.confirm']).toContain('অধিকার আমার আছে');
    expect(Object.keys(form?.messages ?? {})).toHaveLength(8);
  });

  it('puts the link and the emphasis where Bangla word order needs them', async () => {
    mocks.getConsents.mockResolvedValue({});
    const html = await renderServer(Page());
    expect(html).toContain('<a href="/app">সারসংক্ষেপ</a>');
    expect(html).toContain('<strong>মূল প্রক্রিয়াকরণে</strong>');
  });
});
