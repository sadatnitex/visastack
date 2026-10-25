import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  decideDocumentSuggestion: vi.fn(),
  suggestDocumentKind: vi.fn(),
  resolveAiClassifier: vi.fn(),
  resolveAiExtractor: vi.fn(),
  runExtraction: vi.fn(),
  reportServerError: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  requireAccess: mocks.requireAccess,
  decideDocumentSuggestion: mocks.decideDocumentSuggestion,
  suggestDocumentKind: mocks.suggestDocumentKind,
  runExtraction: mocks.runExtraction,
  getApplicant: async () => ({ id: 'a-1', ownerAccountId: 'owner-1' }),
  getLatestExtractedText: async () => 'some text',
  isAiDispatchAllowed: async () => true,
}));
vi.mock('../../../../lib/ai', () => ({
  resolveAiClassifier: mocks.resolveAiClassifier,
  resolveAiExtractor: mocks.resolveAiExtractor,
  resolveAiInconsistencyChecker: vi.fn(),
  resolveOcrAdapter: vi.fn(),
}));
vi.mock('../../../../lib/field-registry', () => ({
  ensureDocumentFieldsRegistered: async () => 0,
}));
vi.mock('../../../../lib/server-error', () => ({ reportServerError: mocks.reportServerError }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn }));
vi.mock('../../../../lib/jobs', () => ({ triggerIntakeWorker: vi.fn() }));
vi.mock('../../../../lib/providers', () => ({
  createKeyManagementPort: () => undefined,
  createPreviewRenderer: () => undefined,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: object; accountId: string }) => unknown) =>
    fn({ db: {}, accountId: 'owner-1' }),
}));

const { decideDocumentSuggestionAction, runAiExtractionAction, runClassificationAction } =
  await import('./actions');

const initial = { ok: true, message: '' };
const proof = { applicant: { id: 'a-1' } };
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  data.set('applicantId', 'a-1');
  data.set('documentId', 'd-1');
  data.set('nameVersionId', 'n-1');
  data.set('typeProposalId', '');
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue({ ok: true, value: proof });
});

describe('deciding the kind and name together', () => {
  it('accepts through the access gate as the owner, and says where the Record lists it', async () => {
    mocks.decideDocumentSuggestion.mockResolvedValue({
      ok: true,
      value: { decision: 'accept', docType: 'BANK_STATEMENT', approvedName: 'Bank.pdf' },
    });
    const result = await decideDocumentSuggestionAction(
      initial,
      form({ suggestionAction: 'accept', docType: 'BANK_STATEMENT', name: ' Bank.pdf ' }),
    );
    expect(result).toEqual({
      ok: true,
      message: 'Saved. It is listed under Money on your Record.',
    });
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'owner-1' },
      'MANAGE',
      { documentId: 'd-1' },
      { purpose: 'owner_document_suggestion' },
    );
    expect(mocks.decideDocumentSuggestion).toHaveBeenCalledWith(proof, {
      decision: 'accept',
      nameVersionId: 'n-1',
      typeProposalId: null,
      docType: 'BANK_STATEMENT',
      subject: '',
      name: 'Bank.pdf',
    });
  });

  it('skips without sending a kind or a name', async () => {
    mocks.decideDocumentSuggestion.mockResolvedValue({
      ok: true,
      value: { decision: 'skip', docType: null, approvedName: null },
    });
    const result = await decideDocumentSuggestionAction(
      initial,
      form({ suggestionAction: 'skip' }),
    );
    expect(result).toEqual({ ok: true, message: 'Skipped. Nothing was changed.' });
    expect(mocks.decideDocumentSuggestion).toHaveBeenCalledWith(proof, {
      decision: 'skip',
      nameVersionId: 'n-1',
      typeProposalId: null,
    });
  });

  it('refuses anyone the gate refuses, and a document of another applicant', async () => {
    mocks.requireAccess.mockResolvedValueOnce({ ok: false, error: { code: 'forbidden' } });
    expect(
      await decideDocumentSuggestionAction(initial, form({ suggestionAction: 'skip' })),
    ).toEqual({
      ok: false,
      message: 'Not authorized.',
    });
    mocks.requireAccess.mockResolvedValueOnce({ ok: true, value: { applicant: { id: 'a-2' } } });
    expect(
      await decideDocumentSuggestionAction(initial, form({ suggestionAction: 'skip' })),
    ).toEqual({
      ok: false,
      message: 'Not authorized.',
    });
    expect(mocks.decideDocumentSuggestion).not.toHaveBeenCalled();
  });

  it('points at the missing kind or name before saving anything', async () => {
    expect(
      await decideDocumentSuggestionAction(
        initial,
        form({ suggestionAction: 'accept', name: 'x' }),
      ),
    ).toMatchObject({ ok: false, field: 'docType' });
    expect(
      await decideDocumentSuggestionAction(
        initial,
        form({ suggestionAction: 'accept', docType: 'NID', name: '  ' }),
      ),
    ).toMatchObject({ ok: false, field: 'name' });
    expect(mocks.requireAccess).not.toHaveBeenCalled();
  });

  it('turns a refusal into a sentence', async () => {
    mocks.decideDocumentSuggestion.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'this suggestion has already been decided' },
    });
    expect(
      await decideDocumentSuggestionAction(
        initial,
        form({ suggestionAction: 'accept', docType: 'NID', name: 'x' }),
      ),
    ).toEqual({ ok: false, message: 'This suggestion has already been decided.' });
  });
});

