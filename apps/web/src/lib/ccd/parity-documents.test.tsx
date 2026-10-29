import { vi } from 'vitest';
import { renderServer, stub } from '../next-mocks.test-support';
import { registerParity } from './parity-kit.test-support';

/** Documents (screen 05): see parity-kit.test-support.ts for how the comparison works. */

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  getWalletView: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  hasConsent: vi.fn(),
  loadUploadQuotaConfig: vi.fn(),
  listPendingProposals: vi.fn(),
  selected: undefined as string | undefined,
  depth: 'auto',
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  getWalletView: mocks.getWalletView,
  listDocumentsDetailed: mocks.listDocumentsDetailed,
  hasConsent: mocks.hasConsent,
  loadUploadQuotaConfig: mocks.loadUploadQuotaConfig,
  referenceCodesFor: async () => new Map([['passport', 'DOC-7K2M']]),
  getApplicantEvidenceBytes: async () => 0,
  getLatestOcrRun: async () => undefined,
  listIssuerVerificationsForDocument: async () => [],
  listPendingDocumentTypeProposals: async () => [],
  listPendingInconsistencyFlags: async () => [],
  listPendingProposals: mocks.listPendingProposals,
  listApplicantProfile: async () => [],
  requireAccess: async () => ({ ok: true, value: { proof: 'owner' } }),
  listDocumentReadingStates: async () => ({
    ok: true,
    value: { states: new Map(), sourceOfRun: new Map() },
  }),
}));
vi.mock('../ai', () => ({
  isClassificationConfigured: async () => false,
  isEnvAiExtractionConfigured: () => false,
  isInconsistencyConfigured: async () => false,
  isOcrConfigured: async () => false,
  resolveAiExtractionAvailability: async () => 'unconfigured',
}));
vi.mock('../locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('./depth.server', () => ({ readDepth: async () => mocks.depth }));
vi.mock('../../app/app/applicant/[id]/download-actions', () => ({
  downloadOriginalAction: async () => undefined,
}));
vi.mock('../../app/app/applicant/[id]/actions', () => ({
  previewDocumentAction: async () => undefined,
  requestDocumentReadingAction: vi.fn(),
  setDocumentDateAction: async () => undefined,
  setDocumentTypeAction: async () => undefined,
}));
vi.mock('../../app/app/applicant/[id]/document-rename-form', () => ({
  DocumentRenameForm: stub('DocumentRenameForm'),
}));
vi.mock('../../app/app/applicant/[id]/ai-review', () => ({
  AiProposalReview: stub('AiProposalReview'),
  DocumentFindings: stub('DocumentFindings'),
  InconsistencyFlagReview: stub('InconsistencyFlagReview'),
  OcrResultView: stub('OcrResultView'),
  ReadAgainButton: stub('ReadAgainButton'),
  RunClassificationButton: stub('RunClassificationButton'),
  RunInconsistencyCheckButton: stub('RunInconsistencyCheckButton'),
}));
vi.mock('../../app/app/applicant/[id]/document-uploader', () => ({
  DocumentUploader: stub('DocumentUploader'),
}));
vi.mock('../../app/app/applicant/[id]/document-suggestion-card', () => ({
  DocumentSuggestionCard: stub('DocumentSuggestionCard'),
}));
vi.mock('../../components/auto-refresh', () => ({ AutoRefresh: stub('AutoRefresh') }));

const { default: DocumentsPage } = await import('../../app/app/applicant/[id]/documents/page');

function doc(id: string, processingStatus: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    originalName: `${id}.pdf`,
    approvedName: null,
    safetyStatus: 'CLEAN',
    processingStatus,
    classification: null,
    latestVersionId: `${id}-v1`,
    latestVersionNumber: 1,
    pendingNameVersion: null,
    documentDate: null,
    docType: null,
    subject: null,
    updatedAt: new Date('2026-10-20T00:00:00Z'),
    ...extra,
  };
}

registerParity({
  name: 'documents',
  reset: () => {
    vi.clearAllMocks();
    mocks.selected = undefined;
    mocks.depth = 'auto';
    mocks.getApplicant.mockResolvedValue({
      id: 'a1',
      ownerAccountId: 'acct-1',
      displayName: 'Karim Hossain',
    });
    mocks.getWalletView.mockResolvedValue({ ok: true, value: [] });
    mocks.hasConsent.mockResolvedValue(true);
    mocks.listPendingProposals.mockResolvedValue([]);
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
    mocks.loadUploadQuotaConfig.mockReturnValue({
      maxUploadBytes: 5 * 1024 * 1024,
      maxApplicantEvidenceBytes: 50 * 1024 * 1024,
    });
  },
  render: async () =>
    await renderServer(
      DocumentsPage({
        params: Promise.resolve({ id: 'a1' }),
        searchParams: Promise.resolve(mocks.selected ? { document: mocks.selected } : {}),
      }),
    ),
  states: [
    { name: 'empty wallet', setup: () => undefined },
    {
      name: 'core processing off with a document',
      setup: () => {
        mocks.hasConsent.mockResolvedValue(false);
        mocks.listDocumentsDetailed.mockResolvedValue({
          ok: true,
          value: [doc('passport', 'APPROVED', { docType: 'PASSPORT' })],
        });
      },
    },
    {
      name: 'several documents, one selected',
      setup: () => {
        mocks.selected = 'passport';
        mocks.listDocumentsDetailed.mockResolvedValue({
          ok: true,
          value: [
            doc('passport', 'APPROVED', { docType: 'PASSPORT', documentDate: '2026-01-10' }),
            doc('statement', 'AWAITING_REVIEW'),
            doc('broken', 'FAILED'),
            doc('scanning', 'SCANNING'),
          ],
        });
        mocks.getWalletView.mockResolvedValue({
          ok: true,
          value: [
            {
              document: { id: 'passport' },
              status: 'EXPIRING',
              usedInMissions: [],
              accessibleTo: [],
            },
          ],
        });
      },
    },
    {
      name: 'a failed file selected',
      setup: () => {
        mocks.selected = 'broken';
        mocks.listDocumentsDetailed.mockResolvedValue({
          ok: true,
          value: [doc('broken', 'FAILED')],
        });
      },
    },
    {
      name: 'records could not be loaded',
      setup: () => {
        mocks.listDocumentsDetailed.mockResolvedValue({
          ok: false,
          error: { code: 'upstream_error' },
        });
      },
    },
  ],
});
