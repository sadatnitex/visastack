import { serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { casePurposeGroups } from '../../lib/case-choices';

/**
 * Every web screen path that shows a case-flow refusal: the Bengali shows under bn and the exact
 * English under en. Each action is run with its service call refused by a keyed error; an action
 * still reading `error.message` shows English under bn and fails here.
 */

const locale = vi.hoisted(() => ({ value: 'en' as 'en' | 'bn' }));
const refusal = vi.hoisted(() => ({
  error: { code: 'invalid', message: 'English', messageKey: 'x', params: undefined } as {
    code: string;
    message: string;
    messageKey: string;
    params: undefined;
  },
  ok: new Set<string>(),
  value: {} as Record<string, unknown>,
}));

const SERVICE_FNS = [
  'getMissionForOwner',
  'computeReadiness',
  'listRequirements',
  'transitionMission',
  'deleteCancelledMission',
  'snapshotMission',
  'selectEvidence',
  'unselectEvidence',
  'createTask',
  'decideTask',
  'createAppointment',
  'decideAppointment',
  'setMissionItineraryRef',
  'updateMissionCaseDetails',
  'createContributorRequest',
  'revokeContributorRequest',
  'recordOutcome',
  'recordSubmission',
  'fileComplaint',
  'withdrawOwnComplaint',
  'submitFeedback',
  'generateCoverLetter',
  'explainReadinessGap',
  'trackSubmissionAsAttempt',
  'recordOutcomeAttempt',
  'recordAttemptEvent',
  'recordPackageChoice',
  'markPackageChangeReviewed',
  'confirmPackageHandoff',
  'setChecklistWording',
  'suggestCaseChecklistCorrection',
  'prepareCaseAgain',
  'openOrStartTripCase',
  'acceptCompanionInvitation',
  'openCompanionInvitation',
  'readCompanionTripSummary',
  'joinedCompanionAccess',
  'chooseTripPaper',
  'decideAcknowledgement',
] as const;

const fns = vi.hoisted(() => ({}) as Record<string, ReturnType<typeof vi.fn>>);

vi.mock('@visastack/services', async (original) => {
  const real = await original<typeof import('@visastack/services')>();
  const overrides: Record<string, unknown> = {};
  for (const name of SERVICE_FNS) {
    const fn = vi.fn(async () =>
      refusal.ok.has(name)
        ? name === 'listRequirements'
          ? (refusal.value[name] ?? [])
          : { ok: true, value: refusal.value[name] ?? {} }
        : { ok: false, error: refusal.error },
    );
    fns[name] = fn;
    overrides[name] = fn;
  }
  return {
    ...real,
    ...overrides,
    tripCompanionsEnabled: () => true,
    isAiDispatchAllowed: async () => true,
    requireAccess: async () => ({
      ok: true,
      value: { applicant: { id: '33333333-3333-4333-8333-333333333333', displayName: 'A' } },
    }),
  };
});
vi.mock('../../lib/locale', () => ({ getLocale: async () => locale.value }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  unstable_rethrow: (e: unknown) => {
    throw e;
  },
}));
vi.mock('../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct', self: {} }),
}));
vi.mock('../../lib/hidden-record', async (original) => ({
  ...(await original<typeof import('../../lib/hidden-record')>()),
  ownsCase: async () => true,
  ownsComplaint: async () => true,
}));
vi.mock('../../lib/step-up', () => ({
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'unavailable',
  tryEstablishStepUp: async () => ({ kind: 'ok' }),
}));
vi.mock('../../lib/server-error', () => ({ reportServerError: vi.fn() }));
vi.mock('../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('../../lib/send-now', () => ({ sendEmailNow: async () => 'sent' }));
vi.mock('../../lib/upgrade-offer', () => ({ upgradeLineForRefusal: async () => ({}) }));
vi.mock('../../lib/ai', () => ({
  resolveAiExplainer: async () => ({ ai: {}, limits: {} }),
}));
vi.mock('../../lib/case-checklist-match', () => ({
  selectableChecklists: async () => ({
    lookupFailed: false,
    options: [{ packVersionId: 'pack-1' }],
  }),
  attachChecklistFor: async () => ({ ok: false, error: refusal.error }),
  checklistToLink: async () => null,
}));
vi.mock('./trips/trip-checklist', () => ({ linkTripChecklist: vi.fn() }));
vi.mock('./trip-invitations/accept/network-limit', () => ({ networkLimited: async () => false }));

const ID = '11111111-1111-4111-8111-111111111111';
const APPLICANT = '33333333-3333-4333-8333-333333333333';

function form(extra: Record<string, string | string[]> = {}): FormData {
  const data = new FormData();
  const base: Record<string, string | string[]> = {
    missionId: ID,
    applicantId: APPLICANT,
    from: ID,
    tripId: ID,
    packVersionId: 'pack-1',
    packRequirementId: ID,
    to: 'SUBMITTED',
    confirmCancel: 'yes',
    confirmDelete: 'yes',
    confirmed: 'yes',
    outsideStepsSeen: 'yes',
    factId: ID,
    documentId: ID,
    selectionId: ID,
    taskId: ID,
    status: 'DONE',
    description: 'something',
    title: 'Trip',
    localDate: '2030-01-01',
    localTime: '10:00',
    timezone: 'Asia/Dhaka',
    appointmentId: ID,
    itineraryRef: 'ref',
    jurisdiction: 'GB',
    serviceCategory: 'VISIT',
    contributorEmail: 'a@example.com',
    docType: 'Passport',
    purpose: 'Needed',
    requestId: ID,
    decision: 'APPROVED',
    decisionDate: '2030-01-01',
    channel: 'EMAIL',
    externalReportDescription: 'sent',
    complaintId: ID,
    comments: 'fine',
    missionSubmissionId: ID,
    submittedOn: '2030-01-01',
    kind: 'ADDED',
    occurredOn: '2030-01-01',
    attemptId: ID,
    choice: 'missing',
    reason: 'because',
    wording: 'New words',
    destination: 'France',
    traveller: APPLICANT,
    token: 'tok',
    displayName: 'Rahim',
    intent: 'join',
    snapshotId: ID,
    expectedSnapshotChecksum: 'abc',
    category: 'WRONG_DETAIL',
    officialUrl: 'https://example.gov/page',
    detail: 'The page says otherwise.',
  };
  for (const [k, v] of Object.entries({ ...base, ...extra })) {
    for (const one of Array.isArray(v) ? v : [v]) data.append(k, one);
  }
  return data;
}

const TOURISM = casePurposeGroups()[0]?.options[0]?.key ?? '';
const empty = { ok: false, message: '' } as never;

type Row = {
  name: string;
  run: () => Promise<{ ok: boolean; message: string }>;
  ok?: readonly string[];
  value?: Record<string, unknown>;
};

const mission = await import('./mission/[id]/actions');
const attempt = await import('./mission/[id]/attempt-actions');
const pkg = await import('./mission/[id]/package-actions');
const edits = await import('./mission/[id]/edits-actions');
const suggest = await import('./mission/[id]/suggest-correction-actions');
const snap = await import('./mission/[id]/snapshots/[snapshotId]/actions');
const start = await import('./mission/start/actions');
const again = await import('./applicant/[id]/missions/prepare-again/actions');
const tripJoin = await import('./trip-invitations/accept/actions');
const tripOwn = await import('./trip-invitations/[id]/actions');

const ROWS: Row[] = [
  { name: 'attachPack: case lookup', run: () => mission.attachPackAction(empty, form()) },
  {
    name: 'attachPack: attach',
    run: () => mission.attachPackAction(empty, form()),
    ok: ['getMissionForOwner'],
  },
  { name: 'transition', run: () => mission.transitionMissionAction(empty, form()) },
  { name: 'deleteCancelledCase', run: () => mission.deleteCancelledCaseAction(empty, form()) },
  { name: 'snapshotMission', run: () => mission.snapshotMissionAction(empty, form()) },
  { name: 'selectEvidence', run: () => mission.selectEvidenceAction(empty, form()) },
  { name: 'unselectEvidence', run: () => mission.unselectEvidenceAction(empty, form()) },
  { name: 'createTask', run: () => mission.createTaskAction(empty, form()) },
  { name: 'decideTask', run: () => mission.decideTaskAction(empty, form()) },
  { name: 'createAppointment', run: () => mission.createAppointmentAction(empty, form()) },
  { name: 'decideAppointment', run: () => mission.decideAppointmentAction(empty, form()) },
  { name: 'setItineraryRef', run: () => mission.setItineraryRefAction(empty, form()) },
  { name: 'updateCaseDetails', run: () => mission.updateCaseDetailsAction(empty, form()) },
  {
    name: 'createContributorRequest',
    run: () => mission.createContributorRequestAction(empty, form()),
  },
  {
    name: 'revokeContributorRequest',
    run: () => mission.revokeContributorRequestAction(empty, form()),
  },
  { name: 'recordOutcome', run: () => mission.recordOutcomeAction(empty, form()) },
  { name: 'recordSubmission', run: () => mission.recordSubmissionAction(empty, form()) },
  { name: 'fileComplaint', run: () => mission.fileComplaintAction(empty, form()) },
  { name: 'withdrawComplaint', run: () => mission.withdrawComplaintAction(empty, form()) },
  { name: 'submitFeedback', run: () => mission.submitFeedbackAction(empty, form()) },
  { name: 'generateLetter', run: () => mission.generateLetterAction(empty, form()) },
  {
    name: 'explainReadinessGap: case lookup',
    run: () => mission.explainReadinessGapAction(empty, form()),
  },
  {
    name: 'explainReadinessGap: readiness',
    run: () => mission.explainReadinessGapAction(empty, form()),
    ok: ['getMissionForOwner', 'listRequirements'],
    value: { getMissionForOwner: { packVersionId: 'v1' }, listRequirements: [] },
  },
  {
    name: 'explainReadinessGap: explanation',
    run: () => mission.explainReadinessGapAction(empty, form()),
    ok: ['getMissionForOwner', 'listRequirements', 'computeReadiness'],
    value: {
      getMissionForOwner: { packVersionId: 'v1' },
      listRequirements: [{ id: ID, citation: 'c' }],
      computeReadiness: {
        requirementResults: [
          {
            packRequirementId: ID,
            state: 'CRITICAL_GAP',
            kind: 'DOCUMENT',
            key: 'k',
            optional: false,
          },
        ],
      },
    },
  },
  { name: 'trackReportAsAttempt', run: () => attempt.trackReportAsAttemptAction(empty, form()) },
  { name: 'recordAttempt', run: () => attempt.recordAttemptAction(empty, form()) },
  { name: 'recordAttemptEvent', run: () => attempt.recordAttemptEventAction(empty, form()) },
  { name: 'recordPackageChoice', run: () => pkg.recordPackageChoiceAction(empty, form()) },
  {
    name: 'markPackageChangeReviewed',
    run: () => pkg.markPackageChangeReviewedAction(empty, form()),
  },
  { name: 'confirmPackageHandoff', run: () => pkg.confirmPackageHandoffAction(empty, form()) },
  { name: 'saveWording', run: () => edits.saveWordingAction(empty, form()) },
  { name: 'suggestCorrection', run: () => suggest.suggestCaseCorrectionAction(empty, form()) },
  {
    name: 'decideAcknowledgement',
    run: () => snap.decideAcknowledgementAction(empty as never, form({ decision: 'ACKNOWLEDGED' })),
  },
  {
    name: 'startTrip',
    run: () => start.startTripAction(empty as never, form({ purpose: TOURISM })),
  },
  { name: 'prepareCaseAgain', run: () => again.prepareCaseAgainAction(empty, form()) },
  {
    name: 'acceptTripInvitation',
    run: () => tripJoin.acceptTripInvitationAction(empty, form()),
    ok: ['openCompanionInvitation', 'readCompanionTripSummary'],
    value: { readCompanionTripSummary: { displayName: 'Rahim' } },
  },
  {
    name: 'choosePaper',
    run: () => tripOwn.choosePaperAction(empty, form()),
    ok: ['joinedCompanionAccess'],
  },
];

describe('case flow refusals reach the screens in the visitor language', () => {
  const enText = serviceMessages.en as Record<string, string>;
  const bnText = serviceMessages.bn as Record<string, string>;
  const key = Object.keys(bnText).find(
    (k) => !/\{/.test(enText[k] ?? '') && bnText[k] !== enText[k],
  );

  beforeEach(() => {
    for (const fn of Object.values(fns)) fn.mockClear();
    if (key === undefined) throw new Error('no Bengali draft to test with');
    refusal.error = {
      code: 'invalid',
      message: enText[key] as string,
      messageKey: key,
      params: undefined,
    };
  });

  it.each(ROWS)('$name', async (row) => {
    refusal.ok = new Set(row.ok ?? []);
    refusal.value = row.value ?? {};
    locale.value = 'bn';
    const bn = await row.run();
    expect(bn.ok).toBe(false);
    expect(bn.message).toBe(bnText[key as string]);
    locale.value = 'en';
    const en = await row.run();
    expect(en.message).toBe(enText[key as string]);
  });
});
