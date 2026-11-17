import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub } from '../../../../../lib/next-mocks.test-support';

/**
 * WP-PIC13: the Documents page chooses the passport cover from the nationality saved on the
 * profile, read only through the owner's gate proof, and hands the stack only the cover kind.
 */

const mocks = vi.hoisted(() => ({
  listApplicantProfile: vi.fn(),
  requireAccess: vi.fn(),
  browserProps: [] as Array<{ readonly nationality?: unknown }>,
}));

const PROOF = { proof: 'owner' };

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: async () => ({ id: 'a1', ownerAccountId: 'acct-1', displayName: 'Karim Hossain' }),
  getWalletView: async () => ({ ok: true, value: [] }),
  listDocumentsDetailed: async () => ({
    ok: true,
    value: [
      {
        id: 'passport',
        originalName: 'passport.pdf',
        approvedName: null,
        safetyStatus: 'CLEAN',
        processingStatus: 'READY',
        classification: null,
        latestVersionId: 'passport-v1',
        latestVersionNumber: 1,
        pendingNameVersion: null,
        documentDate: null,
        docType: 'passport',
        subject: null,
        updatedAt: new Date('2026-10-20T00:00:00Z'),
      },
    ],
  }),
  hasConsent: async () => true,
  loadUploadQuotaConfig: () => ({
    maxUploadBytes: 5 * 1024 * 1024,
    maxApplicantEvidenceBytes: 50 * 1024 * 1024,
  }),
  referenceCodesFor: async () => new Map(),
  getApplicantEvidenceBytes: async () => 0,
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
  listPendingProposals: async () => [],
  listApplicantProfile: mocks.listApplicantProfile,
  requireAccess: mocks.requireAccess,
  lifecycleTablesPresent: async () => false,
  listDocumentReadingStates: async () => ({
    ok: true,
    value: { states: new Map(), sourceOfRun: new Map() },
  }),
}));
vi.mock('../../../../../lib/ai', () => ({
  isClassificationConfigured: async () => false,
  isEnvAiExtractionConfigured: () => false,
  isInconsistencyConfigured: async () => false,
  isOcrConfigured: async () => false,
  resolveAiExtractionAvailability: async () => 'unconfigured',
}));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('../../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../download-actions', () => ({ downloadOriginalAction: async () => undefined }));
vi.mock('../actions', () => ({
  previewDocumentAction: async () => undefined,
  requestDocumentReadingAction: vi.fn(),
  setDocumentDateAction: async () => undefined,
  setDocumentTypeAction: async () => undefined,
}));
vi.mock('../document-rename-form', () => ({ DocumentRenameForm: stub('DocumentRenameForm') }));
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
vi.mock('../../../../../components/document-wallet-browser', () => ({
  DocumentWalletBrowser: (props: { readonly nationality?: unknown }) => {
    mocks.browserProps.push(props);
    return null;
  },
}));

const { default: DocumentsPage } = await import('./page');

interface Entry {
  readonly fieldKey: string;
  readonly value: string | null;
  readonly isCurrent: boolean;
  readonly isProtected?: boolean;
}

function historyPage(items: readonly Entry[], nextCursor: string | null = null) {
  return {
    ok: true,
    value: {
      items: items.map((item, n) => ({
        id: `v${n}`,
        factId: `f${n}`,
        packId: 'universal',
        repeatingRecordKey: null,
        isProtected: false,
        status: 'APPROVED',
        method: 'MANUAL',
        reason: null,
        actor: 'owner',
        createdAt: new Date('2026-11-01T00:00:00Z'),
        ...item,
      })),
      nextCursor,
      total: items.length,
    },
  };
}

/** The history read is the proof form: a second argument that is not an applicant id. */
function historyCalls() {
  return mocks.listApplicantProfile.mock.calls.filter((call) => typeof call[1] !== 'string');
}

async function coverProp(): Promise<unknown> {
  mocks.browserProps.length = 0;
  await renderServer(
    DocumentsPage({ params: Promise.resolve({ id: 'a1' }), searchParams: Promise.resolve({}) }),
  );
  expect(mocks.browserProps.length).toBeGreaterThan(0);
  return mocks.browserProps.at(-1)?.nationality;
}

