import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatTimestampDate } from '../../../../lib/format-date';
import { navigationState, renderServer } from '../../../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

const mocks = vi.hoisted(() => ({ people: vi.fn(), access: vi.fn(), own: vi.fn() }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listApplicants: mocks.people,
  requireAccess: mocks.access,
  listOwnCollectionResponses: mocks.own,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.test' }),
}));
vi.mock('../actions', () => ({
  submitResponseAction: async () => ({ ok: true, message: '' }),
  withdrawResponseAction: async () => ({ ok: true, message: '' }),
}));

import { collectCatalog } from '../../../../i18n/collect';

const { default: Page } = await import('./page');

const BENGALI = /[ঀ-৿]/;
const LATIN_DIGIT = /[0-9]/;
const ENGLISH_MONTH = /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/;
const bn = collectCatalog.bn as Record<string, string>;
const WITHDRAWN = 'collect.collectAccountAnswersPage.withdrawnFormattimestampdate';
// Far, fixed moments at midday, so a viewer within about twelve hours of UTC keeps the day (the checks run on UTC machines).
const SUBMITTED_AT = new Date('2099-03-05T12:00:00Z');
const WITHDRAWN_AT = new Date('2099-04-09T12:00:00Z');
const PERSON = '22222222-2222-4333-8444-555555555555';

async function showHtml(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  return renderServer(Page({ searchParams: Promise.resolve({}) }));
}

/** The words of the one withdrawn badge, exactly as a reader gets them. */
function withdrawnLine(html: string): string {
  const found = new JSDOM(`<body>${html}</body>`).window.document.querySelectorAll(
    '.badge-neutral',
  );
  expect(found.length).toBe(1);
  return found[0]?.textContent ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.pathname = '/collect/account/answers';
  // One living person holds the answer; the archived and Recently Deleted lists are empty.
  mocks.people.mockImplementation(async (_db: unknown, _account: unknown, options?: unknown) =>
    options ? [] : [{ id: PERSON, displayName: 'Rahim Uddin' }],
  );
  mocks.access.mockResolvedValue({ ok: true, value: {} });
  mocks.own.mockResolvedValue({
    ok: true,
    value: [
      {
        id: 'resp-1',
        agencyName: 'Synthetic Travel Desk',
        destination: 'GB',
        revisionNo: 2,
        submittedAt: SUBMITTED_AT,
        withdrawnAt: WITHDRAWN_AT,
        documents: 1,
        details: 3,
        missing: 0,
      },
    ],
  });
});
afterEach(() => {
  current.locale = 'en';
});

describe('Your Answers to Agencies under Bengali', () => {
  it('writes the withdrawn line in Bengali with a Bengali date', async () => {
    const html = await showHtml('bn');
    const line = withdrawnLine(html);
    expect(line).toBe(
      (bn[WITHDRAWN] ?? '').replace(
        '{formatTimestampDate}',
        formatTimestampDate(WITHDRAWN_AT, 'bn'),
      ),
    );
    expect(line).toBe('প্রত্যাহার করা হয়েছে ৯ এপ্রি, ২০৯৯');
    expect(line).toContain('২০৯৯');
    expect(line).not.toMatch(LATIN_DIGIT);
    expect(line).not.toMatch(ENGLISH_MONTH);
    expect(html).toContain('Rahim Uddin');
    expect(html).not.toMatch(/collect\.collectAccountAnswersPage\./);
  });

  it('keeps the withdrawn line exactly as it was in English', async () => {
    const html = await showHtml('en');
    const line = withdrawnLine(html);
    expect(line).toBe('Withdrawn 9 Apr 2099');
    expect(line).not.toMatch(BENGALI);
    expect(html).not.toMatch(/collect\.collectAccountAnswersPage\./);
  });
});
