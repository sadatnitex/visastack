import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appApplicantCatalog } from '../../../../../i18n/app-applicant';
import { primeLocale } from '../../../../../lib/i18n-server';
import { renderServer, stub, textOf } from '../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  hasConsent: vi.fn(),
  listPendingProposals: vi.fn(async (): Promise<unknown[]> => []),
  listApplicantProfile: vi.fn(async (): Promise<unknown[]> => []),
  listDocumentsDetailed: vi.fn(),
  requireAccess: vi.fn(),
  listDocumentReadingStates: vi.fn(),
  aiFeature: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  hasConsent: mocks.hasConsent,
  listPendingProposals: mocks.listPendingProposals,
  listApplicantProfile: mocks.listApplicantProfile,
  listDocumentsDetailed: mocks.listDocumentsDetailed,
  requireAccess: mocks.requireAccess,
  listDocumentReadingStates: mocks.listDocumentReadingStates,
  getAiFeatureStates: async () => ({ ai_document_reading: { available: mocks.aiFeature() } }),
}));
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
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('../../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('../../../../../components/auto-refresh', () => ({ AutoRefresh: stub('AutoRefresh') }));
vi.mock('../document-suggestion-card', () => ({
  DocumentSuggestionCard: stub('DocumentSuggestionCard'),
}));
vi.mock('../ai-review', () => ({
  DocumentFindings: stub('DocumentFindings'),
  ReadAgainButton: stub('ReadAgainButton'),
}));

const { default: WhatWeFoundPage } = await import('./page');

const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const K = 'appApplicant.appApplicantIdReviewPage.';
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const BENGALI = /[ঀ-৿]/;

async function render(locale: 'en' | 'bn', batch?: string) {
  current.holder = null;
  current.locale = locale;
  await primeLocale();
  return textOf(
    await renderServer(
      WhatWeFoundPage({
        params: Promise.resolve({ id: 'a1' }),
        searchParams: Promise.resolve(batch ? { batch } : {}),
      }),
    ),
  );
}

const doc = (id: string, name: string) => ({
  id,
  originalName: `${id}.pdf`,
  approvedName: name,
  latestVersionId: `${id}-v1`,
  processingStatus: 'APPROVED',
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({
    id: 'a1',
    ownerAccountId: 'acct-1',
    displayName: 'Nazmus Sadat',
  });
  mocks.hasConsent.mockResolvedValue(true);
  mocks.listPendingProposals.mockResolvedValue([]);
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { proof: 'owner' } });
  mocks.aiFeature.mockReturnValue(true);
  mocks.listDocumentReadingStates.mockResolvedValue({
    ok: true,
    value: { states: new Map(), sourceOfRun: new Map() },
  });
  mocks.listDocumentsDetailed.mockResolvedValue({
    ok: true,
    value: [doc(D1, 'Passport, Nazmus'), doc(D2, 'National ID, Nazmus')],
  });
});
afterEach(() => {
  current.locale = 'en';
});

describe('the What We Found page under Bengali', () => {
  it('says one file is saved, in Bengali digits and words, for a one-file batch', async () => {
    const text = await render('bn', D1);
    expect(text).toContain(bn[`${K}yourFilesAreSaved`]);
    expect(text).toContain(bn[`${K}1FileSaved`]);
    expect(text).not.toMatch(/appApplicant\./);
  });

  it('says how many files are saved, with the count in Bengali digits, for a larger batch', async () => {
    const text = await render('bn', `${D1},${D2}`);
    expect(text).toContain(bn[`${K}yourFilesAreSaved`]);
    expect(text).toContain(bn[`${K}lengthFilesSaved`]?.replace('{length}', '২'));
  });

  it('keeps what the AI found, and the page title when browsing, in English', async () => {
    const text = await render('bn');
    expect(`${K}whatWeFound` in bn).toBe(false);
    expect(text).toContain(en[`${K}whatWeFound`]);
  });

  it('is the same English as before under English', async () => {
    const text = await render('en', `${D1},${D2}`);
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('Your Files Are Saved');
    expect(text).toContain('2 Files Saved');
  });
});