describe('asking the AI what a document is', () => {
  const classify = () => {
    const data = new FormData();
    data.set('applicantId', 'a-1');
    data.set('documentVersionId', 'v-1');
    return runClassificationAction(initial, data);
  };

  it('goes through the gate for the applicant and passes the platform limits on', async () => {
    mocks.resolveAiClassifier.mockResolvedValue({
      ai: { name: 'stub' },
      limits: {
        budgetLimitUnits: 10,
        perDocumentBudgetLimitUnits: 2,
        maxAttemptsPerDocument: 3,
        maxPagesPerDocument: 4,
        cacheMaxAgeDays: 5,
        maxConcurrentCalls: 6,
      },
    });
    mocks.suggestDocumentKind.mockResolvedValue({ ok: true, value: { status: 'suggested' } });
    expect(await classify()).toEqual({
      ok: true,
      message: 'We suggested what kind of document this is and a name for it. Check them below.',
    });
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'owner-1' },
      'MANAGE',
      { applicantId: 'a-1' },
      { purpose: 'owner_document_suggestion' },
    );
    expect(mocks.suggestDocumentKind).toHaveBeenCalledWith(
      proof,
      { name: 'stub' },
      expect.objectContaining({
        documentVersionId: 'v-1',
        budgetLimitUnits: 10,
        maxConcurrentCalls: 6,
      }),
    );
  });

  it.each([
    ['kind_already_set', 'You already chose what kind of document this is. Nothing was changed.'],
    ['already_suggested', 'A suggestion for this document is already waiting below.'],
    [
      'rules_confident',
      'We already know what kind of document this is. Check the suggestion below.',
    ],
  ])('answers %s accurately', async (status, message) => {
    mocks.resolveAiClassifier.mockResolvedValue({ ai: {}, limits: { budgetLimitUnits: 1 } });
    mocks.suggestDocumentKind.mockResolvedValue({ ok: true, value: { status } });
    expect(await classify()).toEqual({ ok: true, message });
  });

  it('says plainly when nothing could be told, and when AI is not set up', async () => {
    mocks.resolveAiClassifier.mockResolvedValue({ ai: {}, limits: { budgetLimitUnits: 1 } });
    mocks.suggestDocumentKind.mockResolvedValue({ ok: true, value: { status: 'no_suggestion' } });
    expect(await classify()).toEqual({
      ok: true,
      message: 'We could not tell what kind of document this is. Choose the kind above.',
    });
    mocks.resolveAiClassifier.mockResolvedValue(undefined);
    expect(await classify()).toMatchObject({ ok: false });
    expect(mocks.suggestDocumentKind).toHaveBeenCalledTimes(1);
  });
});

describe('reading details from a document', () => {
  const read = () => {
    const data = new FormData();
    data.set('applicantId', 'a-1');
    data.set('documentVersionId', 'v-1');
    return runAiExtractionAction(initial, data);
  };
  beforeEach(() => {
    mocks.resolveAiExtractor.mockResolvedValue({ ai: {}, limits: { budgetLimitUnits: 1 } });
    mocks.runExtraction.mockResolvedValue({ ok: true, value: { proposals: [{}, {}] } });
  });

  it('also asks what kind of document it is, and says so', async () => {
    mocks.resolveAiClassifier.mockResolvedValue({ ai: {}, limits: { budgetLimitUnits: 1 } });
    mocks.suggestDocumentKind.mockResolvedValue({ ok: true, value: { status: 'suggested' } });
    expect(await read()).toEqual({
      ok: true,
      message:
        'AI extraction proposed 2 field(s) for review. It also suggested what kind of document this is and a name for it. Check them below.',
    });
  });

  it('never asks for the kind when the reading itself failed', async () => {
    mocks.resolveAiClassifier.mockResolvedValue({ ai: {}, limits: { budgetLimitUnits: 1 } });
    mocks.runExtraction.mockResolvedValue({
      ok: false,
      error: { code: 'upstream_error', message: 'provider down' },
    });
    expect(await read()).toEqual({ ok: false, message: 'provider down' });
    expect(mocks.suggestDocumentKind).not.toHaveBeenCalled();
    expect(mocks.resolveAiClassifier).not.toHaveBeenCalled();
  });

  it('keeps the details it read when asking for the kind fails or breaks', async () => {
    mocks.resolveAiClassifier.mockResolvedValue({ ai: {}, limits: { budgetLimitUnits: 1 } });
    mocks.suggestDocumentKind.mockResolvedValueOnce({
      ok: false,
      error: { code: 'upstream_error', message: 'timeout' },
    });
    expect(await read()).toEqual({
      ok: true,
      message: 'AI extraction proposed 2 field(s) for review.',
    });
    mocks.resolveAiClassifier.mockRejectedValueOnce(new Error('key store unavailable'));
    expect(await read()).toEqual({
      ok: true,
      message: 'AI extraction proposed 2 field(s) for review.',
    });
    expect(mocks.reportServerError).toHaveBeenCalledTimes(1);
  });
});
