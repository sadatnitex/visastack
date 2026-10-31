import { MADE_UP_HEIC_SMALL } from '@visastack/adapters/testing';
import { AI_FEATURE_LIMIT_HINT } from '@visastack/core/ai-features';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR 0025 section 12.2: the upgrade line after a refusal. It is added only for the record's owner
 * acting for themselves, only for what their own plan decides (their storage, an AI feature's
 * daily limit), and only when `upgradeWouldHelp` says a plan on sale would help. The refusal's own
 * words never change.
 */

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  reserveUpload: vi.fn(),
  growUploadReservation: vi.fn(),
  requireAccess: vi.fn(),
  failUpload: vi.fn(),
  upgradeWouldHelp: vi.fn(),
  resolveAiExtractor: vi.fn(),
  resolveAiClassifier: vi.fn(),
  resolveAiInconsistencyChecker: vi.fn(),
  runExtraction: vi.fn(),
  suggestDocumentKind: vi.fn(),
  runInconsistencyCheck: vi.fn(),
  getLatestExtractedText: vi.fn(),
  reportServerError: vi.fn(),
  beginContributorSubmission: vi.fn(),
  abandonContributorSubmission: vi.fn(),
  getMissionForOwner: vi.fn(),
  computeReadiness: vi.fn(),
  listRequirements: vi.fn(),
  explainReadinessGap: vi.fn(),
  resolveAiExplainer: vi.fn(),
}));

