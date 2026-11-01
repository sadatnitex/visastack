import { AI_FEATURE_LIMIT_HINT, AI_FEATURE_OFF_HINT } from '@visastack/core/ai-features';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  /** The Manage registry as lanes will fill it: empty unless a test registers an action. */
  registry: {} as Record<string, { label: string; Component: () => null }>,
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
}));
vi.mock('../../../../../lib/ai', () => ({
  isClassificationConfigured: async () => false,
  isEnvAiExtractionConfigured: () => false,
  isInconsistencyConfigured: async () => false,
  isOcrConfigured: mocks.ocrConfigured,
  resolveAiExtractionAvailability: mocks.detailsAvailable,
}));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => 'en' }));
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

function doc(id: string, processingStatus: string) {
  return {
    id,
    originalName: `${id}.pdf`,
    approvedName: null,
    safetyStatus: 'CLEAN',
    processingStatus,
    classification: null,
    latestVersionId: `${id}-v1`,
    pendingNameVersion: null,
    documentDate: null,
    docType: null,
    subject: null,
  };
}

const render = async (document?: string, extra: Record<string, string> = {}) =>
  renderServer(
    DocumentsPage({
      params: Promise.resolve({ id: 'a1' }),
      searchParams: Promise.resolve({ ...(document ? { document } : {}), ...extra }),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({ id: 'a1', ownerAccountId: 'acct-1' });
  mocks.getWalletView.mockResolvedValue({ ok: true, value: [] });
  mocks.hasConsent.mockResolvedValue(true);
  mocks.loadUploadQuotaConfig.mockReturnValue({
    maxUploadBytes: 5 * 1024 * 1024,
    maxApplicantEvidenceBytes: 50 * 1024 * 1024,
  });
});

describe('the documents page while the server is still working on a file', () => {
  it('keeps itself up to date and says so, so nobody uploads the file again', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc('passport', 'SCANNING'), doc('statement', 'AWAITING_REVIEW')],
    });
    const html = await render();
    expect(stubProps<{ active: boolean }>(html, 'AutoRefresh')).toEqual([{ active: true }]);
    expect(textOf(html)).toContain(
      'Some documents are still being checked, which can take a few minutes. This page updates by itself, so there is no need to upload them again.',
    );
  });

  it('watches a file in every in-flight state', async () => {
    for (const state of ['UPLOADING', 'QUARANTINED', 'SCANNING', 'NORMALIZING', 'EXTRACTING']) {
      mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [doc('d', state)] });
      const [props] = stubProps<{ active: boolean }>(await render(), 'AutoRefresh');
      expect(props, state).toEqual({ active: true });
    }
  });

  it('stops watching once every file is ready, waiting for a person, or has failed', async () => {
    for (const state of ['AWAITING_REVIEW', 'APPROVED', 'NEEDS_ATTENTION', 'FAILED', 'REJECTED']) {
      mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [doc('d', state)] });
      const html = await render();
      expect(stubProps<{ active: boolean }>(html, 'AutoRefresh'), state).toEqual([
        { active: false },
      ]);
      expect(textOf(html), state).not.toContain('still being checked');
    }
  });

  it('is not watching an empty vault', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
    const html = await render();
    expect(stubProps<{ active: boolean }>(html, 'AutoRefresh')).toEqual([{ active: false }]);
    expect(textOf(html)).toContain('No Documents Yet');
  });
});

describe('a file that could not be used', () => {
  it('says what to do next, in plain words, for each way it can go wrong', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc('a', 'FAILED'), doc('b', 'NEEDS_ATTENTION'), doc('c', 'REJECTED')],
    });
    const text = (await Promise.all(['a', 'b', 'c'].map((id) => render(id)))).map(textOf).join(' ');
    expect(text).toContain(
      'We could not finish checking this file. Try uploading it again. If it keeps failing, contact support.',
    );
    expect(text).toContain(
      'This file could not be accepted as it is. Try a different copy, such as a clearer scan or a smaller file.',
    );
    expect(text).toContain('This file was rejected. Upload a different copy if you still need it.');
  });

  it('adds nothing under a file that is fine', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc('ok', 'AWAITING_REVIEW')],
    });
    const text = textOf(await render());
    expect(text).not.toContain('could not finish checking');
    expect(text).not.toContain('could not be accepted');
    expect(text).not.toContain('was rejected');
  });
});

