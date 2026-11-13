import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A signed-in stranger who knows a case id must not be able to tell a real case from a made-up one.
 * The services answer "case not found" for a made-up id and "not authorized for this case" for a
 * real one that is not theirs; the case screens must not pass either line on. Every case action
 * checks that the signed-in account owns the case BEFORE any work, and a stranger gets one fixed
 * answer either way, with nothing changed. The real owner is served exactly as before.
 */

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  getMissionForOwner: vi.fn(),
  transitionMission: vi.fn(),
  snapshotMission: vi.fn(),
  selectEvidence: vi.fn(),
  unselectEvidence: vi.fn(),
  createTask: vi.fn(),
  decideTask: vi.fn(),
  createAppointment: vi.fn(),
  decideAppointment: vi.fn(),
  setMissionItineraryRef: vi.fn(),
  updateMissionCaseDetails: vi.fn(),
  recordOutcome: vi.fn(),
  recordSubmission: vi.fn(),
  fileComplaint: vi.fn(),
  withdrawOwnComplaint: vi.fn(),
  listComplaintsForMission: vi.fn(),
  submitFeedback: vi.fn(),
  generateCoverLetter: vi.fn(),
  explainReadinessGap: vi.fn(),
  computeReadiness: vi.fn(),
  listRequirements: vi.fn(),
  getCasePackage: vi.fn(),
  trackSubmissionAsAttempt: vi.fn(),
  selectableChecklists: vi.fn(),
  attachChecklistFor: vi.fn(),
  tryEstablishStepUp: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess: mocks.requireAccess,
  getMissionForOwner: mocks.getMissionForOwner,
  transitionMission: mocks.transitionMission,
  snapshotMission: mocks.snapshotMission,
  selectEvidence: mocks.selectEvidence,
  unselectEvidence: mocks.unselectEvidence,
  createTask: mocks.createTask,
  decideTask: mocks.decideTask,
  createAppointment: mocks.createAppointment,
  decideAppointment: mocks.decideAppointment,
  setMissionItineraryRef: mocks.setMissionItineraryRef,
  updateMissionCaseDetails: mocks.updateMissionCaseDetails,
  recordOutcome: mocks.recordOutcome,
  recordSubmission: mocks.recordSubmission,
  fileComplaint: mocks.fileComplaint,
  withdrawOwnComplaint: mocks.withdrawOwnComplaint,
  listComplaintsForMission: mocks.listComplaintsForMission,
  submitFeedback: mocks.submitFeedback,
  generateCoverLetter: mocks.generateCoverLetter,
  explainReadinessGap: mocks.explainReadinessGap,
  computeReadiness: mocks.computeReadiness,
  listRequirements: mocks.listRequirements,
  getCasePackage: mocks.getCasePackage,
  trackSubmissionAsAttempt: mocks.trackSubmissionAsAttempt,
  isAiDispatchAllowed: vi.fn(),
  createContributorRequest: vi.fn(),
  revokeContributorRequest: vi.fn(),
  deleteCancelledMission: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  unstable_rethrow: vi.fn(),
}));
vi.mock('../../../../lib/ai', () => ({ resolveAiExplainer: vi.fn() }));
vi.mock('../../../../lib/base-url', () => ({ resolveBaseUrl: () => 'https://example.test' }));
vi.mock('../../../../lib/case-checklist-match', () => ({
  selectableChecklists: mocks.selectableChecklists,
  attachChecklistFor: mocks.attachChecklistFor,
}));
vi.mock('../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('../../../../lib/send-now', () => ({ sendEmailNow: vi.fn() }));
vi.mock('../../../../lib/step-up', () => ({
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'step up',
  tryEstablishStepUp: mocks.tryEstablishStepUp,
}));
vi.mock('../../../../lib/upgrade-offer', () => ({ upgradeLineForRefusal: async () => ({}) }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: { tag: 'db' }, accountId: 'stranger-account', self: {} }),
}));