describe('the passport cover on the Documents page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAccess.mockResolvedValue({ ok: true, value: PROOF });
    mocks.listApplicantProfile.mockImplementation(async (_db: unknown, subject: unknown) =>
      typeof subject === 'string' ? [] : historyPage([]),
    );
  });

  it('gives a Bangladeshi traveller the Bangladesh cover, read through the gate proof', async () => {
    mocks.listApplicantProfile.mockImplementation(async (_db: unknown, subject: unknown) =>
      typeof subject === 'string'
        ? []
        : historyPage([
            { fieldKey: 'given_name', value: 'Karim', isCurrent: true },
            { fieldKey: 'nationality', value: 'Bangladeshi', isCurrent: true },
          ]),
    );
    expect(await coverProp()).toBe('bangladesh');
    const calls = historyCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]?.[1]).toBe(PROOF);
    expect(calls[0]?.[2]).toMatchObject({ history: { pack: 'universal' } });
  });

  it('passes only the cover kind, never the saved value', async () => {
    mocks.listApplicantProfile.mockImplementation(async (_db: unknown, subject: unknown) =>
      typeof subject === 'string'
        ? []
        : historyPage([{ fieldKey: 'nationality', value: 'BGD', isCurrent: true }]),
    );
    const cover = await coverProp();
    expect(cover).toBe('bangladesh');
    expect(JSON.stringify(mocks.browserProps)).not.toContain('BGD');
  });

  it('uses the version in use now, not a newer or older one that is not', async () => {
    mocks.listApplicantProfile.mockImplementation(async (_db: unknown, subject: unknown) =>
      typeof subject === 'string'
        ? []
        : historyPage([
            { fieldKey: 'nationality', value: 'Bangladeshi', isCurrent: false },
            { fieldKey: 'nationality', value: 'Indian', isCurrent: true },
            { fieldKey: 'nationality', value: 'BD', isCurrent: false },
          ]),
    );
    expect(await coverProp()).toBe('neutral');
  });

  it('never unlocks a protected nationality', async () => {
    mocks.listApplicantProfile.mockImplementation(async (_db: unknown, subject: unknown) =>
      typeof subject === 'string'
        ? []
        : historyPage([
            { fieldKey: 'nationality', value: 'Bangladeshi', isCurrent: true, isProtected: true },
          ]),
    );
    expect(await coverProp()).toBe('neutral');
  });

  it('looks on older pages when the current nationality is further back', async () => {
    mocks.listApplicantProfile.mockImplementation(
      async (_db: unknown, subject: unknown, options: { history: { before?: string } }) => {
        if (typeof subject === 'string') return [];
        return options.history.before === 'page-2'
          ? historyPage([{ fieldKey: 'nationality', value: 'Bangladesh', isCurrent: true }])
          : historyPage([{ fieldKey: 'given_name', value: 'Karim', isCurrent: true }], 'page-2');
      },
    );
    expect(await coverProp()).toBe('bangladesh');
    expect(historyCalls().length).toBe(2);
  });

  it('stops after five pages and shows the neutral cover', async () => {
    mocks.listApplicantProfile.mockImplementation(async (_db: unknown, subject: unknown) =>
      typeof subject === 'string'
        ? []
        : historyPage([{ fieldKey: 'given_name', value: 'Karim', isCurrent: true }], 'more'),
    );
    expect(await coverProp()).toBe('neutral');
    expect(historyCalls().length).toBe(5);
  });

  it('shows the neutral cover for another nationality or none saved', async () => {
    mocks.listApplicantProfile.mockImplementation(async (_db: unknown, subject: unknown) =>
      typeof subject === 'string'
        ? []
        : historyPage([{ fieldKey: 'nationality', value: 'Singaporean', isCurrent: true }]),
    );
    expect(await coverProp()).toBe('neutral');
    mocks.listApplicantProfile.mockImplementation(async (_db: unknown, subject: unknown) =>
      typeof subject === 'string' ? [] : historyPage([]),
    );
    expect(await coverProp()).toBe('neutral');
  });

  it('shows the neutral cover and reads nothing when the gate refuses', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    expect(await coverProp()).toBe('neutral');
    expect(historyCalls().length).toBe(0);
  });

  it('shows the neutral cover when the history read is refused or fails', async () => {
    mocks.listApplicantProfile.mockImplementation(async (_db: unknown, subject: unknown) =>
      typeof subject === 'string' ? [] : { ok: false, error: { code: 'forbidden' } },
    );
    expect(await coverProp()).toBe('neutral');
    mocks.listApplicantProfile.mockImplementation(async (_db: unknown, subject: unknown) => {
      if (typeof subject === 'string') return [];
      throw new Error('database unavailable');
    });
    expect(await coverProp()).toBe('neutral');
  });
});