describe('the upload form', () => {
  it('is told the limit the server really enforces, not a number written into the page', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
    // A 5 MB quota is capped at what one request to the host can carry (4 MB).
    const [uploader] = stubProps<{ applicantId: string; limitLabel: string }>(
      await render(),
      'DocumentUploader',
    );
    expect(uploader).toMatchObject({
      applicantId: 'a1',
      limitBytes: 4 * 1024 * 1024,
      limitLabel: '4 MB',
      pdfAccepted: true,
      virusScanning: false,
    });

    // A tighter quota is the limit itself.
    mocks.loadUploadQuotaConfig.mockReturnValue({
      maxUploadBytes: 2 * 1024 * 1024,
      maxApplicantEvidenceBytes: 50 * 1024 * 1024,
    });
    const [tight] = stubProps<{ limitLabel: string }>(await render(), 'DocumentUploader');
    expect(tight).toMatchObject({ limitBytes: 2 * 1024 * 1024, limitLabel: '2 MB' });
  });

  it('offers PDF on the built-in checks, and stops offering it when the owner switches PDF uploads off', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
    try {
      const [on] = stubProps<{ pdfAccepted: boolean }>(await render(), 'DocumentUploader');
      expect(on?.pdfAccepted).toBe(true);
      vi.stubEnv('PDF_UPLOADS', 'off');
      const [off] = stubProps<{ pdfAccepted: boolean }>(await render(), 'DocumentUploader');
      expect(off?.pdfAccepted).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('offers every catalogue kind of document, so a file can be filed under its category on upload', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
    const [uploader] = stubProps<{
      kindGroups: { choices: { key: string; label: string }[] }[];
    }>(await render(), 'DocumentUploader');
    const keys = (uploader?.kindGroups ?? []).flatMap((g) => g.choices.map((c) => c.key));
    expect(keys).toContain('PASSPORT');
    expect(keys).toContain('OTHER');
  });

  it('is not shown until core processing consent is granted, as before', async () => {
    mocks.hasConsent.mockResolvedValue(false);
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
    expect(stubProps(await render(), 'DocumentUploader')).toEqual([]);
  });
});

describe('saying what kind of document a file is', () => {
  it('shows the saved kind, offers Other types, and shows the name given to an Other document', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [{ ...doc('letter', 'APPROVED'), docType: 'OTHER', subject: 'Marriage Certificate' }],
    });
    const html = await render('letter');
    expect(html).toContain('Kind of Document');
    expect(html).toMatch(/<option value="OTHER" selected[^>]*>Other Document<\/option>/);
    expect(html).toContain('value="OTHER_FINANCIAL_DOCUMENT"');
    expect(html).toContain('value="Marriage Certificate"');
    expect(html).toContain('name="docType"');
  });

  it('says plainly when a kind could not be saved', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc('letter', 'APPROVED')],
    });
    const html = await renderServer(
      DocumentsPage({
        params: Promise.resolve({ id: 'a1' }),
        searchParams: Promise.resolve({ type_error: '1' }),
      }),
    );
    expect(textOf(html)).toContain("Couldn't save that kind of document");
  });
});

describe('naming a document', () => {
  it('lets the person rename each document, starting from the name it is listed under', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [{ ...doc('letter', 'APPROVED'), approvedName: 'Passport, Nazmus' }],
    });
    const [form] = stubProps<{ documentId: string; name: string }>(
      await render('letter'),
      'DocumentRenameForm',
    );
    expect(form).toMatchObject({
      applicantId: 'a1',
      documentId: 'letter',
      name: 'Passport, Nazmus',
    });
  });

  it('says when a stored file is a JPG copy of an iPhone photo, and only then', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [
        { ...doc('photo', 'APPROVED'), source: 'UPLOAD_CONVERTED_FROM_HEIC' },
        { ...doc('letter', 'APPROVED'), source: 'UPLOAD' },
      ],
    });
    const converted = textOf(await render('photo'));
    expect(converted).toContain('Saved as a JPG copy of the iPhone photo (HEIC)');
    expect(converted).toContain('The HEIC file itself was not kept.');
    expect(textOf(await render('letter'))).not.toContain('iPhone photo');
  });
});

