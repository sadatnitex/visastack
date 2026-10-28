import { vi } from 'vitest';
import { renderServer, stub } from '../next-mocks.test-support';
import { registerParity } from './parity-kit.test-support';

/** A case (screen 09): see parity-kit.test-support.ts for how the comparison works. */

const ok = <T,>(value: T) => ({ ok: true as const, value });

const mocks = vi.hoisted(() => ({
  referenceCodeFor: vi.fn(async (): Promise<string | null> => null),
  computeReadiness: vi.fn(),
  getApplicant: vi.fn(),
  getEvidenceCandidates: vi.fn(),
  getLatestExplanationForRequirement: vi.fn(),
  getLiveAcknowledgement: vi.fn(),
  getMissionForOwner: vi.fn(),
  getPack: vi.fn(),
  getPackVersion: vi.fn(),
  listAccessForApplicant: vi.fn(),
  listAcknowledgementsForMission: vi.fn(),
  listAppointments: vi.fn(),
  listComplaintEvents: vi.fn(),
  listComplaintsForMission: vi.fn(),
  listContributorRequests: vi.fn(),
  listFeedbackForMission: vi.fn(),
  listGeneratedOutputs: vi.fn(),
  listMissionSnapshots: vi.fn(),
  listMissionsByItineraryRef: vi.fn(),
  listNotesForOwner: vi.fn(),
  listOutcomesForMission: vi.fn(),
  listPublishedPackVersions: vi.fn(),
  listRequirements: vi.fn(),
  listSelectedEvidence: vi.fn(),
  listSubmissionsForMission: vi.fn(),
  listTasks: vi.fn(),
  listChangesSinceConfirmed: vi.fn(),
  listFittingPublicPacks: vi.fn(),
  readTravellerCoverage: vi.fn(),
  requireAccess: vi.fn(),
}));
const depth = vi.hoisted(() => ({ level: 'auto' }));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...mocks,
}));
vi.mock('../session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-owner' }),
}));
vi.mock('../ai', () => ({ isExplanationConfigured: async () => false }));
vi.mock('../locale', () => ({ getLocale: async () => 'en' }));
vi.mock('./depth.server', () => ({ readDepth: async () => depth.level }));
vi.mock('../../app/app/mission/[id]/attach-pack-form', () => ({
  AttachPackForm: stub('AttachPackForm'),
}));
vi.mock('../../app/app/mission/[id]/case-more-menu', () => ({
  CaseMoreMenu: stub('CaseMoreMenu'),
}));
vi.mock('../../app/app/mission/[id]/case-welcome', () => ({ CaseWelcome: stub('CaseWelcome') }));
vi.mock('../../app/app/mission/[id]/collaboration-panels', () => ({
  AppointmentsPanel: stub('AppointmentsPanel'),
  EvidenceSelectionPanel: stub('EvidenceSelectionPanel'),
  LettersPanel: stub('LettersPanel'),
  TasksPanel: stub('TasksPanel'),
}));
vi.mock('../../app/app/mission/[id]/complaint-feedback-panel', () => ({
  ComplaintPanel: stub('ComplaintPanel'),
  FeedbackPanel: stub('FeedbackPanel'),
}));
vi.mock('../../app/app/mission/[id]/contributor-requests-panel', () => ({
  ContributorRequestsPanel: stub('ContributorRequestsPanel'),
}));
vi.mock('../../app/app/mission/[id]/mission-buttons', () => ({
  CaseDetailsForm: stub('CaseDetailsForm'),
  ItineraryForm: stub('ItineraryForm'),
  SnapshotButton: stub('SnapshotButton'),
  TransitionButtons: stub('TransitionButtons'),
}));
vi.mock('../../app/app/mission/[id]/outcome-panel', () => ({ OutcomePanel: stub('OutcomePanel') }));
vi.mock('../../app/app/mission/[id]/readiness-gap-explain', () => ({
  ExplainGapButton: stub('ExplainGapButton'),
}));
vi.mock('../../app/app/mission/[id]/submission-report-panel', () => ({
  SubmissionReportPanel: stub('SubmissionReportPanel'),
}));

const { default: MissionPage } = await import('../../app/app/mission/[id]/page');

const MISSION = {
  id: 'synthetic-case',
  applicantId: 'synthetic-family',
  title: 'Japan visitor visa',
  destination: 'Japan',
  state: 'IN_PROGRESS',
  packVersionId: null,
  itineraryRef: null,
  manualMode: false,
};

