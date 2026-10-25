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
    expect(text).toContain('Changed since confirmed');
  });
});

describe('case journey view (WP-X1)', () => {
  it('shows the first attention item as the next step, under the tracker and above the attention list', async () => {
    setUp({ openTasks: 2 });
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Next step');
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
      { missionId: 'synthetic-case', label: 'Take a new snapshot', primary: true, align: 'start' },
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
});