describe('wallet ownership, explicit selection and truthful safety state', () => {
  it('refuses a foreign owner before reading document metadata', async () => {
    mocks.getApplicant.mockResolvedValue({ id: 'a1', ownerAccountId: 'foreign' });
    await expect(render()).rejects.toThrow();
    expect(mocks.listDocumentsDetailed).not.toHaveBeenCalled();
    expect(mocks.getWalletView).not.toHaveBeenCalled();
  });
  it('keeps quarantined approved-looking records out of ready totals and blocks preview', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [{ ...doc('unsafe', 'APPROVED'), safetyStatus: 'QUARANTINED' }],
    });
    mocks.getWalletView.mockResolvedValue({
      ok: true,
      value: [
        { document: { id: 'unsafe' }, status: 'CURRENT', usedInMissions: [], accessibleTo: [] },
      ],
    });
    const html = await render('unsafe');
    expect(html).toMatch(/Ready to Use<\/span><strong>0<\/strong>/);
    expect(textOf(html)).toContain('Preview is blocked');
    expect(html).not.toContain('>Preview</button>');
  });
  it('does not substitute an owned file for an unavailable explicit selection', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [doc('owned', 'APPROVED')] });
    const html = await render('foreign-or-removed');
    expect(textOf(html)).toContain('Selected Document Is Unavailable');
    expect(html).not.toContain('name="documentId"');
  });
  it('reports failed reads as unavailable rather than an empty wallet', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const html = await render();
    expect(textOf(html)).toContain('Unavailable records are not reported as an empty wallet');
    expect(textOf(html)).not.toContain('No Documents Yet');
  });
});

describe('filing each document under a category', () => {
  it('shows the kind in plain words with the sharing category it files under', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [
        { ...doc('passport', 'APPROVED'), docType: 'PASSPORT' },
        { ...doc('loose', 'APPROVED'), docType: null },
      ],
    });
    const text = textOf(await render());
    expect(text).toContain('Passport');
    expect(text).toContain('Identity');
    expect(text).toContain('Kind not set');
    expect(text).toContain('1 document has no kind set yet');
  });
});

describe('what we think a document is, waiting for the person (owner request 2026-10-25)', () => {
  it('shows one card with the suggested kind, name and Record group, and leaves the kind unset', async () => {
    mocks.getApplicant.mockResolvedValue({
      id: 'a1',
      ownerAccountId: 'acct-1',
      displayName: 'Anna Eriksson',
    });
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [
        {
          ...doc('statement', 'AWAITING_REVIEW'),
          classification: {
            classifiedType: 'BANK_STATEMENT',
            confidence: 67,
            reviewRequired: false,
          },
          pendingNameVersion: { id: 'n1', proposedName: 'Bank Statement - Anna Eriksson.pdf' },
        },
      ],
    });
    const html = await render('statement');
    const [card] = stubProps<{ suggestion: Record<string, unknown> }>(
      html,
      'DocumentSuggestionCard',
    );
    expect(card?.suggestion).toMatchObject({
      documentId: 'statement',
      nameVersionId: 'n1',
      kind: 'BANK_STATEMENT',
      recordGroup: 'Money',
      source: 'rules',
      proposedName: 'Bank Statement - Anna Eriksson.pdf',
    });
    expect(textOf(html)).toContain('Kind not set');
  });

  it('shows no card when nothing is waiting', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [{ ...doc('passport', 'APPROVED'), docType: 'PASSPORT' }],
    });
    expect(stubProps(await render('passport'), 'DocumentSuggestionCard')).toEqual([]);
  });
});

