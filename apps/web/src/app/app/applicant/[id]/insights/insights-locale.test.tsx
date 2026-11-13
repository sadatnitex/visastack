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
  it('shows Bengali headings and the signed-off summary claim in the empty state', async () => {
    mocks.getTravellerInsights.mockResolvedValue({ ok: true, value: empty() });
    const text = await render('bn');
    expect(text).toMatch(BENGALI);
    expect(text).toContain(bn[`${K}noDocumentsYet`]);
    expect(text).toContain(bn[`${K}noExpiryDatesYet`]);
    expect(text).toContain(bn[`${K}eachVisaApplicationIsACase`]);
    expect(text).toContain(bn[`${K}aSummaryOfYourSavedDocuments`]);
    expect(text).not.toContain(en[`${K}aSummaryOfYourSavedDocuments`]);
    expect(text).not.toMatch(/applicantInsights\.|\{[A-Za-z]+\}/);
  });

  it('with documents and a case it shows the Bengali Coming Up, Open Cases and Open Profile labels and the summary claim, and keeps the case names as they are', async () => {
    mocks.getTravellerInsights.mockResolvedValue({ ok: true, value: populated() });
    const text = await render('bn');
    expect(text).toContain(bn[`${K}comingUp`]);
    expect(text).toContain(bn[`${K}openCases`]);
    expect(text).toContain(bn[`${K}openProfile`]);
    // "No Documents Yet" and the section group "No Document Yet" share one Bengali wording, so the
    // empty state is checked by its own sentence instead.
    expect(text).toContain(bn[`${K}noDocumentYet`]);
    expect(text).not.toContain(bn[`${K}addADocumentAndAcceptWhat`]);
    // Open Documents stays English: the Details to Check card writes it in English too.
    expect(`${K}openDocuments` in bn).toBe(false);
    expect(text).not.toContain(bn[`${K}eachVisaApplicationIsACase`]);
    expect(text).toContain('Study Visa');
    expect(text).toContain(bn[`${K}aSummaryOfYourSavedDocuments`]);
    expect(text).not.toMatch(/applicantInsights\.|\{[A-Za-z]+\}/);
  });

  it('says in Bengali when the summary cannot load, with no raw key', async () => {
    mocks.getTravellerInsights.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const text = await render('bn');
    expect(text).toContain(bn[`${K}weCouldNotPutThisSummary`]);
    expect(text).not.toContain('We could not put this summary together just now.');
    expect(text).not.toMatch(/applicantInsights\./);
  });

  it('the documents list says which details a document backs, in Bengali', async () => {
    mocks.getTravellerInsights.mockResolvedValue({
      ok: true,
      value: buildTravellerInsights({
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
          {
            id: 'doc-bank',
            docType: 'BANK_STATEMENT',
            expiresAt: null,
            lifecycle: 'CURRENT',
            safetyStatus: 'CLEAN',
            createdAt: '2026-01-02T00:00:00Z',
            reminderThresholds: [],
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
        cases: [],
        now: new Date('2026-10-25T12:00:00Z'),
      }),
    });
    const text = await render('bn');
    expect(text).toContain(bn[`${K}backsNoSavedDetailsYet`]);
    expect(text).not.toContain(en[`${K}backsNoSavedDetailsYet`]);
    expect(text).not.toMatch(/applicantInsights\./);
  });

  it('a case that asks for a document usually handed in as the original shows the Bengali optional line', async () => {
    mocks.getTravellerInsights.mockResolvedValue({
      ok: true,
      value: buildTravellerInsights({
        documents: [],
        facts: [],
        pendingReadings: [],
        pendingCheckDocumentIds: [],
        sections: { activated: new Set(), notApplicable: new Set(), noneDeclared: new Set() },
        cases: [
          {
            id: 'case-1',
            title: 'Study Visa',
            hasChecklist: true,
            readiness: {
              overallState: 'NEEDS_ACTION',
              requiredCount: 1,
              satisfiedRequired: 0,
              requirementResults: [
                { kind: 'DOCUMENT', key: 'passport', optional: true, state: 'ATTENTION' },
              ],
            },
          },
        ],
        now: new Date('2026-10-25T12:00:00Z'),
      }),
    });
    const text = await render('bn');
    expect(text).toContain(bn[`${K}optionalForThisCase`]);
    expect(text).not.toContain(en[`${K}optionalForThisCase`]);
    expect(text).not.toMatch(/applicantInsights\./);
  });

  it('a detail that differs shows the Bengali note on what is compared (refill 3)', async () => {
    const base = populated();
    mocks.getTravellerInsights.mockResolvedValue({
      ok: true,
      value: {
        ...base,
        mismatches: [
          { key: 'm1', document: null, fieldKey: null, section: null, source: 'pending_reading' },
        ],
      },
    });
    const text = await render('bn');
    expect(text).toContain(bn[`${K}weOnlySayThatTwoDetails`]);
    expect(text).not.toContain(en[`${K}weOnlySayThatTwoDetails`]);
    expect(text).not.toContain(bn[`${K}nothingToCheck`]);
    expect(text).not.toMatch(/applicantInsights\./);
  });

  it('more dates than a card lists are counted in Bengali digits (refill 3)', async () => {
    const passport = (n: number) => ({
      id: `doc-${n}`,
      docType: 'PASSPORT',
      expiresAt: `2027-0${n}-23T12:00:00.000Z`,
      lifecycle: 'CURRENT' as const,
      safetyStatus: 'CLEAN' as const,
      createdAt: '2026-01-01T00:00:00Z',
      reminderThresholds: [90, 60, 30, 7, 0],
    });
    mocks.getTravellerInsights.mockResolvedValue({
      ok: true,
      value: buildTravellerInsights({
        documents: [1, 2, 3, 4, 5, 6].map(passport),
        facts: [],
        pendingReadings: [],
        pendingCheckDocumentIds: [],
        sections: { activated: new Set(), notApplicable: new Set(), noneDeclared: new Set() },
        cases: [],
        now: new Date('2026-10-25T12:00:00Z'),
      }),
    });
    const text = await render('bn');
    expect(text).toContain('৬টি তারিখের মধ্যে ৫টি দেখানো হচ্ছে।');
    expect(text).not.toContain('Showing 5 of 6 dates.');
    expect(text).not.toMatch(/applicantInsights\./);
  });

  it('with no open section the coverage card says so in Bengali (refill 3)', async () => {
    const base = empty();
    mocks.getTravellerInsights.mockResolvedValue({
      ok: true,
      value: { ...base, coverage: { ...base.coverage, sections: [], covered: 0 } },
    });
    const text = await render('bn');
    expect(text).toContain(bn[`${K}noSectionsToBackYet`]);
    expect(text).toContain(bn[`${K}openAProfileSectionThatA`]);
    expect(text).not.toContain(en[`${K}openAProfileSectionThatA`]);
    expect(text).not.toMatch(/applicantInsights\./);
  });

  it('keeps the embassy original-paper rule and its badge in English (official rule content)', () => {
    for (const k of ['embassiesUsuallyWantTheseHandedIn', 'usuallyOriginal']) {
      expect(`${K}${k}` in en).toBe(true);
      expect(`${K}${k}` in bn).toBe(false);
    }
  });

  it('has Bengali for the summary claim and the add-a-document claim (signed off 2026-11-12)', () => {
    for (const k of ['aSummaryOfYourSavedDocuments', 'addADocumentAndAcceptWhat']) {
      expect(`${K}${k}` in en).toBe(true);
      expect(`${K}${k}` in bn).toBe(true);
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
