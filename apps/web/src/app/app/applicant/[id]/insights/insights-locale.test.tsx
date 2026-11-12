import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({ requireAccess: vi.fn(), getTravellerInsights: vi.fn() }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  requireAccess: mocks.requireAccess,
  getTravellerInsights: mocks.getTravellerInsights,
}));
vi.mock('../../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));

const { buildTravellerInsights } = await import('@visastack/services');
const { applicantInsightsCatalog } = await import('../../../../../i18n/applicant-insights');
const { default: InsightsPage } = await import('./page');

const BENGALI = /[ঀ-৿]/;
const bn = applicantInsightsCatalog.bn as Record<string, string>;
const en = applicantInsightsCatalog.en as Record<string, string>;
const K = 'applicantInsights.appApplicantIdInsightsPage.';

async function render(locale: 'en' | 'bn'): Promise<string> {
  current.holder = null;
  current.locale = locale;
  return textOf(await renderServer(InsightsPage({ params: Promise.resolve({ id: 'a1' }) })));
}

function empty() {
  return buildTravellerInsights({
    documents: [],
    facts: [],
    pendingReadings: [],
    pendingCheckDocumentIds: [],
    sections: { activated: new Set(), notApplicable: new Set(), noneDeclared: new Set() },
    cases: [],
    now: new Date('2026-10-25T12:00:00Z'),
  });
}

beforeEach(() => {
  mocks.requireAccess.mockResolvedValue({
    ok: true,
    value: { actor: { kind: 'applicant_owner', applicantId: 'a1' } },
  });
});
afterEach(() => {
  current.locale = 'en';
});

describe('document insights under Bengali', () => {
  it('shows Bengali headings in the empty state and keeps the held claims in English', async () => {
    mocks.getTravellerInsights.mockResolvedValue({ ok: true, value: empty() });
    const text = await render('bn');
    expect(text).toMatch(BENGALI);
    expect(text).toContain(bn[`${K}noDocumentsYet`]);
    expect(text).toContain(bn[`${K}noExpiryDatesYet`]);
    expect(text).toContain(bn[`${K}eachVisaApplicationIsACase`]);
    expect(text).toContain('A summary of your saved documents and profile.');
    expect(text).not.toMatch(/applicantInsights\.|\{[A-Za-z]+\}/);
  });

  it('keeps the unavailable state in English, with no raw key', async () => {
    mocks.getTravellerInsights.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const text = await render('bn');
    expect(text).toContain('We could not put this summary together just now.');
    expect(text).not.toMatch(/applicantInsights\./);
  });

  it('holds back the claims about what the summary reads', () => {
    for (const k of [
      'aSummaryOfYourSavedDocuments',
      'addADocumentAndAcceptWhat',
      'embassiesUsuallyWantTheseHandedIn',
    ]) {
      expect(`${K}${k}` in en).toBe(true);
      expect(`${K}${k}` in bn).toBe(false);
    }
  });
});

describe('document insights under English', () => {
  it('render the original English with no Bengali', async () => {
    mocks.getTravellerInsights.mockResolvedValue({ ok: true, value: empty() });
    const text = await render('en');
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('What Your Documents Show');
  });
});