describe('the way to the document insights', () => {
  it('links from the documents page to the traveller insights page', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
    const html = await render();
    expect(html).toContain('href="/app/applicant/a1/insights"');
    expect(textOf(html)).toContain('See Document Insights');
  });
});

describe('visa photo sizes on a passport photo', () => {
  it('offers Visa Photo Sizes on a ready Photograph document and nowhere else', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [{ ...doc('photo', 'APPROVED'), docType: 'PHOTO' }],
    });
    expect(textOf(await render('photo'))).toContain('Visa Photo Sizes');

    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [{ ...doc('photo', 'SCANNING'), docType: 'PHOTO' }],
    });
    expect(textOf(await render('photo'))).not.toContain('Visa Photo Sizes');

    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [{ ...doc('passport', 'APPROVED'), docType: 'PASSPORT' }],
    });
    expect(textOf(await render('passport'))).not.toContain('Visa Photo Sizes');
  });
});

describe('safe copies (S23)', () => {
  it('shows each ready document its safe copy state and the Safe Copy section, from the owner proof', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [{ ...doc('passport', 'APPROVED'), docType: 'PASSPORT' }],
    });
    mocks.listRedactionStates.mockResolvedValueOnce({
      ok: true,
      value: new Map([['passport-v1', 'MASKED']]),
    });
    const html = await render('passport');
    expect(textOf(html)).toContain('Safe Copy: Ready');
    expect(html).toContain('id="safe-copy-passport"');
    expect(mocks.listRedactionStates).toHaveBeenCalledWith({ proof: 'owner' }, ['passport-v1']);
  });

  it('says when a saved copy is still being prepared', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc('statement', 'APPROVED')],
    });
    mocks.listRedactionStates.mockResolvedValueOnce({
      ok: true,
      value: new Map([['statement-v1', 'PREPARING']]),
    });
    const text = textOf(await render('statement'));
    expect(text).toContain('Safe Copy: Preparing');
    expect(text).toContain('Continue Preparing');
  });

  it('reads Not Prepared Yet when nothing is saved or the states cannot be read', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc('statement', 'APPROVED')],
    });
    mocks.listRedactionStates.mockResolvedValueOnce({ ok: false });
    expect(textOf(await render('statement'))).toContain('Safe Copy: Not Prepared Yet');
  });

  it('offers nothing for a file still being checked', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc('scanning', 'SCANNING')],
    });
    const html = await render('scanning');
    expect(textOf(html)).not.toContain('Safe Copy');
    expect(html).not.toContain('id="safe-copy-scanning"');
  });
});

describe('document reference codes (ADR 0018)', () => {
  it('reads the codes of the listed documents in one call and shows them with the document', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [doc('d1', 'READY')] });
    mocks.referenceCodesFor.mockResolvedValueOnce(new Map([['d1', 'D-7K2Q9M']]));
    const html = await render('d1');
    expect(mocks.referenceCodesFor).toHaveBeenCalledWith(expect.anything(), 'D', ['d1']);
    expect(textOf(html)).toContain('Document Reference');
    expect(html).toContain('D-7K2Q9M');
  });

  it('shows no code, and no label, before migration 0091 has run', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [doc('d1', 'READY')] });
    expect(textOf(await render('d1'))).not.toContain('Document Reference');
  });
});

/** A file that finished intake, with the classification row that lets Read Again appear. */
const read = (id: string, processingStatus = 'AWAITING_REVIEW') => ({
  ...doc(id, processingStatus),
  classification: { classifiedType: null, reviewRequired: true },
});
const statesOf = (entries: Record<string, { stage: string; reason?: string }>) => ({
  ok: true,
  value: {
    states: new Map(Object.entries(entries).map(([id, state]) => [`${id}-v1`, state])),
    sourceOfRun: new Map(),
  },
});
const grants = (granted: readonly string[]) =>
  mocks.hasConsent.mockImplementation(async (_db: unknown, _account: unknown, type: string) =>
    granted.includes(type),
  );

