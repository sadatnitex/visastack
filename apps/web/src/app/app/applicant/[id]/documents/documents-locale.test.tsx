import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { primeLocale } from '../../../../../lib/i18n-server';
import { renderServer, stub, stubProps, textOf } from '../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  /** The AI feature switches (S28): every feature on unless a test turns one off. */
  aiFeatureOff: new Map<string, string>(),
  getApplicant: vi.fn(),
  getWalletView: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  hasConsent: vi.fn(),
  loadUploadQuotaConfig: vi.fn(),
  referenceCodesFor: vi.fn(async (): Promise<Map<string, string>> => new Map()),
  requireAccess: vi.fn(
    async (): Promise<{ ok: boolean; value?: unknown; error?: unknown }> => ({
      ok: true,
      value: { proof: 'owner' },
    }),
  ),
  listDocumentReadingStates: vi.fn(async () => ({
    ok: true,
    value: { states: new Map(), sourceOfRun: new Map() },
  })),
  listPendingProposals: vi.fn(async (): Promise<unknown[]> => []),
  listRedactionStates: vi.fn(
    async (): Promise<{ ok: boolean; value?: Map<string, string> }> => ({
      ok: true,
      value: new Map(),
    }),
  ),
  detailsAvailable: vi.fn(async () => 'unconfigured'),
  depth: 'auto' as string,
  ocrConfigured: vi.fn(async () => false),
  /** Resource lifecycle (migration 0113): missing unless a test says the tables are there. */
  lifecycleTablesPresent: vi.fn(async () => false),
  getDocumentLifecycles: vi.fn(async (): Promise<Map<string, unknown>> => new Map()),
  listDeletionReceipts: vi.fn(
    async (): Promise<{ ok: boolean; value: unknown[] }> => ({
      ok: true,
      value: [],
    }),
  ),
  availableDocumentActions: vi.fn((_view: unknown): string[] => []),
  listCopyPeople: vi.fn(
    async (): Promise<Array<{ applicantId: string; displayName: string }>> => [],
  ),
  /** The Manage registry as lanes will fill it: empty unless a test registers an action. */
  registry: {} as Record<string, { label: string; Component: () => null }>,
  /** What was really done to each latest file, by version id (document-scan-evidence.ts). */
  scanEvidence: new Map<string, { kind: string; scannedAt: string | null }>(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  getWalletView: mocks.getWalletView,
  listDocumentsDetailed: mocks.listDocumentsDetailed,
  hasConsent: mocks.hasConsent,
  loadUploadQuotaConfig: mocks.loadUploadQuotaConfig,
  referenceCodesFor: mocks.referenceCodesFor,
  getApplicantEvidenceBytes: async () => 0,
  // No plan storage rules here: the owner's limits are the upload settings.
  storageLimitsForOwner: async (
    _db: unknown,
    _owner: string,
    config: { maxAccountEvidenceBytes: number; maxApplicantEvidenceBytes: number },
  ) => ({
    accountBytes: config.maxAccountEvidenceBytes,
    personBytes: config.maxApplicantEvidenceBytes,
  }),
  getLatestOcrRun: async () => undefined,
  listIssuerVerificationsForDocument: async () => [],
  listPendingDocumentTypeProposals: async () => [],
  listPendingInconsistencyFlags: async () => [],
  listPendingProposals: mocks.listPendingProposals,
  listApplicantProfile: async () => [],
  requireAccess: mocks.requireAccess,
  getAiFeatureStates: async (_db: unknown, features: readonly string[]) =>
    Object.fromEntries(
      features.map((feature) => {
        const reason = mocks.aiFeatureOff.get(feature) ?? null;
        return [feature, { feature, available: reason === null, reason, dailyLimit: null }];
      }),
    ),
  listDocumentReadingStates: mocks.listDocumentReadingStates,
  listRedactionStates: mocks.listRedactionStates,
  lifecycleTablesPresent: mocks.lifecycleTablesPresent,
  getDocumentLifecycles: mocks.getDocumentLifecycles,
  listDeletionReceipts: mocks.listDeletionReceipts,
  availableDocumentActions: mocks.availableDocumentActions,
  listCopyPeople: mocks.listCopyPeople,
  loadVersionScanEvidence: async () => mocks.scanEvidence,
}));
vi.mock('../../../../../lib/ai', () => ({
  isClassificationConfigured: async () => false,
  isEnvAiExtractionConfigured: () => false,
  isInconsistencyConfigured: async () => false,
  isOcrConfigured: mocks.ocrConfigured,
  resolveAiExtractionAvailability: mocks.detailsAvailable,
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
vi.mock('../../../../../lib/ccd/depth.server', () => ({ readDepth: async () => mocks.depth }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('../download-actions', () => ({ downloadOriginalAction: async () => undefined }));
vi.mock('../actions', () => ({
  previewDocumentAction: async () => undefined,
  requestDocumentReadingAction: vi.fn(),
  setDocumentDateAction: async () => undefined,
  setDocumentTypeAction: async () => undefined,
}));
vi.mock('../document-rename-form', () => ({ DocumentRenameForm: stub('DocumentRenameForm') }));
vi.mock('../document-expiry-form', () => ({ DocumentExpiryForm: stub('DocumentExpiryForm') }));
vi.mock('../ai-review', () => ({
  AiProposalReview: stub('AiProposalReview'),
  DocumentFindings: stub('DocumentFindings'),
  InconsistencyFlagReview: stub('InconsistencyFlagReview'),
  OcrResultView: stub('OcrResultView'),
  ReadAgainButton: stub('ReadAgainButton'),
  RunClassificationButton: stub('RunClassificationButton'),
  RunInconsistencyCheckButton: stub('RunInconsistencyCheckButton'),
}));
vi.mock('../document-uploader', () => ({ DocumentUploader: stub('DocumentUploader') }));
vi.mock('../document-suggestion-card', () => ({
  DocumentSuggestionCard: stub('DocumentSuggestionCard'),
}));
vi.mock('../../../../../components/auto-refresh', () => ({ AutoRefresh: stub('AutoRefresh') }));
vi.mock('./manage/registry', () => ({
  get MANAGE_ACTIONS() {
    return mocks.registry;
  },
  registeredActions: (actions: readonly string[], registry = mocks.registry) =>
    actions.flatMap((action) => (registry[action] ? [{ action, entry: registry[action] }] : [])),
}));
vi.mock('./manage/manage-menu', () => ({ ManageMenu: stub('ManageMenu') }));

const { default: DocumentsPage } = await import('./page');

const BENGALI = /[ঀ-৿]/;
const visa = {
  id: 'visa',
  originalName: 'visa.pdf',
  approvedName: null,
  safetyStatus: 'CLEAN',
  processingStatus: 'APPROVED',
  classification: null,
  latestVersionId: 'visa-v1',
  pendingNameVersion: null,
  documentDate: null,
  docType: 'VISA',
  subject: null,
  expiresAt: '2031-04-30T00:00:00.000Z',
  expiry: { origin: 'TYPED', typedOn: '2031-04-30', mismatch: false, canType: true },
};

async function render(locale: 'en' | 'bn', document?: string) {
  current.holder = null;
  current.locale = locale;
  await primeLocale();
  return renderServer(
    DocumentsPage({
      params: Promise.resolve({ id: 'a1' }),
      searchParams: Promise.resolve(document ? { document } : {}),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scanEvidence.clear();
  mocks.getApplicant.mockResolvedValue({ id: 'a1', ownerAccountId: 'acct-1' });
  mocks.getWalletView.mockResolvedValue({ ok: true, value: [] });
  mocks.hasConsent.mockResolvedValue(true);
  mocks.loadUploadQuotaConfig.mockReturnValue({
    maxUploadBytes: 5 * 1024 * 1024,
    maxApplicantEvidenceBytes: 50 * 1024 * 1024,
  });
  mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [visa] });
});
afterEach(() => {
  current.locale = 'en';
});

describe('the documents page under Bengali', () => {
  it('hands the expiry form its saved and typed dates in Bengali digits', async () => {
    const [form] = stubProps<{ savedLabel: string; typedLabel: string }>(
      await render('bn', 'visa'),
      'DocumentExpiryForm',
    );
    expect(form?.savedLabel).toMatch(BENGALI);
    expect(form?.savedLabel).not.toMatch(/[0-9]/);
    expect(form?.typedLabel).toMatch(BENGALI);
    expect(form?.typedLabel).not.toMatch(/[0-9]/);
  });

  it('keeps the page words that are not drafted in English, with no raw key', async () => {
    const text = textOf(await render('bn', 'visa'));
    expect(text).not.toMatch(/appApplicant\./);
    expect(text).toContain('visa.pdf');
  });

  it('hands the same dates in English digits under English', async () => {
    const [form] = stubProps<{ savedLabel: string; typedLabel: string }>(
      await render('en', 'visa'),
      'DocumentExpiryForm',
    );
    expect(form?.savedLabel).toBe('Apr 30, 2031');
    expect(form?.typedLabel).toBe('Apr 30, 2031');
  });
});
