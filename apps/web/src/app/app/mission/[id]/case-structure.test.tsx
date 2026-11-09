import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub } from '../../../../lib/next-mocks.test-support';

/**
 * The case page's outline: every heading (h1 to h5), every summary and every fixed id, in document
 * order, for the three states a person meets (a checklist with gaps, a changed case, a new case
 * with no checklist). The page is built from parts (status panel, checklist, rail, secondary
 * sections, phone bar); this test makes sure a change to one part, or to how they are put
 * together, cannot lose or reorder a section without someone choosing it here.
 */

const ok = <T,>(value: T) => ({ ok: true as const, value });

const mocks = vi.hoisted(() => ({
  referenceCodeFor: vi.fn(async (): Promise<string | null> => 'C-7K2Q9M'),
  computeReadiness: vi.fn(),
  computeTripChecks: vi.fn(),
  getApplicant: vi.fn(),
  getEvidenceCandidates: vi.fn(),
  getDocumentLifecycles: vi.fn(async () => new Map()),
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
  listSelectablePackVersions: vi.fn(),
  explainNoFittingPack: vi.fn(),
  listRequirements: vi.fn(),
  listSelectedEvidence: vi.fn(),
  listSubmissionsForMission: vi.fn(),
  listTasks: vi.fn(),
  listChangesSinceConfirmed: vi.fn(),
  listRequirementDetails: vi.fn(),
  latestSourceChecks: vi.fn(),
  caseExpiryConflicts: vi.fn(),
  getCasePackage: vi.fn(),
  listFittingPublicPacks: vi.fn(),
  readTravellerCoverage: vi.fn(),
  requireAccess: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...mocks,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-owner' }),
}));
vi.mock('../../../../lib/ai', () => ({ isExplanationConfigured: async () => false }));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('./attach-pack-form', () => ({ AttachPackForm: stub('AttachPackForm') }));
vi.mock('./case-more-menu', () => ({ CaseMoreMenu: stub('CaseMoreMenu') }));
vi.mock('./case-welcome', () => ({ CaseWelcome: stub('CaseWelcome') }));
vi.mock('./collaboration-panels', () => ({
  AppointmentsPanel: stub('AppointmentsPanel'),
  EvidenceSelectionPanel: stub('EvidenceSelectionPanel'),
  LettersPanel: stub('LettersPanel'),
  TasksPanel: stub('TasksPanel'),
}));
vi.mock('./complaint-feedback-panel', () => ({
  ComplaintPanel: stub('ComplaintPanel'),
  FeedbackPanel: stub('FeedbackPanel'),
}));
vi.mock('./contributor-requests-panel', () => ({
  ContributorRequestsPanel: stub('ContributorRequestsPanel'),
}));
vi.mock('./mission-buttons', () => ({
  CaseDetailsForm: stub('CaseDetailsForm'),
  ItineraryForm: stub('ItineraryForm'),
  SnapshotButton: stub('SnapshotButton'),
  TransitionButtons: stub('TransitionButtons'),
}));
vi.mock('./outcome-panel', () => ({ OutcomePanel: stub('OutcomePanel') }));
vi.mock('./readiness-gap-explain', () => ({ ExplainGapButton: stub('ExplainGapButton') }));
vi.mock('./submission-report-panel', () => ({
  SubmissionReportPanel: stub('SubmissionReportPanel'),
}));
vi.mock('./suggest-correction', () => ({ SuggestCorrection: stub('SuggestCorrection') }));
vi.mock('./open-group-on-link', () => ({ OpenGroupOnLink: stub('OpenGroupOnLink') }));
vi.mock('./changes-since-confirmed', () => ({
  ChangesSinceConfirmedList: stub('ChangesSinceConfirmedList'),
}));

const { default: MissionPage } = await import('./page');

const MISSION = {
  id: 'synthetic-case',
  applicantId: 'synthetic-family',
  title: 'Japan visitor visa',
  destination: 'Japan',
  jurisdiction: 'Japan Visa Application Centre',
  serviceCategory: 'Tourist visa',
  state: 'IN_PROGRESS',
  packVersionId: null as string | null,
  itineraryRef: null,
  manualMode: false,
  travelStartDate: null as Date | null,
  travelEndDate: null as Date | null,
  createdAt: new Date(),
};

const STATES = [
  'CRITICAL_GAP',
  'CRITICAL_GAP',
  'EXPIRING_STALE',
  'UNVERIFIED',
  'SATISFIED',
  'SATISFIED',
];