describe('how each file’s reading is going (ADR 0019)', () => {
  it('names the state under each file in the five states, and nothing once every suggestion is decided', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => read(id)),
    });
    mocks.listDocumentReadingStates.mockResolvedValue(
      statesOf({
        a: { stage: 'checking' },
        b: { stage: 'reading' },
        c: { stage: 'found' },
        d: { stage: 'could_not_read', reason: 'NOTHING_FOUND' },
        e: { stage: 'needs_attention' },
        f: { stage: 'done' },
      }),
    );
    const text = async (id: string) => textOf(await render(id));
    expect(await text('a')).toContain('Checking the File');
    expect(await text('b')).toContain('Reading the File');
    expect(await text('c')).toContain('We Found These Details');
    expect(await text('d')).toContain('We Could Not Read This One');
    expect(await text('e')).toContain('Needs Attention');
    const done = await text('f');
    for (const name of ['Checking the File', 'Reading the File', 'We Found These Details']) {
      expect(done).not.toContain(name);
    }
    expect(done).not.toContain('We Could Not Read This One');
  });

  it('gives a file that could not be read a way forward: add the details yourself', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [read('d')] });
    mocks.listDocumentReadingStates.mockResolvedValue(
      statesOf({ d: { stage: 'could_not_read', reason: 'LIMIT_REACHED' } }),
    );
    const html = await render('d');
    expect(textOf(html)).toContain('We reached a reading limit for this file.');
    expect(html).toContain('href="/app/applicant/a1/profile"');
    expect(textOf(html)).toContain('Add the Details Yourself');
  });

  it('keeps the page’s plain advice for a failed file, once, in the status', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [read('e', 'NEEDS_ATTENTION')],
    });
    mocks.listDocumentReadingStates.mockResolvedValue(
      statesOf({ e: { stage: 'needs_attention' } }),
    );
    const text = textOf(await render('e'));
    const advice =
      'This file could not be accepted as it is. Try a different copy, such as a clearer scan or a smaller file.';
    expect(text.split(advice)).toHaveLength(2);
  });

  it('keeps watching a file whose reading is still queued, though the file itself is ready', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [read('b')] });
    mocks.listDocumentReadingStates.mockResolvedValue(statesOf({ b: { stage: 'reading' } }));
    expect(stubProps(await render('b'), 'AutoRefresh')).toEqual([{ active: true }]);
    mocks.listDocumentReadingStates.mockResolvedValue(statesOf({ b: { stage: 'found' } }));
    expect(stubProps(await render('b'), 'AutoRefresh')).toEqual([{ active: false }]);
  });

  it('asks the reading states only through the owner’s access proof, for the latest versions', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [read('a'), read('b')] });
    await render();
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      expect.anything(),
      { kind: 'account', accountId: 'acct-1' },
      'VIEW_METADATA',
      { applicantId: 'a1' },
      { purpose: 'self' },
    );
    expect(mocks.listDocumentReadingStates).toHaveBeenCalledWith({ proof: 'owner' }, [
      'a-v1',
      'b-v1',
    ]);
  });

  it('still shows the page, without states, when the reading states are refused', async () => {
    mocks.requireAccess.mockResolvedValueOnce({ ok: false, error: { code: 'forbidden' } });
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [read('e', 'NEEDS_ATTENTION')],
    });
    const text = textOf(await render('e'));
    expect(text).toContain('This file could not be accepted as it is.');
    expect(mocks.listDocumentReadingStates).not.toHaveBeenCalled();
  });
});

