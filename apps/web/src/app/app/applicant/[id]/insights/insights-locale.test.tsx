import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@visastack/i18n', async (original) =>
  (await import('../bn-coverage.test-support')).trackBengali(await original()),
);
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
import { expectEveryLiveMessageRendered } from '../bn-coverage.test-support';

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

function populated() {
  return buildTravellerInsights({
    documents: [
      {
        id: 'doc-pass',
        docType: 'PASSPORT',
        expiresAt: '2027-01-23T12:00:00.000Z',
        lifecycle: 'CURRENT',
        safetyStatus: 'CLEAN',
        createdAt: '2026-01-01T00:00:00Z',
        reminderThresholds: [90, 60, 30, 7, 0],
      },
    ],
    facts: [
      {
        fieldKey: 'given_name',
        repeatingRecordKey: null,
        status: 'DOCUMENT_SUPPORTED',
        isProtected: false,
        value: 'Nusrat',
        comparable: true,
        sourceDocumentId: 'doc-pass',
      },
    ],
    pendingReadings: [],
    pendingCheckDocumentIds: [],
    sections: { activated: new Set(), notApplicable: new Set(), noneDeclared: new Set() },
    // Six cases, one more than a card lists, so the link to the rest is shown.
    cases: ['Study Visa', 'Family Visit', 'Work Trip', 'Tour', 'Medical', 'Business'].map(
      (title, index) => ({ id: `case-${index}`, title, hasChecklist: true, readiness: null }),
    ),
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

  it('with documents and a case it shows the Bengali Coming Up, Open Cases and Open Profile labels and keeps the values and claims in English', async () => {
    mocks.getTravellerInsights.mockResolvedValue({ ok: true, value: populated() });
    const text = await render('bn');
    expect(text).toContain(bn[`${K}comingUp`]);
    expect(text).toContain(bn[`${K}openCases`]);
    expect(text).toContain(bn[`${K}openProfile`]);
    expect(text).not.toContain(bn[`${K}noDocumentsYet`]);
    expect(text).not.toContain(bn[`${K}eachVisaApplicationIsACase`]);
    expect(text).toContain('Study Visa');
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

describe('Bengali coverage of the insights surface', () => {
  it('every live Bengali message was rendered by a test above', () => {
    expectEveryLiveMessageRendered(applicantInsightsCatalog);
  });
});