function setUp(options: { readonly checklist?: boolean; readonly dirty?: boolean }) {
  const results = (options.checklist ? STATES : []).map((state, i) => ({
    packRequirementId: `req-${i}`,
    kind: 'DOCUMENT' as const,
    key: ['bank_statement', 'passport', 'employment_letter', 'hotel_booking', 'visa_form', 'photo'][
      i
    ],
    optional: false,
    state,
    necessity: 'MANDATORY',
    provenance: 'OFFICIAL',
  }));
  mocks.getMissionForOwner.mockResolvedValue(
    ok({
      ...MISSION,
      packVersionId: options.checklist ? 'pv-1' : null,
      travelStartDate: new Date('2027-03-10T00:00:00Z'),
      travelEndDate: new Date('2027-03-24T00:00:00Z'),
    }),
  );
  mocks.computeTripChecks.mockResolvedValue([
    { key: 'passport_validity', level: 'check', title: 'Passport validity', detail: 'Check it.' },
  ]);
  mocks.computeReadiness.mockResolvedValue(
    ok({
      overallState: 'NEEDS_ACTION',
      requirementResults: results,
      requiredCount: results.length,
      satisfiedRequired: 2,
    }),
  );
  mocks.listRequirements.mockResolvedValue(
    results.map((r) => ({
      id: r.packRequirementId,
      citation: 'rule',
      sourceTitle: 'Visitor visa',
      sourceUrl: 'https://example.test/visa',
      publisher: 'Embassy',
      observedDate: null,
      sourceInaccessibleAt: null,
      notes: null,
      maxAgeDays: null,
      kind: 'DOCUMENT',
    })),
  );
  mocks.listRequirementDetails.mockResolvedValue(
    new Map(
      results.map((r, i) => [
        r.packRequirementId,
        { category: i < 3 ? 'FINANCIAL_MEANS' : 'IDENTITY_TRAVEL_DOCUMENTS', effectiveSince: null },
      ]),
    ),
  );
  mocks.latestSourceChecks.mockResolvedValue(new Map());
  mocks.caseExpiryConflicts.mockResolvedValue(
    options.checklist
      ? [
          {
            documentId: 'doc-1',
            displayName: 'Passport',
            expiresAt: new Date('2027-03-01T00:00:00Z'),
            neededUntil: new Date('2027-09-24T00:00:00Z'),
          },
        ]
      : [],
  );
  mocks.getCasePackage.mockResolvedValue(ok(null));
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
    'listGeneratedOutputs',
    'listSelectedEvidence',
    'getEvidenceCandidates',
    'listAccessForApplicant',
    'listContributorRequests',
    'listAppointments',
    'listOutcomesForMission',
    'listSubmissionsForMission',
  ] as const) {
    mocks[name].mockResolvedValue(ok([]));
  }
  mocks.listMissionSnapshots.mockResolvedValue(
    ok({
      items: [{ id: 'snap-1', version: 1, content: {}, checksum: 'a1b2c3d4e5f60718' }],
      nextCursor: null,
    }),
  );
  mocks.listComplaintsForMission.mockResolvedValue(ok({ items: [], total: 0 }));
  mocks.listFeedbackForMission.mockResolvedValue(ok({ items: [], total: 0 }));
  mocks.listSelectablePackVersions.mockResolvedValue(ok([]));
  mocks.explainNoFittingPack.mockResolvedValue([]);
  mocks.listFittingPublicPacks.mockResolvedValue([]);
  mocks.readTravellerCoverage.mockResolvedValue({ nationality: ['Bangladeshi'], residence: [] });
  mocks.listMissionsByItineraryRef.mockResolvedValue([]);
  mocks.listNotesForOwner.mockResolvedValue({ items: [], total: 0 });
  mocks.listTasks.mockResolvedValue(
    ok({
      items: [
        {
          id: 'task-0',
          description: 'Task 0',
          status: 'OPEN',
          priority: 'NORMAL',
          dueDate: null,
          dueTimezone: null,
        },
      ],
      total: 1,
      open: 1,
    }),
  );
  mocks.requireAccess.mockResolvedValue(ok({ synthetic: 'proof' }));
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

/** Named regions of the page that have no heading of their own. */
const LANDMARK_CLASSES = new Set([
  'case-stage-region',
  'case-alert',
  'case-next-step',
  'case-journey-reminder',
  'case-context-strip',
  'case-attention',
  'case-attention-ok',
  'jump-nav',
  'case-evidence-overview',
  'case-expiring',
  'case-sources',
  'case-category',
  'collapsible-group',
  'case-checklist-rest',
  'split-main',
  'split-rail',
  'case-sticky-next',
]);