describe('the one invitation to switch reading on, and Read Again', () => {
  beforeEach(() => {
    mocks.detailsAvailable.mockResolvedValue('available');
    mocks.ocrConfigured.mockResolvedValue(true);
  });

  it('asks once for the whole page, however many documents there are', async () => {
    grants(['CORE_PROCESSING']);
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [read('a'), read('b')] });
    const text = textOf(await render());
    expect(text.split('Want VisaStack to read your documents for you?')).toHaveLength(2);
    expect(text).toContain('Turn On Reading with AI');
  });

  it('is not shown once reading is on, when it cannot be used here, or before processing is allowed', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [read('a')] });
    grants(['CORE_PROCESSING', 'AI_EXTRACTION', 'AI_OCR']);
    expect(textOf(await render())).not.toContain('Want VisaStack to read');
    grants(['CORE_PROCESSING']);
    mocks.detailsAvailable.mockResolvedValue('unconfigured');
    mocks.ocrConfigured.mockResolvedValue(false);
    expect(textOf(await render())).not.toContain('Want VisaStack to read');
    mocks.detailsAvailable.mockResolvedValue('available');
    mocks.ocrConfigured.mockResolvedValue(true);
    grants([]);
    expect(textOf(await render())).not.toContain('Want VisaStack to read');
  });

  it('offers Read Again after the first reading is over, never while it runs, and only when reading is on', async () => {
    grants(['CORE_PROCESSING', 'AI_EXTRACTION']);
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: ['a', 'b', 'c', 'd'].map((id) => read(id)),
    });
    mocks.listDocumentReadingStates.mockResolvedValue(
      statesOf({
        a: { stage: 'reading' },
        b: { stage: 'found' },
        c: { stage: 'could_not_read', reason: 'NOTHING_FOUND' },
        d: { stage: 'checking' },
      }),
    );
    const offered = async (id: string) => stubProps(await render(id), 'ReadAgainButton').length;
    expect(await offered('a')).toBe(0);
    expect(await offered('b')).toBe(1);
    expect(await offered('c')).toBe(1);
    expect(await offered('d')).toBe(0);
    const [props] = stubProps(await render('c'), 'ReadAgainButton');
    expect(props).toEqual({ applicantId: 'a1', documentVersionId: 'c-v1' });

    grants(['CORE_PROCESSING']);
    expect(await offered('c')).toBe(0);
  });

  it('puts the plain hint where Read Again was while Read with AI is off (S28), and keeps the rest', async () => {
    grants(['CORE_PROCESSING', 'AI_EXTRACTION']);
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [read('c')] });
    mocks.listDocumentReadingStates.mockResolvedValue(
      statesOf({ c: { stage: 'could_not_read', reason: 'FEATURE_OFF' } }),
    );
    mocks.aiFeatureOff.set('ai_document_reading', 'turned_off');
    try {
      const html = await render('c');
      expect(stubProps(html, 'ReadAgainButton')).toHaveLength(0);
      const text = textOf(html);
      expect(text).toContain(AI_FEATURE_OFF_HINT);
      expect(text).toContain('Automatic Reading is turned off right now');
      expect(text).not.toContain('try Read Again');
      mocks.aiFeatureOff.set('ai_document_reading', 'daily_limit');
      expect(textOf(await render('c'))).toContain(AI_FEATURE_LIMIT_HINT);
    } finally {
      mocks.aiFeatureOff.clear();
    }
  });

  it('shows the passport’s suggestions without any AI switch, each with where it came from', async () => {
    grants(['CORE_PROCESSING']);
    mocks.detailsAvailable.mockResolvedValue('unconfigured');
    mocks.ocrConfigured.mockResolvedValue(false);
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [read('p')] });
    mocks.listPendingProposals.mockResolvedValue([
      {
        proposal: {
          id: 'pr1',
          type: 'NEW',
          fieldKey: 'family_name',
          value: 'ERIKSSON',
          confidence: 100,
          rationale: 'Read from the passport’s machine-readable lines.',
          documentVersionId: 'p-v1',
          aiExtractionRunId: 'run-mrz',
        },
        evidence: [{ snippet: 'P<UTOERIKSSON<<ANNA', verified: true }],
      },
    ]);
    mocks.listDocumentReadingStates.mockResolvedValue({
      ok: true,
      value: {
        states: new Map([['p-v1', { stage: 'found' }]]),
        sourceOfRun: new Map([['run-mrz', 'machine_readable']]),
      },
    });
    const [findings] = stubProps<{ proposals: { fieldKey: string; source?: string }[] }>(
      await render('p'),
      'DocumentFindings',
    );
    expect(findings?.proposals).toHaveLength(1);
    expect(findings?.proposals[0]).toMatchObject({
      fieldKey: 'family_name',
      source: 'machine_readable',
    });
  });
});

