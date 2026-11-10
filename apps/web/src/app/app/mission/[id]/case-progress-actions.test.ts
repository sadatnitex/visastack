import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two case actions that change how much of a checklist is ready say so in their success line,
 * with the count taken from the same readiness source as the case page, and never a made-up number.
 */

const mocks = vi.hoisted(() => ({
  attachChecklistFor: vi.fn(),
  getMissionForOwner: vi.fn(),
  selectableChecklists: vi.fn(),
  selectEvidence: vi.fn(),
  unselectEvidence: vi.fn(),
  computeReadiness: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  getMissionForOwner: mocks.getMissionForOwner,
  selectEvidence: mocks.selectEvidence,
  unselectEvidence: mocks.unselectEvidence,
  computeReadiness: mocks.computeReadiness,
}));
vi.mock('../../../../lib/case-checklist-match', () => ({
  selectableChecklists: mocks.selectableChecklists,
  attachChecklistFor: mocks.attachChecklistFor,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('../../../../lib/ai', () => ({ resolveAiExplainer: vi.fn() }));
vi.mock('../../../../lib/base-url', () => ({ resolveBaseUrl: () => 'https://example.test' }));
vi.mock('../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('../../../../lib/step-up', () => ({
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'step up',
  tryEstablishStepUp: vi.fn(),
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { tag: 'db' }, accountId: 'owner' }),
}));

const { attachPackAction, selectEvidenceAction, unselectEvidenceAction } = await import(
  './actions'
);

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const PREV = { ok: true, message: '' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.attachChecklistFor.mockResolvedValue({ ok: true, value: {} });
  mocks.getMissionForOwner.mockResolvedValue({
    ok: true,
    value: { id: 'm1', destination: 'JP', purpose: 'tourism' },
  });
  mocks.selectableChecklists.mockResolvedValue({
    options: [{ packVersionId: 'p1' }],
    fitting: [],
    lookupFailed: false,
  });
  mocks.selectEvidence.mockResolvedValue({ ok: true, value: {} });
});

describe('attachPackAction', () => {
  it('says the checklist is attached and how many items are ready', async () => {
    mocks.computeReadiness.mockResolvedValue({
      ok: true,
      value: { requiredCount: 9, satisfiedRequired: 2 },
    });
    const result = await attachPackAction(PREV, form({ missionId: 'm1', packVersionId: 'p1' }));
    expect(result).toEqual({ ok: true, message: 'Checklist attached. 2 of 9 items ready.' });
    expect(mocks.computeReadiness).toHaveBeenCalledWith({ tag: 'db' }, 'm1');
  });

  it('gives no number when the count cannot be worked out', async () => {
    mocks.computeReadiness.mockResolvedValue({ ok: false, error: { code: 'invalid' } });
    const result = await attachPackAction(PREV, form({ missionId: 'm1', packVersionId: 'p1' }));
    expect(result).toEqual({ ok: true, message: 'Checklist attached.' });
  });

  it('gives no number for a checklist with nothing required, and never says 100 percent', async () => {
    mocks.computeReadiness.mockResolvedValue({
      ok: true,
      value: { requiredCount: 0, satisfiedRequired: 0 },
    });
    const result = await attachPackAction(PREV, form({ missionId: 'm1', packVersionId: 'p1' }));
    expect(result.message).toBe('Checklist attached.');
  });

  it('says nothing about progress when the checklist could not be attached', async () => {
    mocks.attachChecklistFor.mockResolvedValue({
      ok: false,
      error: { code: 'invalid', message: 'this checklist is not published' },
    });
    const result = await attachPackAction(PREV, form({ missionId: 'm1', packVersionId: 'p1' }));
    expect(result).toEqual({ ok: false, message: 'this checklist is not published' });
    expect(mocks.computeReadiness).not.toHaveBeenCalled();
  });
});

describe('attachPackAction, checklist must fit the case', () => {
  it('refuses a checklist the picker would not have offered, and attaches nothing', async () => {
    const result = await attachPackAction(PREV, form({ missionId: 'm1', packVersionId: 'other' }));
    expect(result).toEqual({
      ok: false,
      message: 'That checklist does not fit this case. Choose one from the list.',
    });
    expect(mocks.attachChecklistFor).not.toHaveBeenCalled();
  });

  it('says the checklists could not be loaded, never that none fits, when the look-up failed', async () => {
    mocks.selectableChecklists.mockResolvedValue({
      options: [],
      fitting: [],
      lookupFailed: true,
    });
    const result = await attachPackAction(PREV, form({ missionId: 'm1', packVersionId: 'p1' }));
    expect(result).toEqual({ ok: false, message: 'Checklists could not be loaded right now.' });
    expect(mocks.attachChecklistFor).not.toHaveBeenCalled();
  });

  it('refuses when the case cannot be read by this person', async () => {
    mocks.getMissionForOwner.mockResolvedValue({
      ok: false,
      error: { code: 'not_found', message: 'case not found' },
    });
    const result = await attachPackAction(PREV, form({ missionId: 'm1', packVersionId: 'p1' }));
    expect(result.ok).toBe(false);
    expect(mocks.attachChecklistFor).not.toHaveBeenCalled();
  });
});

describe('selectEvidenceAction', () => {
  it('says what was chosen and the new count after the choice', async () => {
    mocks.computeReadiness.mockResolvedValue({
      ok: true,
      value: { requiredCount: 9, satisfiedRequired: 3 },
    });
    const result = await selectEvidenceAction(
      PREV,
      form({ missionId: 'm1', packRequirementId: 'r1', documentId: 'd1' }),
    );
    expect(result).toEqual({
      ok: true,
      message: 'Evidence chosen for this item. 3 of 9 items ready.',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/mission/m1');
  });

  it('counts a single item the way it reads aloud', async () => {
    mocks.computeReadiness.mockResolvedValue({
      ok: true,
      value: { requiredCount: 1, satisfiedRequired: 1 },
    });
    const result = await selectEvidenceAction(
      PREV,
      form({ missionId: 'm1', packRequirementId: 'r1', factId: 'f1' }),
    );
    expect(result.message).toBe('Evidence chosen for this item. 1 of 1 item ready.');
  });
});

describe('a finished case refuses a change of evidence in plain words', () => {
  const FINISHED = 'This case is finished, so the files and answers it uses can no longer change.';
  const refusal = { ok: false, error: { code: 'invalid', message: FINISHED } };

  it('choosing shows the finished line and does not refresh the page or count readiness', async () => {
    mocks.selectEvidence.mockResolvedValue(refusal);
    const result = await selectEvidenceAction(
      PREV,
      form({ missionId: 'm1', packRequirementId: 'r1', documentId: 'd1' }),
    );
    expect(result).toEqual({ ok: false, message: FINISHED });
    expect(mocks.computeReadiness).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('removing shows the finished line and does not refresh the page', async () => {
    mocks.unselectEvidence.mockResolvedValue(refusal);
    const result = await unselectEvidenceAction(PREV, form({ missionId: 'm1', selectionId: 's1' }));
    expect(result).toEqual({ ok: false, message: FINISHED });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
