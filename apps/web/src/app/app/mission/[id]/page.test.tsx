import { beforeEach, describe, expect, it, vi } from 'vitest';
import { levelContaining } from '../../../../lib/ccd/reveal';
import { renderServer, stub, stubProps, textOf } from '../../../../lib/next-mocks.test-support';

const ok = <T,>(value: T) => ({ ok: true as const, value });

const mocks = vi.hoisted(() => ({
  referenceCodeFor: vi.fn(async (): Promise<string | null> => null),
  computeReadiness: vi.fn(),
  computeTripChecks: vi.fn(),
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

const { default: MissionPage } = await import('./page');

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
    /** Required requirement states; attaches a pack when given. */
    readonly requirements?: readonly string[];
    /** What listChangesSinceConfirmed returns (WP-V3 part 3). */
    readonly changes?: unknown;
    readonly gateRefuses?: boolean;
  } = {},
) {
  const results = (options.requirements ?? []).map((state, i) => ({
    packRequirementId: `req-${i}`,
    kind: 'DOCUMENT' as const,
    key: 'bank_statement',
    optional: false,
    state,
  }));
  mocks.getMissionForOwner.mockResolvedValue(
    ok(options.requirements ? { ...MISSION, packVersionId: 'pv-1' } : MISSION),
  );
  mocks.computeTripChecks.mockResolvedValue([]);
  mocks.computeReadiness.mockResolvedValue(
    ok({
      overallState: 'NEEDS_ACTION',
      requirementResults: results,
      requiredCount: results.length,
      satisfiedRequired: 0,
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
  mocks.listChangesSinceConfirmed.mockResolvedValue(ok(options.changes ?? null));
  mocks.getLiveAcknowledgement.mockResolvedValue(undefined);
  mocks.listAcknowledgementsForMission.mockResolvedValue(
    ok(
      options.dirty
        ? [{ decision: 'ACKNOWLEDGED', invalidatedAt: new Date('2026-10-20T00:00:00Z') }]
        : [],
    ),
  );
}

const render = async (query: { readonly welcome?: string } = {}) =>
  renderServer(
    await MissionPage({
      params: Promise.resolve({ id: 'synthetic-case' }),
      searchParams: Promise.resolve(query),
    }),
  );

/** Index of each marker in the page, in document order. */
function order(html: string, markers: readonly string[]): number[] {
  return markers.map((marker) => html.indexOf(marker));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the case reference code (ADR 0018)', () => {
  it('shows the case code in the header, and nothing before migration 0091 has run', async () => {
    setUp();
    mocks.referenceCodeFor.mockResolvedValueOnce('C-7K2Q9M');
    const html = await render();
    expect(mocks.referenceCodeFor).toHaveBeenCalledWith(expect.anything(), 'C', expect.any(String));
    expect(textOf(html)).toContain('Case Reference');
    expect(html).toContain('C-7K2Q9M');
    setUp();
    const without = textOf(await render());
    expect(without).not.toContain('Case Reference');
  });
});

describe('case page as it is today (WP-X1 characterization)', () => {
  it('shows the stage tracker, the attention list and every section in order', async () => {
    setUp();
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Japan visitor visa');
    expect(text).toContain('Traveller has not confirmed yet');
    expect(text).toContain('Nothing needs attention right now');
    expect(html).toContain('aria-label="Actual case workflow state"');
    expect(html).toContain('aria-current="step"');
    const sections = order(html, [
      'aria-label="Actual case workflow state"',
      'class="case-attention"',
      'aria-label="Sections of this case"',
      'id="readiness"',
      'id="evidence"',
      'id="work"',
      'id="notes"',
      'id="outcome"',
      // The side column (snapshots) follows the main column in the markup.
      'id="snapshots"',
    ]);
    expect(sections.every((index) => index >= 0)).toBe(true);
    expect([...sections].sort((a, b) => a - b)).toEqual(sections);
  });

  it('keeps every control: add evidence, snapshot, transitions, case details and the panels', async () => {
    setUp();
    const html = await render();
    expect(html).toContain('href="#evidence"');
    for (const control of [
      'SnapshotButton',
      'TransitionButtons',
      'CaseDetailsForm',
      'ItineraryForm',
      'TasksPanel',
      'LettersPanel',
      'AppointmentsPanel',
      'ContributorRequestsPanel',
      'OutcomePanel',
      'SubmissionReportPanel',
      'AttachPackForm',
    ]) {
      expect(html, control).toContain(`data-stub="${control}"`);
    }
  });

  it('lists open tasks as needing attention, linked to the work section', async () => {
    setUp({ openTasks: 2 });
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('open tasks');
    expect(html).toContain('href="#work"');
    expect(text).not.toContain('Nothing needs attention right now');
  });

  it('lists dates to check as needing attention, linked to the trip date checks', async () => {
    setUp({});
    mocks.getMissionForOwner.mockResolvedValue(
      ok({
        ...MISSION,
        travelStartDate: new Date('2027-03-10T00:00:00Z'),
        travelEndDate: new Date('2027-03-24T00:00:00Z'),
      }),
    );
    mocks.computeTripChecks.mockResolvedValue([
      {
        key: 'passport_validity',
        level: 'problem',
        title: 'Your passport expires before your trip ends',
        detail: 'It expires on 1 March 2027. Renew it before you apply.',
      },
      {
        key: 'target_date',
        level: 'check',
        title: 'Your target date is after your trip starts',
        detail: 'Allow time before you travel.',
      },
    ]);
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('dates to check');
    expect(html).toContain('href="#trip-checks"');
    expect(text).toContain('Trip Date Checks');
    expect(text).toContain('Your passport expires before your trip ends');
    expect(text).not.toContain('Nothing needs attention right now');
  });

  it('asks for travel dates in one line when the case has none, and shows no date card', async () => {
    setUp({});
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Add your travel dates under Edit Case Details');
    expect(text).not.toContain('Trip Date Checks');
    expect(html).not.toContain('href="#trip-checks"');
  });

  it('says so when the date checks could not be worked out, instead of asking for dates', async () => {
    setUp({});
    mocks.getMissionForOwner.mockResolvedValue(
      ok({ ...MISSION, travelStartDate: new Date('2027-03-10T00:00:00Z') }),
    );
    mocks.computeTripChecks.mockRejectedValue(new Error('database'));
    const text = textOf(await render());
    expect(text).toContain('We could not check your dates just now');
    expect(text).not.toContain('Add your travel dates under Edit Case Details');
  });

  it('shows no date card on a case that was handed in', async () => {
    setUp({});
    mocks.getMissionForOwner.mockResolvedValue(
      ok({ ...MISSION, state: 'SUBMITTED', travelStartDate: new Date('2027-03-10T00:00:00Z') }),
    );
    const text = textOf(await render());
    expect(text).not.toContain('Trip Date Checks');
    expect(text).not.toContain('Add your travel dates under Edit Case Details');
  });

  it('warns when the case changed since it was last acknowledged, keeping the wording', async () => {
    setUp({ dirty: true });
    const text = textOf(await render());
    expect(text).toContain('This case has changed since it was last acknowledged.');
    expect(text).toContain(
      'A material edit invalidated the previous sign-off. Capture a new snapshot and acknowledge it again before relying on this case as submission-ready.',
    );
    expect(text).toContain('Changed Since Confirmed');
  });
});

describe('case journey view (WP-X1)', () => {
  it('shows the first attention item as the next step, under the tracker and above the attention list', async () => {
    setUp({ openTasks: 2 });
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Next Step');
    expect(text).toContain('Finish 2 open tasks');
    const [tracker, card, list] = order(html, [
      'aria-label="Actual case workflow state"',
      'aria-labelledby="case-next-step-heading"',
      'class="case-attention"',
    ]);
    expect(tracker).toBeLessThan(card ?? -1);
    expect(card).toBeLessThan(list ?? -1);
    // One primary action, pointing where the attention item points.
    const cardHtml = html.slice(card, list);
    expect(cardHtml.match(/btn-primary/g)).toHaveLength(1);
    expect(cardHtml).toContain('href="#work"');
  });

  it('shows no card when nothing needs attention, keeping the success badge', async () => {
    setUp();
    const html = await render();
    expect(html).not.toContain('aria-labelledby="case-next-step-heading"');
    expect(textOf(html)).toContain('Nothing needs attention right now');
  });

  it('a changed case shows the alert with its snapshot button directly under the tracker, and no card', async () => {
    setUp({ dirty: true, openTasks: 1 });
    const html = await render();
    expect(html).not.toContain('aria-labelledby="case-next-step-heading"');
    const tracker = html.indexOf('aria-label="Actual case workflow state"');
    const alert = html.indexOf('class="case-alert"');
    const strip = html.indexOf('class="case-context-strip"');
    expect(tracker).toBeLessThan(alert);
    expect(alert).toBeLessThan(strip);
    expect(html.slice(alert, strip)).toContain('data-stub="SnapshotButton"');
    // The alert's button is the primary, clearly named one; the header keeps its defaults.
    expect(stubProps(html, 'SnapshotButton')).toEqual([
      { missionId: 'synthetic-case' },
      { missionId: 'synthetic-case', label: 'Take a New Snapshot', primary: true, align: 'start' },
    ]);
    expect(html.slice(alert, strip)).not.toContain('role=');
  });

  it('the first item wins: required items to fix come before open tasks, with plain counts', async () => {
    setUp({ requirements: ['CRITICAL_GAP', 'EXPIRING_STALE'], openTasks: 1 });
    const html = await render();
    const card = html.indexOf('aria-labelledby="case-next-step-heading"');
    const list = html.indexOf('class="case-attention"');
    expect(card).toBeGreaterThan(-1);
    const cardText = textOf(html.slice(card, list));
    // It speaks of this case by name and names the first item to fix (CCD section 6).
    expect(cardText).toContain('Fix 2 required items for Japan visitor visa');
    expect(cardText).toContain(
      'First to fix: Bank Statement. Some required items are missing, out of date or do not match.',
    );
    expect(cardText).not.toContain('open task');
    expect(html.slice(card, list)).toContain('href="#readiness"');
    // The attention list itself still lists both.
    expect(textOf(html.slice(list))).toContain('open task');
  });

  it('uses the singular for one item, and names items to confirm', async () => {
    setUp({ requirements: ['UNVERIFIED'] });
    expect(textOf(await render())).toMatch(/Confirm 1 item(?!s)/);
    setUp({ requirements: ['CRITICAL_GAP'] });
    expect(textOf(await render())).toMatch(/Fix 1 required item(?!s)/);
    setUp({ openTasks: 1 });
    expect(textOf(await render())).toMatch(/Finish 1 open task(?!s)/);
  });

  it('reminds that a prepared file is not a submission, after the next step, on every case', async () => {
    const reminder =
      'Preparing a file is not the same as submitting it. VisaStack does not submit applications or predict decisions.';
    for (const options of [{}, { openTasks: 1 }, { dirty: true }]) {
      setUp(options);
      const html = await render();
      expect(textOf(html)).toContain(reminder);
      const at = html.indexOf('class="case-journey-reminder"');
      expect(at).toBeGreaterThan(html.indexOf('aria-label="Actual case workflow state"'));
      expect(at).toBeLessThan(html.indexOf('class="case-context-strip"'));
    }
  });
});

const SNAPSHOT = '11111111-1111-4111-8111-111111111111';
const PRIOR = '22222222-2222-4222-8222-222222222222';
const CURRENT = '33333333-3333-4333-8333-333333333333';

function changes(list: readonly unknown[], exact = true) {
  return {
    snapshot: {
      id: SNAPSHOT,
      missionId: 'synthetic-case',
      missionTitle: 'Japan visitor visa',
      version: 2,
      takenAt: '2026-10-18T09:00:00.000Z',
      exact,
    },
    review: {
      confirmedAt: '2026-10-18T10:00:00.000Z',
      setAsideAt: '2026-10-20T10:00:00.000Z',
      laterConfirmation: null,
    },
    changes: list,
    unchangedDetailCount: 3,
    confirmedAt: '2026-10-18T10:00:00.000Z',
  };
}

const EMPLOYER_CHANGED = {
  kind: 'detail',
  change: 'changed',
  fieldKey: 'employer_name',
  repeatingRecordKey: null,
  factId: 'fact-1',
  priorFactVersionId: PRIOR,
  currentFactVersionId: CURRENT,
};

/** The markup of the changed-case alert only. */
function alertOf(html: string): string {
  return html.slice(html.indexOf('class="case-alert"'), html.indexOf('class="case-context-strip"'));
}

describe('changed details inside the alert (WP-V3 part 3)', () => {
  it('lists what changed by name inside the alert, with a compare link to the exact version', async () => {
    setUp({
      dirty: true,
      changes: changes([
        EMPLOYER_CHANGED,
        { kind: 'document', change: 'new_version', documentId: 'doc-1', docType: 'bank_statement' },
        { kind: 'case', change: 'changed', caseField: 'travelStartDate' },
      ]),
    });
    const html = await render();
    const alert = alertOf(html);
    const text = textOf(alert);
    // The approved wording stays, the list follows it, the snapshot button stays last.
    expect(text).toContain('This case has changed since it was last acknowledged.');
    expect(text).toContain('What changed since you confirmed snapshot 2 on 18 Oct 2026');
    expect(text).toMatch(/Travel Start Date\s*: changed/);
    expect(text).toMatch(/Employer[^:]*\s*: changed/);
    expect(text).toMatch(/new version added/);
    expect(alert).toContain(
      `href="/app/applicant/synthetic-family/memory/compare?snapshot=${SNAPSHOT}&amp;version=${PRIOR}"`,
    );
    expect(alert).toContain(
      `href="/app/applicant/synthetic-family/memory/compare?snapshot=${SNAPSHOT}"`,
    );
    expect(alert.indexOf('class="case-changes"')).toBeLessThan(
      alert.indexOf('data-stub="SnapshotButton"'),
    );
    expect(alert).not.toContain('role=');
    // Through the central gate, for this case, without a value anywhere.
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ kind: 'account', accountId: 'synthetic-owner' }),
      'VIEW_METADATA',
      { missionId: 'synthetic-case' },
      { purpose: 'application_memory' },
    );
    expect(mocks.listChangesSinceConfirmed).toHaveBeenCalledWith({ synthetic: 'proof' });
  });

  it('only a changed detail with both versions gets a compare link', async () => {
    setUp({
      dirty: true,
      changes: changes([
        { ...EMPLOYER_CHANGED, change: 'added', priorFactVersionId: null },
        { ...EMPLOYER_CHANGED, factId: 'fact-2', change: 'removed', currentFactVersionId: null },
      ]),
    });
    const alert = alertOf(await render());
    expect(alert).not.toContain('version=');
    expect(textOf(alert)).toContain('added to this case');
    expect(textOf(alert)).toContain('removed');
  });

  it('shows the first eight and links to the full list', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...EMPLOYER_CHANGED,
      factId: `fact-${i}`,
    }));
    setUp({ dirty: true, changes: changes(many) });
    const alert = alertOf(await render());
    expect(alert.match(/class="case-change-link"/g)).toHaveLength(8);
    expect(textOf(alert)).toContain('See All 10 Changes');
  });

  it('says plainly when an older snapshot cannot be compared, or when no change could be named', async () => {
    setUp({ dirty: true, changes: changes([], false) });
    expect(textOf(alertOf(await render()))).toContain('did not record exact versions');
    setUp({ dirty: true, changes: changes([]) });
    expect(textOf(alertOf(await render()))).toContain('different choice of evidence');
  });

  it('keeps the alert when the list cannot be read, pointing to Case History', async () => {
    setUp({ dirty: true, gateRefuses: true });
    const alert = alertOf(await render());
    expect(textOf(alert)).toContain('This case has changed since it was last acknowledged.');
    expect(alert).toContain('href="/app/applicant/synthetic-family/memory"');
    expect(mocks.listChangesSinceConfirmed).not.toHaveBeenCalled();
  });

  it('reads nothing extra for a case that has not changed, and links Case History from the snapshots', async () => {
    setUp();
    const html = await render();
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(html).not.toContain('class="case-changes"');
    const snapshots = html.slice(html.indexOf('id="snapshots"'));
    expect(snapshots).toContain('href="/app/applicant/synthetic-family/memory"');
  });
});

