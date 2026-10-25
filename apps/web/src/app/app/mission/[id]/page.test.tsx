import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, stubProps, textOf } from '../../../../lib/next-mocks.test-support';

const ok = <T,>(value: T) => ({ ok: true as const, value });

const mocks = vi.hoisted(() => ({
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
vi.mock('./attach-pack-form', () => ({ AttachPackForm: stub('AttachPackForm') }));
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

const render = async () =>
  renderServer(await MissionPage({ params: Promise.resolve({ id: 'synthetic-case' }) }));

/** Index of each marker in the page, in document order. */
function order(html: string, markers: readonly string[]): number[] {
  return markers.map((marker) => html.indexOf(marker));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('case page as it is today (WP-X1 characterization)', () => {
  it('shows the stage tracker, the attention list and every section in order', async () => {
    setUp();
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Japan visitor visa');
    expect(text).toContain('Applicant has not confirmed yet');
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
    expect(cardText).toContain('Fix 2 required items');
    expect(cardText).toContain('Some required items are missing, out of date or do not match.');
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

  it('keeps the alert when the list cannot be read, pointing to Application Memory', async () => {
    setUp({ dirty: true, gateRefuses: true });
    const alert = alertOf(await render());
    expect(textOf(alert)).toContain('This case has changed since it was last acknowledged.');
    expect(alert).toContain('href="/app/applicant/synthetic-family/memory"');
    expect(mocks.listChangesSinceConfirmed).not.toHaveBeenCalled();
  });

  it('reads nothing extra for a case that has not changed, and links Application Memory from the snapshots', async () => {
    setUp();
    const html = await render();
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(html).not.toContain('class="case-changes"');
    const snapshots = html.slice(html.indexOf('id="snapshots"'));
    expect(snapshots).toContain('href="/app/applicant/synthetic-family/memory"');
  });
});