const actions = await import('./actions');
const { CASE_HIDDEN_LINE, COMPLAINT_HIDDEN_LINE } = await import('../../../../lib/hidden-record');

const PREV = { ok: true, message: '' };
const OWN_WORDS = 'The service says this in its own words.';
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

interface CaseAction {
  readonly name: string;
  readonly run: () => Promise<unknown>;
  /** Everything that must stay untouched for a stranger. */
  readonly untouched: () => ReadonlyArray<ReturnType<typeof vi.fn>>;
  /** What the real owner's request reaches first, and which then speaks in its own words. */
  readonly first: () => ReturnType<typeof vi.fn>;
  /** The fixed line a stranger gets; a complaint has its own. */
  readonly hidden?: string;
}
const M = { missionId: 'case-1' };
const CASE_ACTIONS: readonly CaseAction[] = [
  {
    name: 'attachPackAction',
    run: () => actions.attachPackAction(PREV, form({ ...M, packVersionId: 'pv1' })),
    untouched: () => [mocks.getMissionForOwner, mocks.attachChecklistFor],
    first: () => mocks.getMissionForOwner,
  },
  {
    name: 'transitionMissionAction',
    run: () => actions.transitionMissionAction(PREV, form({ ...M, to: 'IN_PROGRESS' })),
    untouched: () => [mocks.transitionMission],
    first: () => mocks.transitionMission,
  },
  {
    name: 'snapshotMissionAction',
    run: () => actions.snapshotMissionAction(PREV, form(M)),
    untouched: () => [mocks.snapshotMission],
    first: () => mocks.snapshotMission,
  },
  {
    name: 'selectEvidenceAction',
    run: () =>
      actions.selectEvidenceAction(PREV, form({ ...M, packRequirementId: 'r1', factId: 'f1' })),
    untouched: () => [mocks.selectEvidence],
    first: () => mocks.selectEvidence,
  },
  {
    name: 'unselectEvidenceAction',
    run: () => actions.unselectEvidenceAction(PREV, form({ ...M, selectionId: 's1' })),
    untouched: () => [mocks.unselectEvidence],
    first: () => mocks.unselectEvidence,
  },
  {
    name: 'createTaskAction',
    run: () => actions.createTaskAction(PREV, form({ ...M, description: 'Translate' })),
    untouched: () => [mocks.createTask],
    first: () => mocks.createTask,
  },
  {
    name: 'decideTaskAction',
    run: () => actions.decideTaskAction(PREV, form({ ...M, taskId: 't1', status: 'DONE' })),
    untouched: () => [mocks.decideTask],
    first: () => mocks.decideTask,
  },
  {
    name: 'createAppointmentAction',
    run: () =>
      actions.createAppointmentAction(
        PREV,
        form({
          ...M,
          title: 'Interview',
          localDate: '2027-01-02',
          localTime: '10:00',
          timezone: 'Asia/Dhaka',
        }),
      ),
    untouched: () => [mocks.createAppointment],
    first: () => mocks.createAppointment,
  },
  {
    name: 'decideAppointmentAction',
    run: () =>
      actions.decideAppointmentAction(PREV, form({ ...M, appointmentId: 'a1', status: 'DONE' })),
    untouched: () => [mocks.decideAppointment],
    first: () => mocks.decideAppointment,
  },
  {
    name: 'setItineraryRefAction',
    run: () => actions.setItineraryRefAction(PREV, form({ ...M, itineraryRef: 'family-trip' })),
    untouched: () => [mocks.setMissionItineraryRef],
    first: () => mocks.setMissionItineraryRef,
  },
  {
    name: 'updateCaseDetailsAction',
    run: () =>
      actions.updateCaseDetailsAction(
        PREV,
        form({ ...M, jurisdiction: 'UK', serviceCategory: 'visit' }),
      ),
    untouched: () => [mocks.updateMissionCaseDetails],
    first: () => mocks.updateMissionCaseDetails,
  },
  {
    name: 'recordOutcomeAction',
    run: () =>
      actions.recordOutcomeAction(
        PREV,
        form({ ...M, decision: 'APPROVED', decisionDate: '2027-01-02' }),
      ),
    untouched: () => [mocks.recordOutcome, mocks.tryEstablishStepUp],
    first: () => mocks.recordOutcome,
  },
  {
    name: 'recordSubmissionAction',
    run: () =>
      actions.recordSubmissionAction(
        PREV,
        form({ ...M, channel: 'EMAIL', externalReportDescription: 'Sent by email' }),
      ),
    untouched: () => [mocks.recordSubmission, mocks.tryEstablishStepUp],
    first: () => mocks.recordSubmission,
  },
  {
    name: 'fileComplaintAction',
    run: () => actions.fileComplaintAction(PREV, form({ ...M, description: 'It was slow' })),
    untouched: () => [mocks.fileComplaint],
    first: () => mocks.fileComplaint,
  },
  {
    name: 'withdrawComplaintAction',
    run: () => actions.withdrawComplaintAction(PREV, form({ ...M, complaintId: 'c1' })),
    untouched: () => [mocks.withdrawOwnComplaint],
    first: () => mocks.withdrawOwnComplaint,
    hidden: COMPLAINT_HIDDEN_LINE,
  },
  {
    name: 'submitFeedbackAction',
    run: () => actions.submitFeedbackAction(PREV, form({ ...M, comments: 'Helpful' })),
    untouched: () => [mocks.submitFeedback],
    first: () => mocks.submitFeedback,
  },
  {
    name: 'generateLetterAction',
    run: () => actions.generateLetterAction(PREV, form(M)),
    untouched: () => [mocks.generateCoverLetter],
    first: () => mocks.generateCoverLetter,
  },
  {
    name: 'explainReadinessGapAction',
    run: () => actions.explainReadinessGapAction(PREV, form({ ...M, packRequirementId: 'r1' })),
    untouched: () => [mocks.getMissionForOwner, mocks.explainReadinessGap],
    first: () => mocks.getMissionForOwner,
  },
];

