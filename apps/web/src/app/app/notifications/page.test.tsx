import { beforeEach, describe, expect, it, vi } from 'vitest';
import { latinWords, localeState, renderServer, textOf } from '../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ listNotificationsForAccount: vi.fn() }));

vi.mock('@visastack/services', () => mocks);
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('./actions', () => ({ markNotificationReadAction: vi.fn() }));

const { default: Page } = await import('./page');

const keyed = {
  id: 'n1',
  eventType: 'DOCUMENT_EXPIRY',
  subject: 'A document is expiring soon',
  summary: '"Passport" is expiring soon. Check whether it needs renewing.',
  messages: {
    subject: 'alert.documentExpiry.subject',
    summary: 'alert.documentExpiry.summary',
    params: { name: 'Passport' },
  },
  deepLinkPath: '/app/applicant/a1/expiry',
  read: false,
  createdAt: new Date('2026-10-05T23:30:00Z'),
};
const legacy = {
  id: 'n2',
  eventType: 'EVIDENCE_REQUEST_CREATED',
  subject: 'New evidence request',
  summary: 'An agency working your case has asked for evidence.',
  deepLinkPath: '/app/applicant/a1/evidence',
  read: true,
  createdAt: new Date('2026-10-01T10:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  localeState.value = 'en';
  mocks.listNotificationsForAccount.mockResolvedValue([keyed, legacy]);
});

describe('Alerts in English', () => {
  it('shows each alert as it was written, with day-first dates', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('Updates on your cases');
    expect(text).toContain('A document is expiring soon');
    expect(text).toContain('"Passport" is expiring soon. Check whether it needs renewing.');
    expect(text).toContain('5 Oct 2026');
    expect(text).toContain('1 Oct 2026');
    expect(text).toContain('New');
    expect(text).toContain('Mark read');
  });

  it('says there are no alerts yet when there are none', async () => {
    mocks.listNotificationsForAccount.mockResolvedValue([]);
    expect(textOf(await renderServer(Page()))).toContain('No alerts yet.');
  });
});

describe('Alerts in Bangla', () => {
  beforeEach(() => {
    localeState.value = 'bn';
  });

  it('shows an alert written with its messages in Bangla, keeping the document name as typed', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('একটি নথির মেয়াদ শীঘ্রই শেষ হচ্ছে');
    expect(text).toContain('"Passport" নথির মেয়াদ শীঘ্রই শেষ হচ্ছে');
    expect(text).toContain('৫ অক্টো, ২০২৬');
    expect(text).toContain('নতুন');
    expect(text).toContain('পঠিত হিসেবে চিহ্নিত করুন');
    expect(text).toContain('খুলুন');
  });

  it('keeps an older alert in the English it was written in, rather than hiding it', async () => {
    const text = textOf(await renderServer(Page()));
    expect(text).toContain('New evidence request');
    expect(text).toContain('An agency working your case has asked for evidence.');
  });

  it('has no English interface words beyond the stored alerts and the typed name', async () => {
    mocks.listNotificationsForAccount.mockResolvedValue([keyed]);
    const text = textOf(await renderServer(Page()));
    expect([...new Set(latinWords(text))]).toEqual(['Passport']);
  });

  it('says there are no alerts yet, in Bangla', async () => {
    mocks.listNotificationsForAccount.mockResolvedValue([]);
    expect(textOf(await renderServer(Page()))).toContain('এখনও কোনো বিজ্ঞপ্তি নেই।');
  });
});