describe('self-reviewed note uses the shared case-scope rule (ADR 0017)', () => {
  function orgGrant(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      applicantId: 'synthetic-family',
      recipientAccountId: null,
      recipientOrganizationId: 'org-a',
      missionId: null,
      actions: ['VIEW_METADATA'],
      categories: null,
      documentIds: null,
      documentScopeSnapshot: null,
      purpose: 'review',
      status: 'ACTIVE',
      acceptedAt: new Date('2026-10-01T00:00:00Z'),
      startAt: new Date('2026-10-01T00:00:00Z'),
      expiryAt: null,
      caseExceptions: [],
      ...overrides,
    };
  }
  const SELF = 'No agency currently has access to this case';
  const withAccess = async (grants: unknown[]) => {
    setUp();
    mocks.listAccessForApplicant.mockResolvedValue(ok(grants));
    return textOf(await render());
  };

  it('counts an agency whose all-cases access reaches this case', async () => {
    expect(await withAccess([orgGrant('g-all')])).not.toContain(SELF);
    expect(await withAccess([orgGrant('g-this', { missionId: 'synthetic-case' })])).not.toContain(
      SELF,
    );
  });

  it('does not count an agency this case is excluded for, or one with access to another case only', async () => {
    const excluded = orgGrant('g-excluded', {
      caseExceptions: [
        { missionId: 'synthetic-case', missionTitle: 'Japan visitor visa', since: new Date() },
      ],
    });
    expect(await withAccess([excluded])).toContain(SELF);
    expect(await withAccess([orgGrant('g-other', { missionId: 'another-case' })])).toContain(SELF);
    // An exception for a different case leaves this case covered.
    const otherException = orgGrant('g-other-exception', {
      caseExceptions: [{ missionId: 'another-case', missionTitle: 'Other', since: new Date() }],
    });
    expect(await withAccess([otherException])).not.toContain(SELF);
  });
});