/** The signed-in person as `withSession` gives them; a stand-in object, checked by identity. */
const SELF = { kind: 'self', accountId: 'owner-1' };
const DB = {};

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getApplicant: mocks.getApplicant,
  reserveUpload: mocks.reserveUpload,
  growUploadReservation: mocks.growUploadReservation,
  requireAccess: mocks.requireAccess,
  failUpload: mocks.failUpload,
  upgradeWouldHelp: mocks.upgradeWouldHelp,
  runExtraction: mocks.runExtraction,
  suggestDocumentKind: mocks.suggestDocumentKind,
  runInconsistencyCheck: mocks.runInconsistencyCheck,
  getLatestExtractedText: mocks.getLatestExtractedText,
  isAiDispatchAllowed: async () => true,
  beginContributorSubmission: mocks.beginContributorSubmission,
  abandonContributorSubmission: mocks.abandonContributorSubmission,
  getMissionForOwner: mocks.getMissionForOwner,
  computeReadiness: mocks.computeReadiness,
  listRequirements: mocks.listRequirements,
  explainReadinessGap: mocks.explainReadinessGap,
}));
vi.mock('../../../../lib/ai', () => ({
  resolveAiExtractor: mocks.resolveAiExtractor,
  resolveAiClassifier: mocks.resolveAiClassifier,
  resolveAiInconsistencyChecker: mocks.resolveAiInconsistencyChecker,
  resolveOcrAdapter: vi.fn(),
  resolveAiExplainer: mocks.resolveAiExplainer,
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
vi.mock('../../../../lib/storage', () => ({
  createStorage: () => ({ putObject: vi.fn(), getObject: vi.fn(), deleteObject: vi.fn() }),
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => unknown) =>
    fn({ db: DB, accountId: 'owner-1', email: 'owner@example.com', self: SELF }),
}));

const {
  runAiExtractionAction,
  runClassificationAction,
  runInconsistencyCheckAction,
  uploadDocumentAction,
} = await import('./actions');
const { submitContributorEvidenceAction } = await import(
  '../../contributor-requests/accept/actions'
);

const { explainReadinessGapAction } = await import('../../mission/[id]/actions');

const initial = { ok: true, message: '' };

const PERSON_FULL = {
  code: 'invalid',
  message: 'this applicant has reached its 50 MB evidence limit',
  reason: 'person_storage_limit',
} as const;
const ACCOUNT_FULL = {
  code: 'invalid',
  message: 'this account has reached its 100 MB evidence limit',
  reason: 'account_storage_limit',
} as const;
const AI_LIMIT = {
  code: 'invalid',
  message: AI_FEATURE_LIMIT_HINT,
  reason: 'ai_daily_limit',
} as const;

function upload(file = new File(['A plain text note.'], 'note.txt', { type: 'text/plain' })) {
  const form = new FormData();
  form.set('applicantId', 'a-1');
  form.set('file', file);
  return form;
}

function onDocument(): FormData {
  const form = new FormData();
  form.set('applicantId', 'a-1');
  form.set('documentVersionId', 'v-1');
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({ id: 'a-1', ownerAccountId: 'owner-1' });
  mocks.requireAccess.mockResolvedValue({ ok: true, value: { proof: 'owner of a-1' } });
  mocks.upgradeWouldHelp.mockResolvedValue(true);
  const ai = {
    ai: {},
    limits: { budgetLimitUnits: 1, perDocumentBudgetLimitUnits: 1, maxConcurrentCalls: 1 },
  };
  mocks.resolveAiExtractor.mockResolvedValue(ai);
  mocks.resolveAiClassifier.mockResolvedValue(ai);
  mocks.resolveAiInconsistencyChecker.mockResolvedValue(ai);
  mocks.getLatestExtractedText.mockResolvedValue('Some text read from the file.');
});

describe('an upload refused for storage (the record’s owner, for themselves)', () => {
  it('adds the line after the unchanged refusal, for their record’s room and their whole account', async () => {
    for (const [refusal, kind] of [
      [PERSON_FULL, 'person_storage'],
      [ACCOUNT_FULL, 'account_storage'],
    ] as const) {
      mocks.upgradeWouldHelp.mockClear();
      mocks.reserveUpload.mockResolvedValueOnce({ ok: false, error: refusal });
      const result = await uploadDocumentAction(initial, upload());
      expect(result).toEqual({ ok: false, message: refusal.message, upgrade: 'storage' });
      expect(mocks.upgradeWouldHelp).toHaveBeenCalledTimes(1);
      expect(mocks.upgradeWouldHelp).toHaveBeenCalledWith(DB, SELF, { kind });
    }
  });

  it('adds nothing when no plan on sale would help, and the refusal reads exactly as before', async () => {
    mocks.upgradeWouldHelp.mockResolvedValue(false);
    mocks.reserveUpload.mockResolvedValueOnce({ ok: false, error: PERSON_FULL });
    expect(await uploadDocumentAction(initial, upload())).toEqual({
      ok: false,
      message: PERSON_FULL.message,
    });
  });

  it('adds nothing, and never fails the refusal, when the answer cannot be read', async () => {
    mocks.upgradeWouldHelp.mockRejectedValue(new Error('database unavailable'));
    mocks.reserveUpload.mockResolvedValueOnce({ ok: false, error: ACCOUNT_FULL });
    expect(await uploadDocumentAction(initial, upload())).toEqual({
      ok: false,
      message: ACCOUNT_FULL.message,
    });
    expect(mocks.reportServerError).toHaveBeenCalledWith('upgradeLine', expect.any(Error));
  });

  it('never asks for a refusal no paid plan changes: an agency’s plan or the platform’s capacity', async () => {
    for (const error of [
      {
        code: 'invalid',
        message: 'The agency plan storage limit is reached.',
        reason: 'limit_reached',
      },
      {
        code: 'invalid',
        message: 'platform storage capacity reached; new uploads are temporarily paused',
      },
    ]) {
      mocks.reserveUpload.mockResolvedValueOnce({ ok: false, error });
      expect(await uploadDocumentAction(initial, upload())).toEqual({
        ok: false,
        message: error.message,
      });
    }
    expect(mocks.upgradeWouldHelp).not.toHaveBeenCalled();
  });

  it('adds the line after the converted copy’s own words when a larger iPhone photo copy does not fit', async () => {
    mocks.reserveUpload.mockResolvedValueOnce({
      ok: true,
      value: { id: 'intent-1', objectKey: 'key-1', reservedBytes: 100 },
    });
    mocks.growUploadReservation.mockResolvedValueOnce({ ok: false, error: PERSON_FULL });
    const heic = new File([Buffer.from(MADE_UP_HEIC_SMALL)], 'IMG_2041.HEIC', {
      type: 'image/heic',
    });
    expect(await uploadDocumentAction(initial, upload(heic))).toEqual({
      ok: false,
      message:
        'The converted copy does not fit in the storage space left. This applicant has reached its 50 MB evidence limit.',
      upgrade: 'storage',
    });
    expect(mocks.upgradeWouldHelp).toHaveBeenCalledWith(DB, SELF, { kind: 'person_storage' });
  });

  it('is never reached by someone who is not the record’s owner', async () => {
    mocks.getApplicant.mockResolvedValue({ id: 'a-1', ownerAccountId: 'someone-else' });
    mocks.reserveUpload.mockResolvedValue({ ok: false, error: PERSON_FULL });
    expect(await uploadDocumentAction(initial, upload())).toEqual({
      ok: false,
      message: 'Not authorized.',
    });
    expect(mocks.upgradeWouldHelp).not.toHaveBeenCalled();
  });
});

describe('a contributor’s upload refused for storage', () => {
  it('keeps its own words and never offers a plan: the room is the owner’s, not theirs', async () => {
    mocks.beginContributorSubmission.mockResolvedValue({
      ok: true,
      value: { id: 'request-1', applicantId: 'a-1' },
    });
    mocks.reserveUpload.mockResolvedValue({
      ok: false,
      error: {
        code: 'invalid',
        message: "the record owner's account has reached its evidence limit",
        reason: 'account_storage_limit',
      },
    });
    const form = new FormData();
    form.set('token', 'one-time-token');
    form.set('file', new File(['A plain text note.'], 'note.txt', { type: 'text/plain' }));
    expect(await submitContributorEvidenceAction(initial, form)).toEqual({
      ok: false,
      message: "the record owner's account has reached its evidence limit",
    });
    expect(mocks.upgradeWouldHelp).not.toHaveBeenCalled();
  });
});

describe('an AI feature refused for its daily limit', () => {
  it('adds the line after the unchanged words, asking about the feature that ran short', async () => {
    mocks.runExtraction.mockResolvedValueOnce({ ok: false, error: AI_LIMIT });
    expect(await runAiExtractionAction(initial, onDocument())).toEqual({
      ok: false,
      message: AI_FEATURE_LIMIT_HINT,
      upgrade: 'ai',
    });
    expect(mocks.upgradeWouldHelp).toHaveBeenLastCalledWith(DB, SELF, {
      kind: 'ai',
      feature: 'ai_document_reading',
    });

    mocks.runInconsistencyCheck.mockResolvedValueOnce({ ok: false, error: AI_LIMIT });
    expect(await runInconsistencyCheckAction(initial, onDocument())).toEqual({
      ok: false,
      message: AI_FEATURE_LIMIT_HINT,
      upgrade: 'ai',
    });
    expect(mocks.upgradeWouldHelp).toHaveBeenLastCalledWith(DB, SELF, {
      kind: 'ai',
      feature: 'ai_consistency_checks',
    });

    mocks.suggestDocumentKind.mockResolvedValueOnce({ ok: false, error: AI_LIMIT });
    expect(await runClassificationAction(initial, onDocument())).toEqual({
      ok: false,
      message: AI_FEATURE_LIMIT_HINT,
      upgrade: 'ai',
    });
    expect(mocks.upgradeWouldHelp).toHaveBeenLastCalledWith(DB, SELF, {
      kind: 'ai',
      feature: 'ai_document_kind',
    });
  });

  it('adds nothing when no plan on sale would help', async () => {
    mocks.upgradeWouldHelp.mockResolvedValue(false);
    mocks.runExtraction.mockResolvedValueOnce({ ok: false, error: AI_LIMIT });
    expect(await runAiExtractionAction(initial, onDocument())).toEqual({
      ok: false,
      message: AI_FEATURE_LIMIT_HINT,
    });
  });

  it('never asks for a feature that is off rather than used up', async () => {
    mocks.runExtraction.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'invalid',
        message: 'This AI feature is turned off.',
        reason: 'ai_feature_off',
      },
    });
    const result = await runAiExtractionAction(initial, onDocument());
    expect(result).not.toHaveProperty('upgrade');
    expect(mocks.upgradeWouldHelp).not.toHaveBeenCalled();
  });

  it('is never offered to someone the access gate lets ask who is not the record’s owner', async () => {
    // Agency staff or anyone else with access to the record: their refusal keeps its words only.
    mocks.getApplicant.mockResolvedValue({ id: 'a-1', ownerAccountId: 'someone-else' });
    mocks.suggestDocumentKind.mockResolvedValueOnce({ ok: false, error: AI_LIMIT });
    expect(await runClassificationAction(initial, onDocument())).toEqual({
      ok: false,
      message: AI_FEATURE_LIMIT_HINT,
    });
    expect(mocks.upgradeWouldHelp).not.toHaveBeenCalled();
  });
});