describe('the documents page with the depth switch (CCD-3)', () => {
  it('opens at Browse when a link picks one document, so it never lands hidden', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc('passport', 'APPROVED')],
    });
    for (const saved of ['auto', 'glance']) {
      mocks.depth = saved;
      expect(await render('passport'), saved).toContain('data-depth="browse"');
    }
    mocks.depth = 'everything';
    expect(await render('passport')).toContain('data-depth="everything"');
    mocks.depth = 'glance';
    expect(await render()).toContain('data-depth="glance"');
    mocks.depth = 'auto';
  });
});

describe('archive, Recently Deleted and the Manage menu (resource lifecycle, migration 0113)', () => {
  const state = (value: string, replaced = false) => ({
    state: value,
    replaced,
    archivedAt: null,
    deletedAt: null,
    purgeAfter: null,
    deletePath: null,
  });
  beforeEach(async () => {
    mocks.registry = {};
    const real = await vi.importActual<typeof import('@visastack/services')>('@visastack/services');
    mocks.availableDocumentActions.mockImplementation((view) =>
      real.availableDocumentActions(view as Parameters<typeof real.availableDocumentActions>[0]),
    );
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: [doc('kept', 'APPROVED'), doc('shelved', 'APPROVED'), doc('binned', 'APPROVED')],
    });
  });

  it('renders exactly as before while the lifecycle tables are missing', async () => {
    const html = await render();
    expect(mocks.lifecycleTablesPresent).toHaveBeenCalled();
    expect(mocks.getDocumentLifecycles).not.toHaveBeenCalled();
    expect(mocks.listDeletionReceipts).not.toHaveBeenCalled();
    expect(mocks.availableDocumentActions).not.toHaveBeenCalled();
    expect(html).not.toContain('aria-label="Document lists"');
    expect(html).not.toContain('aria-haspopup="menu"');
    for (const name of ['kept.pdf', 'shelved.pdf', 'binned.pdf'])
      expect(textOf(html)).toContain(name);
    // Even a hand-written list address shows the one list.
    const archived = await render(undefined, { view: 'archived' });
    expect(textOf(archived)).toContain('binned.pdf');
  });

  it('shows no tabs while nothing is archived or deleted, and no menu while no action is registered', async () => {
    mocks.lifecycleTablesPresent.mockResolvedValue(true);
    mocks.getDocumentLifecycles.mockResolvedValue(
      new Map([
        ['kept', state('CURRENT')],
        ['shelved', state('CURRENT')],
        ['binned', state('CURRENT')],
      ]),
    );
    const html = await render();
    expect(mocks.availableDocumentActions).toHaveBeenCalledTimes(3);
    expect(html).not.toContain('aria-label="Document lists"');
    expect(stubProps(html, 'ManageMenu')).toEqual([]);
    // Not even an empty wrapper: every row is exactly as before.
    expect(html).not.toContain('wallet-document-manage');
  });

  it('gives each row its menu once a lane registers an action, and a reminder link opens it', async () => {
    mocks.registry = { ARCHIVE: { label: 'Archive', Component: () => null } };
    mocks.lifecycleTablesPresent.mockResolvedValue(true);
    mocks.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: Array.from({ length: 14 }, (_, i) => doc(`d${i}`, 'APPROVED')),
    });
    mocks.getDocumentLifecycles.mockResolvedValue(
      new Map(
        Array.from({ length: 14 }, (_, i) => [`d${i}`, state(i === 13 ? 'ARCHIVED' : 'CURRENT')]),
      ),
    );
    const html = await render();
    const menus = stubProps<{ documentId: string; actions: string[] }>(html, 'ManageMenu');
    expect(menus).toHaveLength(12);
    expect(menus[0]).toMatchObject({ documentId: 'd0', actions: ['ARCHIVE'] });
    expect(html).toContain('wallet-document-manage');

    // A reminder for an archived document on what would be page two: its list opens, it comes
    // first and is selected; RESTORE is not registered, so no action opens by itself.
    const linked = await render(undefined, { manage: 'd13', action: 'RESTORE' });
    expect(textOf(linked)).toContain('Archived (1)');
    const archivedLink = linked.match(/<a [^>]*>Archived<span/)?.[0] ?? '';
    expect(archivedLink).toContain('aria-current="page"');
    expect(textOf(linked)).toContain('d13.pdf');
    expect(textOf(linked)).not.toContain('d0.pdf');

    mocks.getDocumentLifecycles.mockResolvedValue(
      new Map(Array.from({ length: 14 }, (_, i) => [`d${i}`, state('CURRENT')])),
    );
    const archiveLink = await render(undefined, { manage: 'd13', action: 'ARCHIVE' });
    const first = stubProps<{ documentId: string; initialAction?: string }>(
      archiveLink,
      'ManageMenu',
    )[0];
    expect(first).toMatchObject({ documentId: 'd13', initialAction: 'ARCHIVE' });
    const ignored = await render(undefined, { manage: 'd13', action: 'DESTROY' });
    expect(
      stubProps<{ initialAction?: string }>(ignored, 'ManageMenu')[0]?.initialAction,
    ).toBeUndefined();
  });

  it('splits the documents into Current, Archived and Recently Deleted once there is something to show', async () => {
    mocks.lifecycleTablesPresent.mockResolvedValue(true);
    mocks.getDocumentLifecycles.mockResolvedValue(
      new Map([
        ['kept', state('CURRENT')],
        ['shelved', state('ARCHIVED')],
        ['binned', state('RECENTLY_DELETED')],
      ]),
    );
    const current = await render();
    expect(current).toContain('aria-label="Document lists"');
    expect(textOf(current)).toContain('Archived (1)');
    expect(textOf(current)).toContain('Recently Deleted (1)');
    expect(textOf(current)).toContain('kept.pdf');
    expect(textOf(current)).not.toContain('shelved.pdf');
    expect(textOf(current)).not.toContain('binned.pdf');
    expect(textOf(current)).not.toContain('Removal Records');

    const archived = await render(undefined, { view: 'archived' });
    expect(textOf(archived)).toContain('shelved.pdf');
    expect(textOf(archived)).not.toContain('kept.pdf');
    const deleted = await render(undefined, { view: 'deleted' });
    expect(textOf(deleted)).toContain('binned.pdf');
    expect(textOf(deleted)).not.toContain('shelved.pdf');
  });

  it('asks the service for every document, so the Recently Deleted tab lists a deleted one (LC-A2)', async () => {
    // The service's default list leaves Recently Deleted documents out; only `all` keeps them.
    mocks.listDocumentsDetailed.mockImplementation(
      async (_db: unknown, _account: unknown, _id: unknown, options?: { lifecycle?: string }) => ({
        ok: true,
        value:
          options?.lifecycle === 'all'
            ? [doc('kept', 'APPROVED'), doc('binned', 'APPROVED')]
            : [doc('kept', 'APPROVED')],
      }),
    );
    mocks.lifecycleTablesPresent.mockResolvedValue(true);
    mocks.getDocumentLifecycles.mockResolvedValue(
      new Map([
        ['kept', state('CURRENT')],
        ['binned', state('RECENTLY_DELETED')],
      ]),
    );
    const deleted = await render(undefined, { view: 'deleted' });
    expect(textOf(deleted)).toContain('binned.pdf');
    expect(textOf(deleted)).not.toContain('kept.pdf');
  });

  it('links to the Removal Records only when there are some', async () => {
    mocks.lifecycleTablesPresent.mockResolvedValue(true);
    mocks.getDocumentLifecycles.mockResolvedValue(new Map([['kept', state('CURRENT')]]));
    mocks.listDeletionReceipts.mockResolvedValue({ ok: true, value: [{ id: 'r1' }] });
    const html = await render();
    expect(html).toContain('href="/app/applicant/a1/removal-records"');
    expect(textOf(html)).toContain('Removal Records');
  });
});