describe('owner list items 1, 3 and 10 on the case page', () => {
  it('keeps Cancel away from the stage buttons and offers it from More only', async () => {
    setUp();
    const html = await render();
    expect(stubProps(html, 'TransitionButtons')).toEqual([
      { missionId: 'synthetic-case', nextStates: ['READY_FOR_REVIEW'] },
    ]);
    expect(stubProps(html, 'CaseMoreMenu')).toEqual([
      { missionId: 'synthetic-case', applicantId: 'synthetic-family', canCancel: true },
    ]);
    // More sits with the header actions, above the stage tracker.
    expect(html.indexOf('data-stub="CaseMoreMenu"')).toBeLessThan(
      html.indexOf('aria-label="Actual case workflow state"'),
    );
  });

  it('offers no cancel for a finished case', async () => {
    setUp();
    mocks.getMissionForOwner.mockResolvedValue(ok({ ...MISSION, state: 'CANCELLED' }));
    const html = await render();
    expect(stubProps(html, 'CaseMoreMenu')[0]).toMatchObject({ canCancel: false });
    expect(textOf(html)).toContain('This case is in a terminal state.');
    expect(html).not.toContain('data-stub="TransitionButtons"');
  });

  it('names the reuse and history links by what they give', async () => {
    setUp();
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Start a New Case from This One');
    expect(text).toContain('Open Case History');
    expect(text).not.toContain('Prepare Again');
    expect(text).not.toContain('Application Memory');
    expect(html).toContain(
      'href="/app/applicant/synthetic-family/missions/prepare-again?from=synthetic-case"',
    );
  });

  const justMade = () =>
    mocks.getMissionForOwner.mockResolvedValue(ok({ ...MISSION, createdAt: new Date() }));

  it('opens a new case with its welcome note under the header, and only then', async () => {
    setUp();
    justMade();
    expect(await render()).not.toContain('data-stub="CaseWelcome"');
    const html = await render({ welcome: '1' });
    const [welcome] = stubProps<{ title: string; action: { href: string } }>(html, 'CaseWelcome');
    expect(welcome?.title).toBe('Case Created');
    // No checklist is linked and none is published in this setup: the note says so.
    expect(welcome?.action.href).toBe('#evidence');
    expect(html.indexOf('data-stub="CaseWelcome"')).toBeLessThan(
      html.indexOf('aria-label="Actual case workflow state"'),
    );
  });

  it('greets only a case made in the last hour, not an old case opened with the same address', async () => {
    setUp();
    mocks.getMissionForOwner.mockResolvedValue(
      ok({ ...MISSION, createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) }),
    );
    expect(await render({ welcome: '1' })).not.toContain('data-stub="CaseWelcome"');
  });

  it('names the linked checklist in the welcome note', async () => {
    setUp({ requirements: ['CRITICAL_GAP'] });
    mocks.getMissionForOwner.mockResolvedValue(
      ok({ ...MISSION, packVersionId: 'pv-1', createdAt: new Date() }),
    );
    const [welcome] = stubProps<{ body: string[]; action: { href: string } }>(
      await render({ welcome: '1' }),
      'CaseWelcome',
    );
    expect(welcome?.body[0]).toContain('Checklist linked: Japan visitor.');
    expect(welcome?.action.href).toBe('#readiness');
  });

  describe('the welcome note counts only checklists that fit this case', () => {
    const otherRoutes = [
      {
        packVersionId: 'pv-uk',
        packKey: 'uk',
        packName: 'UK Visitor',
        version: 1,
        requirementCount: 3,
      },
      {
        packVersionId: 'pv-ca',
        packKey: 'ca',
        packName: 'Canada Study',
        version: 2,
        requirementCount: 4,
      },
    ];
    const japanTourism = () =>
      mocks.getMissionForOwner.mockResolvedValue(
        ok({ ...MISSION, purpose: 'Tourism', createdAt: new Date() }),
      );

    it('says there is no checklist for this route when only other routes are published', async () => {
      setUp();
      japanTourism();
      mocks.listPublishedPackVersions.mockResolvedValue(otherRoutes);
      const [welcome] = stubProps<{ body: string[]; action: { href: string } }>(
        await render({ welcome: '1' }),
        'CaseWelcome',
      );
      expect(welcome?.body[0]).toContain('There is no checklist for this route yet');
      expect(welcome?.action.href).toBe('#evidence');
      const [, terms] = mocks.listFittingPublicPacks.mock.calls[0] ?? [];
      expect(terms.country).toEqual(expect.arrayContaining(['JP', 'Japan']));
      expect(terms.purpose).toEqual(expect.arrayContaining(['tourism', 'Tourism']));
      expect(terms.traveller.nationality.terms).toEqual(expect.arrayContaining(['BD']));
    });

    it('asks the person to pick when a checklist fits the route', async () => {
      setUp();
      japanTourism();
      mocks.listPublishedPackVersions.mockResolvedValue(otherRoutes);
      mocks.listFittingPublicPacks.mockResolvedValue([
        { packVersionId: 'pv-jp', packName: 'Japan Visitor', version: 1, coversTraveller: true },
      ]);
      const [welcome] = stubProps<{ body: string[]; action: { href: string } }>(
        await render({ welcome: '1' }),
        'CaseWelcome',
      );
      expect(welcome?.action.href).toBe('#pack');
      expect(welcome?.body.join(' ')).not.toContain('does not confirm');
    });

    it('says when an unconfirmed nationality kept the checklist from being linked', async () => {
      setUp();
      japanTourism();
      mocks.readTravellerCoverage.mockResolvedValue({ nationality: [], residence: [] });
      mocks.listFittingPublicPacks.mockResolvedValue([
        { packVersionId: 'pv-jp', packName: 'Japan Visitor', version: 1, coversTraveller: false },
      ]);
      const [welcome] = stubProps<{ body: string[]; action: { href: string } }>(
        await render({ welcome: '1' }),
        'CaseWelcome',
      );
      expect(welcome?.body.join(' ')).toContain('the profile does not confirm them yet');
      expect(welcome?.action.href).toBe('#pack');
    });

    it('promises nothing when the lookup fails, even with checklists published', async () => {
      setUp();
      japanTourism();
      mocks.listPublishedPackVersions.mockResolvedValue(otherRoutes);
      mocks.listFittingPublicPacks.mockRejectedValue(new Error('connection reset'));
      const [welcome] = stubProps<{ body: string[]; action: { href: string } }>(
        await render({ welcome: '1' }),
        'CaseWelcome',
      );
      const text = welcome?.body.join(' ') ?? '';
      expect(text).not.toMatch(/pick the checklist|no checklist for this route/i);
      expect(welcome?.action.href).toBe('#evidence');
    });

    it('offers the picker to a case with no purpose when any checklist is published', async () => {
      setUp();
      mocks.getMissionForOwner.mockResolvedValue(ok({ ...MISSION, createdAt: new Date() }));
      mocks.listPublishedPackVersions.mockResolvedValue(otherRoutes);
      const [welcome] = stubProps<{ action: { href: string } }>(
        await render({ welcome: '1' }),
        'CaseWelcome',
      );
      expect(welcome?.action.href).toBe('#pack');
      expect(mocks.listFittingPublicPacks).not.toHaveBeenCalled();
    });

    it('looks nothing up for a case opened without the welcome mark', async () => {
      setUp();
      japanTourism();
      await render();
      expect(mocks.listFittingPublicPacks).not.toHaveBeenCalled();
      expect(mocks.readTravellerCoverage).not.toHaveBeenCalled();
    });
  });

  it('lists only the stage buttons as next steps and points to More for cancelling', async () => {
    setUp();
    const html = await render();
    const tracker = textOf(
      html.slice(
        html.indexOf('aria-label="Actual case workflow state"'),
        html.indexOf('</section>', html.indexOf('aria-label="Actual case workflow state"')),
      ),
    );
    expect(tracker).toContain('allows Ready for Review next;');
    expect(tracker).not.toMatch(/Cancelled next|, Cancelled/);
    expect(tracker).toContain('To stop the case, use More at the top of the page.');
  });
});