const SERVICE_FUNCTIONS = [
  mocks.getMissionForOwner,
  mocks.transitionMission,
  mocks.snapshotMission,
  mocks.selectEvidence,
  mocks.unselectEvidence,
  mocks.createTask,
  mocks.decideTask,
  mocks.createAppointment,
  mocks.decideAppointment,
  mocks.setMissionItineraryRef,
  mocks.updateMissionCaseDetails,
  mocks.recordOutcome,
  mocks.recordSubmission,
  mocks.fileComplaint,
  mocks.withdrawOwnComplaint,
  mocks.submitFeedback,
  mocks.generateCoverLetter,
  mocks.explainReadinessGap,
  mocks.attachChecklistFor,
];

/** What the services themselves say today: two different lines for a real and a made-up case. */
function servicesSpeakFor(code: 'forbidden' | 'not_found') {
  const message = code === 'forbidden' ? 'not authorized for this case' : 'case not found';
  for (const service of SERVICE_FUNCTIONS) {
    service.mockResolvedValue({ ok: false, error: { code, message } });
  }
}

/** What the access gate says for someone who does not own the case. */
const GATE_REFUSALS = {
  'a real case that is not theirs': { code: 'forbidden', message: 'access denied (default_deny)' },
  'a made-up case': { code: 'not_found', message: 'record not found' },
} as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.selectableChecklists.mockResolvedValue({
    options: [{ packVersionId: 'pv1' }],
    fitting: null,
    lookupFailed: false,
  });
  mocks.tryEstablishStepUp.mockResolvedValue({ kind: 'ok' });
  mocks.listComplaintsForMission.mockResolvedValue({
    ok: true,
    value: [{ id: 'c1', filedByAccountId: 'stranger-account' }],
  });
});