/**
 * Headings, summaries, landmark regions and fixed ids in document order, as `h2: Text`,
 * `summary: Text`, `.region` and `#id`.
 */
function outline(html: string): string[] {
  const found: string[] = [];
  const pattern = /<(h[1-5]|summary)\b[^>]*>([\s\S]*?)<\/\1>|\sid="([^"]+)"|\sclass="([^"]+)"/g;
  for (const match of html.matchAll(pattern)) {
    if (match[4] !== undefined) {
      for (const name of match[4].split(/\s+/)) {
        if (LANDMARK_CLASSES.has(name)) found.push(`.${name}`);
      }
      continue;
    }
    if (match[3] !== undefined) {
      // React's generated ids (for form labels) are not part of the page's structure.
      if (!match[3].startsWith('_R_')) found.push(`#${match[3]}`);
      continue;
    }
    const text = (match[2] ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    found.push(`${match[1]}: ${text}`);
  }
  return found;
}

const render = async (query: { readonly welcome?: string } = {}) =>
  renderServer(
    await MissionPage({
      params: Promise.resolve({ id: 'synthetic-case' }),
      searchParams: Promise.resolve(query),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
});

const EXPECTED_CHECKLIST: string[] = [
  'h1: Japan visitor visa',
  'summary: i',
  'h2: Next Step',
  'summary: Why This Step',
  'h2: Evidence Progress',
  'summary: How This Is Counted',
  '.case-context-strip',
  '.case-attention',
  'summary: About Stages',
  '.case-journey-reminder',
  'summary: About This Case',
  '.jump-nav',
  '#readiness',
  'h3: Evidence Checklist',
  '.collapsible-group',
  '#case-checklist-needs-you',
  'summary: Needs You 3',
  '.case-category',
  'h5: Money and Proof of Funds',
  '.collapsible-group',
  '#case-checklist-needs-a-check',
  'summary: Needs a Check 1',
  '.case-category',
  'h5: Identity and Travel Documents',
  '.collapsible-group',
  '#case-checklist-on-file',
  'summary: On File 2',
  '.case-category',
  'h5: Identity and Travel Documents',
  '.case-expiring',
  '#expiring-documents',
  'h3: Documents That Expire Before Your Trip Ends',
  '#lp-pane-req-0',
  'h3: Bank Statement',
  '#lp-pane-req-1',
  'h3: Passport',
  '#lp-pane-req-2',
  'h3: Employment Certificate',
  '#lp-pane-req-3',
  'h3: Hotel or Stay Booking',
  '#lp-pane-req-4',
  'h3: Visa Form',
  '#lp-pane-req-5',
  'h3: Photograph',
  '.split-rail',
  'summary: Case Details Mar 10, 2027 to Mar 24, 2027',
  'h2: Case Details',
  'summary: Edit Case Details',
  'summary: Trip Date Checks 1 check on your trip dates Take a Look',
  '#trip-checks',
  'h2: Trip Date Checks',
  'summary: About These Checks',
  'summary: Requirement Pack Japan visitor',
  '#pack',
  'h2: Requirement Pack',
  '.case-sources',
  'h3: Sources for This Checklist',
  'summary: Advance the Case Next: Ready for Review',
  'h2: Advance the Case',
  'summary: Snapshots 1 saved',
  '#snapshots',
  'h2: Snapshots',
  'summary: Itinerary Reference Not linked',
  'h2: Itinerary Reference',
  'summary: Link to a Family Trip',
  'h2: More for This Case',
  'summary: Select or Update Evidence No Items Yet',
  '#evidence',
  'summary: Tasks, Appointments and Letters 1 Open Task',
  '#work',
  '#notes',
  'summary: Contributors and Notes from Your Agency No Notes Yet',
  'h2: Ask a Contributor',
  'h2: Notes from Your Agency',
  'summary: Submission and Outcome No Outcome Yet',
  '#outcome',
  'summary: Problems and Feedback None Raised',
  '.case-sticky-next',
];
const EXPECTED_CHANGED: string[] = [
  'h1: Japan visitor visa',
  'summary: i',
  '.case-alert',
  'summary: What Changed',
  'h2: Evidence Progress',
  'summary: How This Is Counted',
  '.case-context-strip',
  '.case-attention',
  'summary: About Stages',
  '.case-journey-reminder',
  'summary: About This Case',
  '.jump-nav',
  '#readiness',
  'h3: Evidence Checklist',
  '.collapsible-group',
  '#case-checklist-needs-you',
  'summary: Needs You 3',
  '.case-category',
  'h5: Money and Proof of Funds',
  '.collapsible-group',
  '#case-checklist-needs-a-check',
  'summary: Needs a Check 1',
  '.case-category',
  'h5: Identity and Travel Documents',
  '.collapsible-group',
  '#case-checklist-on-file',
  'summary: On File 2',
  '.case-category',
  'h5: Identity and Travel Documents',
  '.case-expiring',
  '#expiring-documents',
  'h3: Documents That Expire Before Your Trip Ends',
  '#lp-pane-req-0',
  'h3: Bank Statement',
  '#lp-pane-req-1',
  'h3: Passport',
  '#lp-pane-req-2',
  'h3: Employment Certificate',
  '#lp-pane-req-3',
  'h3: Hotel or Stay Booking',
  '#lp-pane-req-4',
  'h3: Visa Form',
  '#lp-pane-req-5',
  'h3: Photograph',
  '.split-rail',
  'summary: Case Details Mar 10, 2027 to Mar 24, 2027',
  'h2: Case Details',
  'summary: Edit Case Details',
  'summary: Trip Date Checks 1 check on your trip dates Take a Look',
  '#trip-checks',
  'h2: Trip Date Checks',
  'summary: About These Checks',
  'summary: Requirement Pack Japan visitor',
  '#pack',
  'h2: Requirement Pack',
  '.case-sources',
  'h3: Sources for This Checklist',
  'summary: Advance the Case Next: Ready for Review',
  'h2: Advance the Case',
  'summary: Snapshots 1 saved',
  '#snapshots',
  'h2: Snapshots',
  'summary: Itinerary Reference Not linked',
  'h2: Itinerary Reference',
  'summary: Link to a Family Trip',
  'h2: More for This Case',
  'summary: Select or Update Evidence No Items Yet',
  '#evidence',
  'summary: Tasks, Appointments and Letters 1 Open Task',
  '#work',
  '#notes',
  'summary: Contributors and Notes from Your Agency No Notes Yet',
  'h2: Ask a Contributor',
  'h2: Notes from Your Agency',
  'summary: Submission and Outcome No Outcome Yet',
  '#outcome',
  'summary: Problems and Feedback None Raised',
];
const EXPECTED_NO_CHECKLIST: string[] = [
  'h1: Japan visitor visa',
  'summary: i',
  'h2: Next Step',
  'summary: Why This Step',
  '#readiness',
  'summary: What Is a Checklist?',
  '.case-context-strip',
  '.case-attention',
  'summary: About Stages',
  '.case-journey-reminder',
  'summary: About This Case',
  '.jump-nav',
  '.split-rail',
  'summary: Case Details Mar 10, 2027 to Mar 24, 2027',
  'h2: Case Details',
  'summary: Edit Case Details',
  'summary: Trip Date Checks 1 check on your trip dates Take a Look',
  '#trip-checks',
  'h2: Trip Date Checks',
  'summary: About These Checks',
  'summary: Requirement Pack No checklist yet',
  '#pack',
  'h2: Requirement Pack',
  'summary: Advance the Case Next: Ready for Review',
  'h2: Advance the Case',
  'summary: Snapshots 1 saved',
  '#snapshots',
  'h2: Snapshots',
  'summary: Itinerary Reference Not linked',
  'h2: Itinerary Reference',
  'summary: Link to a Family Trip',
  'h2: More for This Case',
  'summary: Select or Update Evidence No Items Yet',
  '#evidence',
  'summary: Tasks, Appointments and Letters 1 Open Task',
  '#work',
  '#notes',
  'summary: Contributors and Notes from Your Agency No Notes Yet',
  'h2: Ask a Contributor',
  'h2: Notes from Your Agency',
  'summary: Submission and Outcome No Outcome Yet',
  '#outcome',
  'summary: Problems and Feedback None Raised',
  '.case-sticky-next',
];

describe('case page outline', () => {
  it('a case with a checklist and gaps', async () => {
    setUp({ checklist: true });
    expect(outline(await render())).toEqual(EXPECTED_CHECKLIST);
  });
  it('a case that changed after it was confirmed', async () => {
    setUp({ checklist: true, dirty: true });
    expect(outline(await render())).toEqual(EXPECTED_CHANGED);
  });
  it('a new case with no checklist', async () => {
    setUp({});
    expect(outline(await render({ welcome: '1' }))).toEqual(EXPECTED_NO_CHECKLIST);
  });
});