function setUp(
  options: {
    readonly dirty?: boolean;
    readonly openTasks?: number;
    readonly requirements?: readonly string[];
    readonly gateRefuses?: boolean;
    readonly state?: string;
  } = {},
) {
  const results = (options.requirements ?? []).map((state, i) => ({
    packRequirementId: `req-${i}`,
    kind: 'DOCUMENT' as const,
    key: 'bank_statement',
    optional: false,
    state,
  }));
  const base = { ...MISSION, state: options.state ?? MISSION.state };
  mocks.getMissionForOwner.mockResolvedValue(
    ok(options.requirements ? { ...base, packVersionId: 'pv-1' } : base),
  );
  mocks.computeReadiness.mockResolvedValue(
    ok({
      overallState: 'NEEDS_ACTION',
      requirementResults: results,
      requiredCount: results.length,
      satisfiedRequired: results.filter((r) => r.state === 'SATISFIED').length,
    }),
  );
  mocks.listRequirements.mockResolvedValue(
    results.map((r) => ({ id: r.packRequirementId, citation: 'rule', sourceInaccessibleAt: null })),
  );
  mocks.getPackVersion.mockResolvedValue({ packId: 'p1', effectiveDate: null });
  mocks.getPack.mockResolvedValue({
    name: 'Japan visitor',
    authoritative: false,
    route: 'visitor',
    jurisdiction: 'JP',
  });
  mocks.getLatestExplanationForRequirement.mockResolvedValue(undefined);
  mocks.getApplicant.mockResolvedValue({ id: 'synthetic-family', displayName: 'Rahman family' });
  for (const name of [
    'listMissionSnapshots',
    'listGeneratedOutputs',
    'listSelectedEvidence',
    'getEvidenceCandidates',
    'listAccessForApplicant',
    'listContributorRequests',
    'listAppointments',
    'listOutcomesForMission',
    'listSubmissionsForMission',
    'listComplaintsForMission',
    'listFeedbackForMission',
  ] as const) {
    mocks[name].mockResolvedValue(ok([]));
  }
  mocks.listPublishedPackVersions.mockResolvedValue([]);
  mocks.listFittingPublicPacks.mockResolvedValue([]);
  mocks.readTravellerCoverage.mockResolvedValue({ nationality: ['Bangladeshi'], residence: [] });
  mocks.listMissionsByItineraryRef.mockResolvedValue([]);
  mocks.listNotesForOwner.mockResolvedValue([]);
  mocks.listTasks.mockResolvedValue(
    ok(
      Array.from({ length: options.openTasks ?? 0 }, (_, i) => ({
        id: `task-${i}`,
        description: `Task ${i}`,
        status: 'OPEN',
        priority: 'NORMAL',
        dueDate: null,
        dueTimezone: null,
      })),
    ),
  );
  mocks.requireAccess.mockResolvedValue(
    options.gateRefuses
      ? { ok: false as const, error: { code: 'forbidden', message: 'no' } }
      : ok({ synthetic: 'proof' }),
  );
  mocks.listChangesSinceConfirmed.mockResolvedValue(ok(null));
  mocks.getLiveAcknowledgement.mockResolvedValue(undefined);
  mocks.listAcknowledgementsForMission.mockResolvedValue(
    ok(
      options.dirty
        ? [{ decision: 'ACKNOWLEDGED', invalidatedAt: new Date('2026-10-20T00:00:00Z') }]
        : [],
    ),
  );
}

let current: Parameters<typeof setUp>[0] = {};

registerParity({
  name: 'case',
  reset: () => {
    vi.clearAllMocks();
    depth.level = 'auto';
    current = {};
  },
  render: async () => {
    setUp(current);
    return await renderServer(
      await MissionPage({
        params: Promise.resolve({ id: 'synthetic-case' }),
        searchParams: Promise.resolve({}),
      }),
    );
  },
  states: [
    { name: 'a new case with no checklist', setup: () => undefined },
    {
      name: 'a busy case with a checklist and open tasks',
      setup: () => {
        current = {
          requirements: ['CRITICAL_GAP', 'EXPIRING_STALE', 'UNVERIFIED', 'SATISFIED'],
          openTasks: 2,
        };
      },
    },
    {
      name: 'a case that changed since it was confirmed',
      setup: () => {
        current = { dirty: true, gateRefuses: true, requirements: ['SATISFIED'] };
      },
    },
    {
      name: 'a closed case',
      setup: () => {
        current = { state: 'CLOSED', requirements: ['SATISFIED'] };
      },
    },
  ],
});