describe.each(CASE_ACTIONS)('$name', (action) => {
  it('gives one identical, fixed answer for a real case that is not theirs and a made-up one, and changes nothing', async () => {
    const answers: unknown[] = [];
    for (const [, refusal] of Object.entries(GATE_REFUSALS)) {
      vi.clearAllMocks();
      mocks.requireAccess.mockResolvedValue({ ok: false, error: refusal });
      servicesSpeakFor(refusal.code);
      answers.push(await action.run());
      for (const untouched of action.untouched()) expect(untouched).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0]).toEqual({ ok: false, message: action.hidden ?? CASE_HIDDEN_LINE });
  });

  it('also gives the fixed answer to someone who may view the case through a share but does not own it', async () => {
    mocks.requireAccess.mockResolvedValue({
      ok: true,
      value: { actor: { kind: 'organization_member' } },
    });
    servicesSpeakFor('forbidden');
    expect(await action.run()).toEqual({
      ok: false,
      message: action.hidden ?? CASE_HIDDEN_LINE,
    });
    for (const untouched of action.untouched()) expect(untouched).not.toHaveBeenCalled();
  });

  it('serves the real owner as before: the work runs and the service speaks in its own words', async () => {
    mocks.requireAccess.mockResolvedValue({
      ok: true,
      value: { actor: { kind: 'applicant_owner' } },
    });
    action.first().mockResolvedValue({ ok: false, error: { code: 'invalid', message: OWN_WORDS } });
    const answer = await action.run();
    expect(answer).toEqual({ ok: false, message: OWN_WORDS });
    expect(action.first()).toHaveBeenCalled();
  });
});

describe('withdrawComplaintAction and a complaint that is not the signed-in account’s own', () => {
  it('gives one identical, fixed answer for a real complaint filed by someone else and a made-up one', async () => {
    mocks.requireAccess.mockResolvedValue({
      ok: true,
      value: { actor: { kind: 'applicant_owner' } },
    });
    mocks.withdrawOwnComplaint.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'only the filer can withdraw their own complaint' },
    });
    mocks.listComplaintsForMission.mockResolvedValue({
      ok: true,
      value: [{ id: 'real-but-theirs', filedByAccountId: 'someone-else' }],
    });
    const real = await actions.withdrawComplaintAction(
      PREV,
      form({ ...M, complaintId: 'real-but-theirs' }),
    );
    mocks.withdrawOwnComplaint.mockResolvedValue({
      ok: false,
      error: { code: 'not_found', message: 'complaint not found' },
    });
    const madeUp = await actions.withdrawComplaintAction(
      PREV,
      form({ ...M, complaintId: 'made-up' }),
    );
    expect(real).toEqual(madeUp);
    expect(real).toEqual({ ok: false, message: COMPLAINT_HIDDEN_LINE });
    expect(mocks.withdrawOwnComplaint).not.toHaveBeenCalled();
  });
});

describe('the answers a case owner already got', () => {
  it('still withdraws their own complaint', async () => {
    mocks.requireAccess.mockResolvedValue({
      ok: true,
      value: { actor: { kind: 'applicant_owner' } },
    });
    mocks.withdrawOwnComplaint.mockResolvedValue({ ok: true, value: {} });
    const answer = await actions.withdrawComplaintAction(PREV, form({ ...M, complaintId: 'c1' }));
    expect(answer).toEqual({ ok: true, message: 'Complaint withdrawn.' });
    expect(mocks.withdrawOwnComplaint).toHaveBeenCalledWith(
      { tag: 'db' },
      { actorAccountId: 'stranger-account', complaintId: 'c1' },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/mission/case-1');
  });

  it('still moves the case and refreshes the page', async () => {
    mocks.requireAccess.mockResolvedValue({
      ok: true,
      value: { actor: { kind: 'applicant_owner' } },
    });
    mocks.transitionMission.mockResolvedValue({ ok: true, value: {} });
    const answer = await actions.transitionMissionAction(PREV, form({ ...M, to: 'IN_PROGRESS' }));
    expect(answer).toEqual({ ok: true, message: 'Case moved to In Progress.' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/mission/case-1');
  });
});
