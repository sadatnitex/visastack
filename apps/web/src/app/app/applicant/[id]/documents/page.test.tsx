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
  isEnvAiExtractionConfigured: () => false,
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
  requestDocumentReadingAction: vi.fn(),
  setDocumentDateAction: async () => undefined,
  setDocumentTypeAction: async () => undefined,
}));
vi.mock('../ai-review', () => ({
  AiProposalReview: stub('AiProposalReview'),
  DocumentFindings: stub('DocumentFindings'),
  InconsistencyFlagReview: stub('InconsistencyFlagReview'),
  OcrResultView: stub('OcrResultView'),
  RunAiExtractionButton: stub('RunAiExtractionButton'),
  RunClassificationButton: stub('RunClassificationButton'),
  RunInconsistencyCheckButton: stub('RunInconsistencyCheckButton'),
  RunOcrButton: stub('RunOcrButton'),
}));
vi.mock('../document-uploader', () => ({ DocumentUploader: stub('DocumentUploader') }));
vi.mock('../document-suggestion-card', () => ({
  DocumentSuggestionCard: stub('DocumentSuggestionCard'),
}));
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
    docType: null,
    subject: null,
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
    const [uploader] = stubProps<{ applicantId: string; limitLabel: string }>(
      await render(),
      'DocumentUploader',
    );
    expect(uploader).toMatchObject({ applicantId: 'a1', limitLabel: '5 MB', virusScanning: false });
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