describe('the case on Glance, Browse and Everything (CCD-4)', () => {
  const dom = async (html: string) => new (await import('jsdom')).JSDOM(html).window.document;
  // The deepest level around the element, as the page's own link handling works it out; an
  // element that is not there fails the test instead of passing as Glance.
  const levelOf = (doc: Document, selector: string) => {
    const element = doc.querySelector<HTMLElement>(selector);
    const scope = doc.querySelector<HTMLElement>('[data-depth-scope]');
    expect(element, selector).not.toBeNull();
    expect(scope).not.toBeNull();
    return levelContaining(element as HTMLElement, scope as HTMLElement);
  };

  it('keeps the honesty line at every level', async () => {
    setUp({ requirements: ['CRITICAL_GAP'], openTasks: 1 });
    const doc = await dom(await render());
    const line = [...doc.querySelectorAll('p')].find((p) =>
      p.textContent?.startsWith('Preparing a file is not the same as submitting it.'),
    );
    expect(line).toBeDefined();
    expect(line?.closest('[data-level]')).toBeNull();
  });

  it('puts every section a link can point at where the link opens it', async () => {
    setUp({ requirements: ['CRITICAL_GAP', 'SATISFIED'], openTasks: 1 });
    const doc = await dom(await render());
    for (const id of ['#readiness', '#pack', '#work', '#notes']) {
      expect(levelOf(doc, id), id).toBe('browse');
    }
    for (const id of ['#evidence', '#outcome', '#snapshots']) {
      expect(levelOf(doc, id), id).toBe('everything');
    }
    // The section links themselves are at every level.
    expect(levelOf(doc, 'nav.jump-nav')).toBe('glance');
    expect(doc.querySelectorAll('#readiness')).toHaveLength(1);
  });

  it('keeps the summary card as #readiness when there is no checklist', async () => {
    setUp();
    const doc = await dom(await render());
    expect(levelOf(doc, '#readiness')).toBe('glance');
  });

  it('offers one primary button: the next step, not the checklist picker beside it', async () => {
    setUp({ openTasks: 2 });
    const html = await render();
    expect(stubProps<{ primary?: boolean }>(html, 'AttachPackForm')).toEqual([
      expect.objectContaining({ primary: false }),
    ]);
  });

  it('lets the checklist picker be the primary when nothing else asks for action', async () => {
    setUp();
    const html = await render();
    const [picker] = stubProps<{ primary?: boolean }>(html, 'AttachPackForm');
    expect(picker?.primary).toBe(!html.includes('case-next-step-heading'));
  });
});
