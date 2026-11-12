import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appApplicantCatalog } from '../../../../../../i18n/app-applicant';
import { primeLocale } from '../../../../../../lib/i18n-server';
import { renderServer, stub, textOf } from '../../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  hasConsent: vi.fn(),
  loadUploadQuotaConfig: vi.fn(),
  familyBatchReady: vi.fn(async () => false),
  documentUploadReceiptsReady: vi.fn(async () => true),
  listPendingProposals: vi.fn(async (): Promise<unknown[]> => []),
  listApplicants: vi.fn(async (): Promise<unknown[]> => []),
  getAiFeatureStates: vi.fn(
    async (): Promise<unknown> => ({
      ai_automatic_reading: {
        feature: 'ai_automatic_reading',
        available: true,
        reason: null,
        dailyLimit: null,
      },
    }),
  ),
  listDocumentExceptions: vi.fn(async () => ({ exceptions: [] as unknown[], confirmed: [] })),
  malwareScanning: { value: 'unconfigured' as 'unconfigured' | 'available' },
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  hasConsent: mocks.hasConsent,
  loadUploadQuotaConfig: mocks.loadUploadQuotaConfig,
  getApplicantEvidenceBytes: async () => 0,
  storageLimitsForOwner: async (
    _db: unknown,
    _owner: string,
    config: { maxApplicantEvidenceBytes: number },
  ) => ({ personBytes: config.maxApplicantEvidenceBytes }),
  requireAccess: async () => ({ ok: true, value: { proof: 'owner' } }),
  familyBatchReady: mocks.familyBatchReady,
  documentUploadReceiptsReady: mocks.documentUploadReceiptsReady,
  listPendingProposals: mocks.listPendingProposals,
  listApplicants: mocks.listApplicants,
  getAiFeatureStates: mocks.getAiFeatureStates,
  listDocumentExceptions: mocks.listDocumentExceptions,
}));
vi.mock('../../../../../../lib/capabilities', () => ({
  resolvePlatformCapabilities: async () => ({ malwareScanning: mocks.malwareScanning.value }),
}));
vi.mock('server-only', () => ({}));
// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));
vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('../../document-uploader', () => ({ DocumentUploader: stub('DocumentUploader') }));
vi.mock('../../import/import-panel', () => ({ ImportPanel: stub('ImportPanel') }));
vi.mock('../../usage-meter', () => ({ UsageMeter: stub('UsageMeter') }));
vi.mock('./reading-switch', () => ({ ReadingSwitch: stub('ReadingSwitch') }));

const { default: AddDocumentsPage } = await import('./page');

const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const K = 'appApplicant.appApplicantIdDocumentsAddPage.';
const BENGALI = /[ঀ-৿]/;

async function render(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  await primeLocale();
  return textOf(
    await renderServer(
      AddDocumentsPage({
        params: Promise.resolve({ id: 'a1' }),
        searchParams: Promise.resolve({}),
      }),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.malwareScanning.value = 'unconfigured';
  mocks.getApplicant.mockResolvedValue({
    id: 'a1',
    ownerAccountId: 'acct-1',
    displayName: 'Karim Hossain',
  });
  mocks.hasConsent.mockResolvedValue(true);
  mocks.familyBatchReady.mockResolvedValue(false);
  mocks.documentUploadReceiptsReady.mockResolvedValue(true);
  mocks.listPendingProposals.mockResolvedValue([]);
  mocks.listApplicants.mockResolvedValue([]);
  mocks.getAiFeatureStates.mockResolvedValue({
    ai_automatic_reading: {
      feature: 'ai_automatic_reading',
      available: true,
      reason: null,
      dailyLimit: null,
    },
  });
  mocks.listDocumentExceptions.mockResolvedValue({ exceptions: [], confirmed: [] });
  mocks.loadUploadQuotaConfig.mockReturnValue({
    maxUploadBytes: 5 * 1024 * 1024,
    maxApplicantEvidenceBytes: 50 * 1024 * 1024,
  });
});
afterEach(() => {
  current.locale = 'en';
});

describe('the Add Documents page under Bengali', () => {
  it('shows the title, the quiet camera line and the side cards in Bengali', async () => {
    const text = await render('bn');
    for (const key of ['addDocuments', 'takeAPhotoOrSayWhat', 'whatHappensNext', 'openMyDocuments'])
      expect(text, key).toContain(bn[`${K}${key}`]);
    expect(text).not.toMatch(/appApplicant\./);
  });

  it('keeps the drop-your-files sentence, which speaks of automatic reading, in English', async () => {
    const text = await render('bn');
    expect(`${K}dropYourFilesOrAWhole` in bn).toBe(false);
    expect(text).toContain(
      en[`${K}dropYourFilesOrAWhole`] ?? en[`${K}dropYourFilesOrAWhole088508`],
    );
  });

  it('shows the state with details waiting and files needing an answer, held in English', async () => {
    mocks.listPendingProposals.mockResolvedValue([
      { proposal: { id: 'p', documentVersionId: 'v1' }, evidence: [] },
    ]);
    mocks.listDocumentExceptions.mockResolvedValue({
      exceptions: [{ documentId: 'd1' }],
      confirmed: [],
    });
    const text = await render('bn');
    expect(text).toContain(bn[`${K}addDocuments`]);
    expect(text).toContain('Needs');
    expect(text).not.toMatch(/appApplicant\./);
  });

  it('shows the consent-off state without Bengali, as it is held', async () => {
    mocks.hasConsent.mockResolvedValue(false);
    const text = await render('bn');
    expect(text).toContain('Let VisaStack Process My Details');
    expect(text).toContain(bn[`${K}addDocuments`]);
  });

  it('is the same English as before under English', async () => {
    const text = await render('en');
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('Add Documents');
    expect(text).toContain('Take a Photo, or Say What Kind of Document It Is');
  });
});