describe('Gap Explanations refused for its daily limit on a case', () => {
  beforeEach(() => {
    mocks.getMissionForOwner.mockResolvedValue({ ok: true, value: { packVersionId: 'pv-1' } });
    mocks.computeReadiness.mockResolvedValue({
      ok: true,
      value: {
        requirementResults: [
          {
            packRequirementId: 'r-1',
            state: 'CRITICAL_GAP',
            kind: 'DOCUMENT',
            key: 'k',
            optional: false,
          },
        ],
      },
    });
    mocks.listRequirements.mockResolvedValue([{ id: 'r-1', citation: 'Official list' }]);
    mocks.resolveAiExplainer.mockResolvedValue({
      ai: {},
      limits: { budgetLimitUnits: 1, maxConcurrentCalls: 1, cacheMaxAgeDays: 1 },
    });
  });

  const ask = () => {
    const form = new FormData();
    form.set('missionId', 'm-1');
    form.set('packRequirementId', 'r-1');
    return explainReadinessGapAction(initial, form);
  };

  it('adds the line after the unchanged words for the case’s owner, only when a plan would help', async () => {
    mocks.explainReadinessGap.mockResolvedValue({ ok: false, error: AI_LIMIT });
    expect(await ask()).toEqual({ ok: false, message: AI_FEATURE_LIMIT_HINT, upgrade: 'ai' });
    expect(mocks.upgradeWouldHelp).toHaveBeenCalledWith(DB, SELF, {
      kind: 'ai',
      feature: 'ai_explanations',
    });
    mocks.upgradeWouldHelp.mockResolvedValue(false);
    expect(await ask()).toEqual({ ok: false, message: AI_FEATURE_LIMIT_HINT });
  });

  it('is never reached by someone who does not own the case', async () => {
    mocks.getMissionForOwner.mockResolvedValue({
      ok: false,
      error: { code: 'not_found', message: 'case not found' },
    });
    mocks.explainReadinessGap.mockResolvedValue({ ok: false, error: AI_LIMIT });
    expect(await ask()).toEqual({ ok: false, message: 'case not found' });
    expect(mocks.upgradeWouldHelp).not.toHaveBeenCalled();
  });
});
