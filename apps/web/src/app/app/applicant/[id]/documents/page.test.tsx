import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, stubProps, textOf } from '../../../../../lib/next-mocks.test-support';

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  getWalletView: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  hasConsent: vi.fn(),
  loadUploadQuotaConfig: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  getWalletView: mocks.getWalletView,
  listDocumentsDetailed: mocks.listDocumentsDetailed,
  hasConsent: mocks.hasConsent,
  loadUploadQuotaConfig: mocks.loadUploadQuotaConfig,
  getApplicantEvidenceBytes: async () => 0,
  getLatestOcrRun: async () => undefined,
  listIssuerVerificationsForDocument: async () => [],
  listPendingDocumentTypeProposals: async () => [],
  listPendingInconsistencyFlags: async () => [],
  listPendingProposals: async () => [],
}));
vi.mock('../../../../../lib/ai', () => ({
  createAiExtractor: () => undefined,
  isClassificationConfigured: async () => false,
  isInconsistencyConfigured: async () => false,
  isOcrConfigured: async () => false,
}));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('../download-actions', () => ({ downloadOriginalAction: async () => undefined }));
vi.mock('../actions', () => ({
  previewDocumentAction: async () => undefined,
  setDocumentDateAction: async () => undefined,
}));
vi.mock('../ai-review', () => ({
  AiProposalReview: stub('AiProposalReview'),
  DocumentTypeProposalReview: stub('DocumentTypeProposalReview'),
  InconsistencyFlagReview: stub('InconsistencyFlagReview'),
  OcrResultView: stub('OcrResultView'),
  RunAiExtractionButton: stub('RunAiExtractionButton'),
  RunClassificationButton: stub('RunClassificationButton'),
  RunInconsistencyCheckButton: stub('RunInconsistencyCheckButton'),
  RunOcrButton: stub('RunOcrButton'),
}));
vi.mock('../document-uploader', () => ({ DocumentUploader: stub('DocumentUploader') }));
vi.mock('../name-review', () => ({ NameReview: stub('NameReview') }));
vi.mock('../../../../../components/auto-refresh', () => ({ AutoRefresh: stub('AutoRefresh') }));

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
  };
}

const render = async (document?: string) =>
  renderServer(
    DocumentsPage({
      params: Promise.resolve({ id: 'a1' }),
      searchParams: Promise.resolve(document ? { document } : {}),
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
      'Some documents are still being checked. This page updates by itself, so there is no need to upload them again.',
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
    expect(textOf(html)).toContain('No documents yet');
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
    const [uploader] = stubProps<{ applicantId: string; limitLabel: string }>(
      await render(),
      'DocumentUploader',
    );
    expect(uploader).toEqual({ applicantId: 'a1', limitLabel: '5 MB', virusScanning: false });
  });

  it('is not shown until core processing consent is granted, as before', async () => {
    mocks.hasConsent.mockResolvedValue(false);
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
    expect(stubProps(await render(), 'DocumentUploader')).toEqual([]);
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
    expect(html).toMatch(/Ready to use<\/span><strong>0<\/strong>/);
    expect(textOf(html)).toContain('Preview is blocked');
    expect(html).not.toContain('>Preview</button>');
  });
  it('does not substitute an owned file for an unavailable explicit selection', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [doc('owned', 'APPROVED')] });
    const html = await render('foreign-or-removed');
    expect(textOf(html)).toContain('Selected document is unavailable');
    expect(html).not.toContain('name="documentId"');
  });
  it('reports failed reads as unavailable rather than an empty wallet', async () => {
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: false, error: { code: 'forbidden' } });
    const html = await render();
    expect(textOf(html)).toContain('Unavailable records are not reported as an empty wallet');
    expect(textOf(html)).not.toContain('No documents yet');
  });
});
