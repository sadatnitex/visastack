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
  // WP-SB2: the capped reads answer with their first rows and totals.
  mocks.listMissionSnapshots.mockResolvedValue(ok({ items: [], nextCursor: null }));
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
      items: Array.from({ length: options.openTasks ?? 0 }, (_, i) => ({
        id: `task-${i}`,
        description: `Task ${i}`,
        status: 'OPEN',
        priority: 'NORMAL',
        dueDate: null,
        dueTimezone: null,
      })),
      total: options.openTasks ?? 0,
      open: options.openTasks ?? 0,
    }),
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
  it('shows the attention list, the stage tracker and every section in order', async () => {
    // A checklist with everything on file: nothing needs attention, and the checklist is #readiness.
    setUp({ requirements: ['SATISFIED'] });
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Japan visitor visa');
    expect(text).toContain('Traveller has not confirmed yet');
    expect(text).toContain('Nothing needs attention right now');
    expect(html).toContain('aria-label="Actual case workflow state"');
    expect(html).toContain('aria-current="step"');
    const sections = order(html, [
      'class="case-attention"',
      'aria-label="Actual case workflow state"',
      'aria-label="Sections of this case"',
      'id="readiness"',
      // The side column (snapshots) follows the checklist and comes before the other sections.
      'id="snapshots"',
      'id="evidence"',
      'id="work"',
      'id="notes"',
      'id="outcome"',
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

  it('warns when the case changed since it was confirmed, in plain words', async () => {
    setUp({ dirty: true });
    const text = textOf(await render());
    expect(text).toContain('Something changed after you confirmed this case.');
    expect(text).toContain(
      'Take a new snapshot and confirm it again before you rely on this case.',
    );
    expect(text).toContain('changed since confirmed');
    // The engineering words are gone.
    expect(text).not.toContain('material edit');
    expect(text).not.toContain('invalidated');
  });

  it('says a case with no checklist is unchecked, never that nothing needs attention', async () => {
    setUp();
    const text = textOf(await render());
    expect(text).toContain('Nothing is checked yet: this case has no checklist');
    expect(text).not.toContain('Nothing needs attention right now');
    // No checklist can be picked here, so the empty progress offers Add Evidence, not a pick.
    expect(text).toContain('No Checklist Yet');
    expect(text).not.toContain('Pick a Checklist');
  });
});

describe('case journey view (WP-X1)', () => {
  it('shows the first attention item as the next step, above the attention list and the tracker', async () => {
    setUp({ openTasks: 2 });
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Next Step');
    expect(text).toContain('Finish 2 open tasks');
    const [card, list, tracker] = order(html, [
      'aria-labelledby="case-next-step-heading"',
      'class="case-attention"',
      'aria-label="Actual case workflow state"',
    ]);
    expect(card).toBeLessThan(list ?? -1);
    expect(list).toBeLessThan(tracker ?? -1);
    // One primary action, pointing where the attention item points.
    const cardHtml = html.slice(card, list);
    expect(cardHtml.match(/btn-primary/g)).toHaveLength(1);
    expect(cardHtml).toContain('href="#work"');
  });

  it('shows no card when nothing needs attention, keeping the success badge', async () => {
    setUp({ requirements: ['SATISFIED'] });
    const html = await render();
    expect(html).not.toContain('aria-labelledby="case-next-step-heading"');
    expect(textOf(html)).toContain('Nothing needs attention right now');
  });

  it('a changed case shows the alert with its snapshot button first in the status card, and no card', async () => {
    setUp({ dirty: true, openTasks: 1 });
    const html = await render();
    expect(html).not.toContain('aria-labelledby="case-next-step-heading"');
    const tracker = html.indexOf('aria-label="Actual case workflow state"');
    const alert = html.indexOf('class="case-alert"');
    const strip = html.indexOf('class="case-context-strip"');
    const progress = html.indexOf('class="lift-status-progress"');
    expect(alert).toBeGreaterThan(-1);
    expect(alert).toBeLessThan(progress);
    expect(progress).toBeLessThan(strip);
    expect(strip).toBeLessThan(tracker);
    expect(html.slice(alert, progress)).toContain('data-stub="SnapshotButton"');
    // The alert's button is the primary, clearly named one; the header keeps its defaults.
    expect(stubProps(html, 'SnapshotButton')).toEqual([
      { missionId: 'synthetic-case' },
      { missionId: 'synthetic-case', label: 'Take a New Snapshot', primary: true, align: 'start' },
    ]);
    expect(html.slice(alert, progress)).not.toContain('role=');
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
    // One short line shows; the longer reason is folded under "Why This Step" (the 30-word rule).
    expect(cardText).toContain('First to fix: Bank Statement.');
    expect(cardText).toContain('Why This Step');
    expect(cardText).toContain('Some required items are missing, out of date or do not match.');
    expect(html.slice(card, list)).toMatch(
      /<details class="lift-help lift-about"><summary>Why This Step<\/summary>/,
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

  it('UMPE P1: shows necessity, who asked, and alternatives as one item; legacy rows unchanged', async () => {
    setUp({ requirements: ['CRITICAL_GAP'] });
    const legacy = textOf(await render());
    expect(legacy).not.toMatch(/Mandatory|Any One of These|Requested by/);

    setUp({ requirements: ['CRITICAL_GAP'] });
    const row = (id: string, key: string, extra: Record<string, unknown>) => ({
      packRequirementId: id,
      kind: 'DOCUMENT' as const,
      key,
      optional: false,
      state: 'CRITICAL_GAP',
      ...extra,
    });
    const results = [
      row('g1', 'bank_statement', { necessity: 'MANDATORY', groupKey: 'funds' }),
      row('g2', 'sponsor_letter', { necessity: 'MANDATORY', groupKey: 'funds' }),
      row('h1', 'hotel_booking', {
        necessity: 'RECOMMENDED',
        provenance: 'AGENCY_ADDED',
        optional: true,
        state: 'ATTENTION',
      }),
    ];
    mocks.computeReadiness.mockResolvedValue(
      ok({
        overallState: 'NEEDS_ACTION',
        requirementResults: results,
        requiredCount: 1,
        satisfiedRequired: 0,
      }),
    );
    mocks.listRequirements.mockResolvedValue(
      results.map((r) => ({
        id: r.packRequirementId,
        citation: 'rule',
        sourceInaccessibleAt: null,
      })),
    );
    const text = textOf(await render());
    expect(text).toContain('Bank Statement · Mandatory');
    expect(text).toContain('Any One of These: Bank Statement or Sponsor Letter');
    expect(text).toContain('Hotel Booking · Recommended');
    expect(text).toContain('Requested by Your Agency');
    // Two alternatives are one item to provide.
    expect(text).toMatch(/Fix 1 required item(?!s)/);
  });

  it('reminds that a prepared file is not a submission, after the next step, on every case', async () => {
    const reminder =
      'Preparing a file is not the same as submitting it. VisaStack does not submit applications or predict decisions.';
    for (const options of [{}, { openTasks: 1 }, { dirty: true }]) {
      setUp(options);
      const html = await render();
      expect(textOf(html)).toContain(reminder);
      // Directly under the status card, so after the card's own stage line.
      const at = html.indexOf('case-journey-reminder');
      expect(at).toBeGreaterThan(html.indexOf('aria-label="Actual case workflow state"'));
      expect(at).toBeGreaterThan(html.indexOf('class="case-context-strip"'));
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
  return html.slice(
    html.indexOf('class="case-alert"'),
    html.indexOf('class="lift-status-progress"'),
  );
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
    expect(text).toContain('Something changed after you confirmed this case.');
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
    // The button comes first; the list is folded under "What Changed" (the 30-word rule).
    expect(alert.indexOf('data-stub="SnapshotButton"')).toBeLessThan(
      alert.indexOf('class="case-changes"'),
    );
    expect(text).toContain('What Changed');
    expect(alert).toMatch(/<details class="lift-help lift-about"><summary>What Changed<\/summary>/);
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
    expect(textOf(alert)).toContain('Something changed after you confirmed this case.');
    expect(alert).toContain('href="/app/applicant/synthetic-family/memory"');
    expect(mocks.listChangesSinceConfirmed).not.toHaveBeenCalled();
  });

  it('reads nothing extra for a case that has not changed, and links Case History from the snapshots', async () => {
    setUp();
    const html = await render();
    // The only gate call is the picker's owner proof for this traveller; nothing reads changes.
    expect(mocks.requireAccess).toHaveBeenCalledTimes(1);
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'VIEW_METADATA',
      { applicantId: 'synthetic-family' },
      { purpose: 'self' },
    );
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
      {
        missionId: 'synthetic-case',
        applicantId: 'synthetic-family',
        canCancel: true,
        // WP-SB2: on a phone the header's own actions are offered from More too.
        headerActions: {
          addEvidenceHref: '#evidence',
          newCaseHref: '/app/applicant/synthetic-family/missions/prepare-again?from=synthetic-case',
        },
      },
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

    it('says there is no checklist for this route when no reviewed checklist fits it', async () => {
      setUp();
      japanTourism();
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
      mocks.listFittingPublicPacks.mockRejectedValue(new Error('connection reset'));
      const [welcome] = stubProps<{ body: string[]; action: { href: string } }>(
        await render({ welcome: '1' }),
        'CaseWelcome',
      );
      const text = welcome?.body.join(' ') ?? '';
      expect(text).not.toMatch(/pick the checklist|no checklist for this route/i);
      expect(welcome?.action.href).toBe('#evidence');
    });

    it('offers the picker to a case with no purpose when any checklist may be picked', async () => {
      setUp();
      mocks.getMissionForOwner.mockResolvedValue(ok({ ...MISSION, createdAt: new Date() }));
      mocks.listSelectablePackVersions.mockResolvedValue(ok(otherRoutes));
      const [welcome] = stubProps<{ action: { href: string } }>(
        await render({ welcome: '1' }),
        'CaseWelcome',
      );
      expect(welcome?.action.href).toBe('#pack');
      expect(mocks.listFittingPublicPacks).not.toHaveBeenCalled();
    });

    it('works out the fitting checklists once, for the picker, and reuses them for the welcome note', async () => {
      setUp();
      japanTourism();
      await render();
      expect(mocks.listFittingPublicPacks).toHaveBeenCalledTimes(1);
      vi.clearAllMocks();
      setUp();
      japanTourism();
      await render({ welcome: '1' });
      expect(mocks.listFittingPublicPacks).toHaveBeenCalledTimes(1);
    });

    it('looks nothing up for a case that already holds a checklist', async () => {
      setUp({ requirements: ['SATISFIED'] });
      await render({ welcome: '1' });
      expect(mocks.listFittingPublicPacks).not.toHaveBeenCalled();
      expect(mocks.listSelectablePackVersions).not.toHaveBeenCalled();
      expect(mocks.explainNoFittingPack).not.toHaveBeenCalled();
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
    for (const id of ['#pack', '#work', '#notes']) {
      expect(levelOf(doc, id), id).toBe('browse');
    }
    // The checklist is the heart of the page, so it shows at every level (Owner, 4 Nov 2026).
    expect(levelOf(doc, '#readiness'), '#readiness').toBe('glance');
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

/**
 * WP-SB2 (Scroll Budget): the case page reads every list capped on the server and shows 10 rows,
 * then Show More; the checklist sits in groups that open and close; five snapshots and a link to
 * the rest; on a phone the header actions fold into More and the next step stays in reach.
 */
describe('WP-SB2: a worst-case case stays short', () => {
  const doc = async (html: string) => new (await import('jsdom')).JSDOM(html).window.document;
  const renderWith = async (query: Record<string, string | string[]>) =>
    renderServer(
      await MissionPage({
        params: Promise.resolve({ id: 'synthetic-case' }),
        searchParams: Promise.resolve(query),
      }),
    );
  /** A 60-requirement case: 20 missing, 10 to confirm, 30 on file. */
  const sixty = [
    ...Array.from({ length: 20 }, () => 'CRITICAL_GAP'),
    ...Array.from({ length: 10 }, () => 'UNVERIFIED'),
    ...Array.from({ length: 30 }, () => 'SATISFIED'),
  ];
  const note = (i: number) => ({
    id: `note-${i}`,
    body: `Shared note ${i}`,
    authorEmail: 'agent@example.com',
    createdAt: new Date('2026-10-20T00:00:00Z'),
  });
  const outcome = (i: number) => ({
    id: `outcome-${i}`,
    decision: 'GRANTED',
    decisionDate: new Date('2026-10-20T00:00:00Z'),
    officialWording: null,
    agencyInterpretation: null,
    createdAt: new Date('2026-10-20T00:00:00Z'),
  });

  it('groups a 60-item checklist, with what is missing open first and the rest closed', async () => {
    setUp({ requirements: sixty });
    const page = await doc(await renderWith({}));
    const groups = [...page.querySelectorAll('#readiness details.collapsible-group')];
    // Each opener holds the group's real heading with its count, as the checklist had before.
    expect(groups.map((g) => g.querySelector('summary > h4')?.textContent)).toEqual([
      'Needs You 20',
      'Needs a Check 10',
      'Done 30',
    ]);
    expect(groups.map((g) => g.hasAttribute('open'))).toEqual([true, false, false]);
    expect(groups[0]?.id).toBe('case-checklist-needs-you');
    expect(page.querySelectorAll('#readiness .row')).toHaveLength(60);
    // Each group shows 3 rows; the rest fold under one more control inside it.
    const first = groups[0];
    expect(first?.querySelectorAll('.collapsible-group-body > .rows > .row')).toHaveLength(3);
    const rest = first?.querySelector('details.case-checklist-rest');
    expect(rest?.hasAttribute('open')).toBe(false);
    expect(rest?.querySelector('summary')?.textContent).toBe('17 More Items');
    expect(rest?.querySelectorAll('.row')).toHaveLength(17);
    expect(groups[1]?.querySelector('details.case-checklist-rest summary')?.textContent).toBe(
      '7 More Items',
    );
  });

  it('opens the first group that has rows when nothing is missing', async () => {
    setUp({ requirements: ['UNVERIFIED', 'SATISFIED'] });
    const page = await doc(await renderWith({}));
    const open = [...page.querySelectorAll('#readiness details.collapsible-group[open]')];
    expect(open.map((g) => g.querySelector('summary > h4')?.textContent)).toEqual([
      'Needs a Check 1',
    ]);
  });

  it('asks the server for 10 rows of each list and 5 snapshots by default', async () => {
    setUp();
    await renderWith({});
    expect(mocks.listTasks).toHaveBeenCalledWith({}, 'synthetic-owner', 'synthetic-case', {
      limit: 10,
    });
    expect(mocks.listNotesForOwner).toHaveBeenCalledWith({}, 'synthetic-owner', 'synthetic-case', {
      limit: 10,
    });
    expect(mocks.listComplaintsForMission).toHaveBeenCalledWith(
      {},
      'synthetic-owner',
      'synthetic-case',
      { limit: 10 },
    );
    expect(mocks.listFeedbackForMission).toHaveBeenCalledWith(
      {},
      'synthetic-owner',
      'synthetic-case',
      { limit: 10 },
    );
    expect(mocks.listMissionSnapshots).toHaveBeenCalledWith(
      {},
      'synthetic-owner',
      'synthetic-case',
      { limit: 5 },
    );
  });

  it('grows one list by 10 per Show More, clamps a hand-edited address and keeps others at 10', async () => {
    setUp();
    await renderWith({ tasks: '20', notes: 'lots', complaints: '999999', feedback: ['30', '10'] });
    expect(mocks.listTasks.mock.calls[0]?.[3]).toEqual({ limit: 20 });
    expect(mocks.listNotesForOwner.mock.calls[0]?.[3]).toEqual({ limit: 10 });
    expect(mocks.listComplaintsForMission.mock.calls[0]?.[3]).toEqual({ limit: 100 });
    expect(mocks.listFeedbackForMission.mock.calls[0]?.[3]).toEqual({ limit: 30 });
  });

  it('shows 10 shared notes of 34 with a Show More link that lands on the first new note', async () => {
    setUp();
    mocks.listNotesForOwner.mockResolvedValue({
      items: Array.from({ length: 10 }, (_, i) => note(i)),
      total: 34,
    });
    const page = await doc(await renderWith({ welcome: '1' }));
    const notes = page.querySelector('#notes');
    expect(notes?.querySelectorAll('[id^="case-note-"].row')).toHaveLength(10);
    expect(notes?.querySelector('.show-more-count')?.textContent).toBe('Showing 10 of 34 notes.');
    const link = notes?.querySelector<HTMLAnchorElement>('a.show-more-link');
    expect(link?.textContent).toBe('Show More notes');
    // Only this list grows, and the one-time welcome note is not asked for again.
    expect(link?.getAttribute('href')).toBe('/app/mission/synthetic-case?notes=20#case-note-10');
    expect(notes?.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it('keeps the section open after Show More and drops the link once every row is shown', async () => {
    setUp();
    mocks.listNotesForOwner.mockResolvedValue({
      items: Array.from({ length: 14 }, (_, i) => note(i)),
      total: 14,
    });
    const page = await doc(await renderWith({ notes: '20' }));
    const notes = page.querySelector('#notes');
    expect(notes?.querySelector('details')?.hasAttribute('open')).toBe(true);
    expect(notes?.querySelector('.show-more-count')?.textContent).toBe('Showing all 14 notes.');
    expect(notes?.querySelector('a.show-more-link')).toBeNull();
  });

  it('passes a Show More to each capped panel only when its list is longer than 10', async () => {
    setUp();
    mocks.listTasks.mockResolvedValue(
      ok({
        items: Array.from({ length: 10 }, (_, i) => ({
          id: `task-${i}`,
          description: `Task ${i}`,
          status: 'OPEN',
          priority: 'NORMAL',
          dueDate: null,
          dueTimezone: null,
        })),
        total: 40,
        open: 25,
      }),
    );
    mocks.listComplaintsForMission.mockResolvedValue(ok({ items: [], total: 3 }));
    mocks.listOutcomesForMission.mockResolvedValue(
      ok(Array.from({ length: 12 }, (_, i) => outcome(i))),
    );
    const html = await renderWith({});
    const [tasks] = stubProps<{ tasks: unknown[]; rowIdPrefix: string; more: unknown }>(
      html,
      'TasksPanel',
    );
    expect(tasks?.tasks).toHaveLength(10);
    expect(tasks?.rowIdPrefix).toBe('case-task');
    expect(tasks?.more).toMatchObject({
      props: {
        id: 'case-tasks-more',
        landOn: 'case-task-10',
        next: { tasks: 20 },
        shown: 10,
        total: 40,
      },
    });
    const [complaints] = stubProps<{ more: unknown }>(html, 'ComplaintPanel');
    expect(complaints?.more).toBeNull();
    // Outcomes are cut to 10 on the page, with Show More for the other 2.
    const [outcomes] = stubProps<{ outcomes: unknown[]; more: unknown }>(html, 'OutcomePanel');
    expect(outcomes?.outcomes).toHaveLength(10);
    expect(outcomes?.more).toMatchObject({ props: { next: { outcomes: 20 }, total: 12 } });
    // The open-task count comes from the whole case, not the 10 rows on the page.
    expect(textOf(html)).toContain('Finish 25 open tasks for Japan visitor visa');
  });

  it('lists 5 snapshots and links to the rest only when more exist', async () => {
    setUp();
    const snap = (version: number) => ({
      id: `snap-${version}`,
      version,
      checksum: `checksum-${version}-0123456789`,
      content: { state: 'IN_PROGRESS' },
    });
    mocks.listMissionSnapshots.mockResolvedValue(
      ok({ items: [9, 8, 7, 6, 5].map(snap), nextCursor: 'opaque' }),
    );
    let page = await doc(await renderWith({}));
    expect(page.querySelectorAll('#snapshots a.row')).toHaveLength(5);
    expect(
      [...page.querySelectorAll('#snapshots a')]
        .find((a) => a.textContent === 'See All Snapshots')
        ?.getAttribute('href'),
    ).toBe('/app/mission/synthetic-case/snapshots');
    mocks.listMissionSnapshots.mockResolvedValue(ok({ items: [snap(1)], nextCursor: null }));
    page = await doc(await renderWith({}));
    expect(textOf(page.querySelector('#snapshots')?.outerHTML ?? '')).not.toContain(
      'See All Snapshots',
    );
  });

  it('folds the header actions into More on a phone and keeps the next step in reach', async () => {
    setUp({ requirements: ['CRITICAL_GAP'] });
    const page = await doc(await renderWith({}));
    const wide = page.querySelector('.page-actions .case-header-wide');
    expect([...(wide?.querySelectorAll('a') ?? [])].map((a) => a.textContent)).toEqual([
      'Add Evidence',
      'Start a New Case from This One',
    ]);
    expect(wide?.querySelector('[data-stub="SnapshotButton"]')).not.toBeNull();
    const bar = page.querySelector('.case-sticky-next fieldset.sticky-action-bar');
    expect(bar?.querySelector('legend')?.textContent).toBe('Next Step');
    expect(bar?.querySelector('output')?.textContent).toBe('0 of 1 \u00b7 1 to fix');
    const action = bar?.querySelector('a');
    expect(action?.getAttribute('href')).toBe('#readiness');
    expect(action?.className).toBe('btn btn-secondary');
  });

  it('shows no sticky bar when there is no next step', async () => {
    setUp();
    const page = await doc(await renderWith({}));
    expect(page.querySelector('.case-sticky-next')).toBeNull();
  });

  it('names the need-a-check group on its link, which opens it when followed', async () => {
    setUp({ requirements: ['CRITICAL_GAP', 'UNVERIFIED', 'UNVERIFIED'] });
    const page = await doc(await renderWith({}));
    const chip = [...page.querySelectorAll('.case-attention a')].find((a) =>
      a.textContent?.includes('need a check'),
    );
    // The address stays the checklist; the link names the group it opens.
    expect(chip?.getAttribute('href')).toBe('#readiness');
    expect(chip?.getAttribute('data-open-group')).toBe('case-checklist-needs-a-check');
    expect(page.querySelector('#case-checklist-needs-a-check')?.tagName).toBe('DETAILS');
  });

  it('counts finished tasks across the whole case and opens them after Show More', async () => {
    setUp();
    mocks.listTasks.mockResolvedValue(ok({ items: [], total: 60, open: 3 }));
    let [tasks] = stubProps<{ finishedTotal: number; finishedOpen: boolean }>(
      await renderWith({}),
      'TasksPanel',
    );
    expect(tasks).toMatchObject({ finishedTotal: 57, finishedOpen: false });
    [tasks] = stubProps<{ finishedTotal: number; finishedOpen: boolean }>(
      await renderWith({ tasks: '20' }),
      'TasksPanel',
    );
    expect(tasks?.finishedOpen).toBe(true);
  });
});

describe('WP-SB2: a short checklist group', () => {
  it('shows every row of a group of 3 or fewer, with no fold', async () => {
    setUp({ requirements: ['CRITICAL_GAP', 'CRITICAL_GAP', 'CRITICAL_GAP', 'SATISFIED'] });
    const page = new (await import('jsdom')).JSDOM(await render()).window.document;
    expect(page.querySelector('#case-checklist-needs-you details.case-checklist-rest')).toBeNull();
    expect(page.querySelectorAll('#case-checklist-needs-you .row')).toHaveLength(3);
  });
});

describe('lifecycle labels on the case evidence (resource lifecycle, lane Z)', () => {
  const candidate = (selected: readonly string[]) => ({
    packRequirementId: 'req-0',
    kind: 'DOCUMENT',
    key: 'bank_statement',
    citation: 'rule',
    optional: false,
    factCandidates: [],
    documentCandidates: [
      {
        documentId: 'doc-archived',
        displayName: 'Bank statement October',
        eligible: true,
        staleness: { status: 'fresh' },
      },
      {
        documentId: 'doc-current',
        displayName: 'Bank statement September',
        eligible: true,
        staleness: { status: 'fresh' },
      },
    ],
    selectedFactIds: [],
    selectedDocumentIds: selected,
  });
  const lifecycle = (state: string, extra: Record<string, unknown> = {}) => ({
    state,
    replaced: false,
    archivedAt: null,
    deletedAt: null,
    purgeAfter: null,
    deletePath: null,
    ...extra,
  });

  it('marks a chosen archived or removed document on its checklist line and in the picker, never by name', async () => {
    setUp({ requirements: ['SATISFIED'] });
    mocks.getEvidenceCandidates.mockResolvedValue(ok([candidate(['doc-archived', 'doc-removed'])]));
    mocks.getDocumentLifecycles.mockResolvedValue(
      new Map([
        ['doc-archived', lifecycle('ARCHIVED')],
        ['doc-current', lifecycle('CURRENT')],
        [
          'doc-removed',
          lifecycle('RECENTLY_DELETED', { deletedAt: new Date('2026-11-03T09:00:00Z') }),
        ],
      ]),
    );
    const html = await render();
    const text = textOf(html);
    expect(text).toMatch(/Chosen document: Archived, Removed by the traveller on 3 Nov/);
    expect(mocks.getDocumentLifecycles).toHaveBeenCalledWith(
      expect.anything(),
      ['doc-archived', 'doc-current', 'doc-removed'],
      { synthetic: 'proof' },
      expect.objectContaining({ now: expect.any(Date) }),
    );
    const panel = stubProps<{
      candidates: { documentCandidates: { documentId: string; lifecycleLabel: string | null }[] }[];
    }>(html, 'EvidenceSelectionPanel')[0];
    expect(
      panel?.candidates[0]?.documentCandidates.map((d) => [d.documentId, d.lifecycleLabel]),
    ).toEqual([
      ['doc-archived', 'Archived'],
      ['doc-current', null],
    ]);
  });

  it('shows no line when every chosen document is current, and reads no lifecycle without evidence', async () => {
    setUp({ requirements: ['SATISFIED'] });
    mocks.getEvidenceCandidates.mockResolvedValue(ok([candidate(['doc-current'])]));
    mocks.getDocumentLifecycles.mockResolvedValue(new Map([['doc-current', lifecycle('CURRENT')]]));
    expect(textOf(await render())).not.toContain('Chosen document:');

    vi.clearAllMocks();
    setUp({ requirements: ['SATISFIED'] });
    await render();
    expect(mocks.getDocumentLifecycles).not.toHaveBeenCalled();
  });
});

describe('the Requirement Pack card (VS-006)', () => {
  const japanTourism = () =>
    mocks.getMissionForOwner.mockResolvedValue(
      ok({ ...MISSION, purpose: 'Tourism', createdAt: new Date() }),
    );
  const packRow = (extra: Record<string, unknown> = {}) => ({
    packId: 'p1',
    effectiveDate: null,
    status: 'PUBLISHED',
    withdrawnAt: null,
    nextReviewDate: null,
    ...extra,
  });
  const pack = (extra: Record<string, unknown> = {}) => ({
    name: 'Japan visitor',
    authoritative: true,
    ownerOrganizationId: null,
    route: 'visitor',
    jurisdiction: 'Japan',
    ...extra,
  });

  it('says a checklist is for travel to a country, and the case place is the embassy or visa centre', async () => {
    setUp({ requirements: ['SATISFIED'] });
    mocks.getPack.mockResolvedValue(pack());
    const text = textOf(await render());
    expect(text).toContain('For travel to Japan');
    expect(text).toContain('Embassy or visa centre not set');
    expect(text).not.toContain('Jurisdiction not set');
  });

  it('labels a requirement source as a source, never as a cite', async () => {
    setUp({ requirements: ['SATISFIED'] });
    const text = textOf(await render());
    expect(text).toContain('Source: rule');
    expect(text).not.toContain('Cite:');
  });

  it('warns about an overdue review, and still shows the checklist the case holds', async () => {
    setUp({ requirements: ['SATISFIED'] });
    mocks.getPack.mockResolvedValue(pack());
    mocks.getPackVersion.mockResolvedValue(
      packRow({ nextReviewDate: new Date('2020-01-02T00:00:00Z') }),
    );
    const text = textOf(await render());
    expect(text).toContain('Japan visitor');
    expect(text).toContain(
      'Due for its regular review since 2 January 2020. It stays on this case.',
    );
  });

  it('says nothing about review while the checklist is current', async () => {
    setUp({ requirements: ['SATISFIED'] });
    mocks.getPack.mockResolvedValue(pack());
    mocks.getPackVersion.mockResolvedValue(
      packRow({ nextReviewDate: new Date('2999-01-01T00:00:00Z') }),
    );
    expect(textOf(await render())).not.toContain('regular review');
  });

  it('says a withdrawn checklist is withdrawn and stays on the case', async () => {
    setUp({ requirements: ['SATISFIED'] });
    mocks.getPack.mockResolvedValue(pack());
    mocks.getPackVersion.mockResolvedValue(
      packRow({ status: 'WITHDRAWN', withdrawnAt: new Date('2026-10-30T00:00:00Z') }),
    );
    const text = textOf(await render());
    expect(text).toContain('Withdrawn on 30 October 2026. It stays on this case as it was');
  });

  it('calls an unowned, unreviewed pack Not Reviewed, and an agency pack an agency checklist', async () => {
    setUp({ requirements: ['SATISFIED'] });
    mocks.getPack.mockResolvedValue(pack({ authoritative: false }));
    const unreviewed = textOf(await render());
    expect(unreviewed).toContain('Not Reviewed');
    expect(unreviewed).toContain('Nobody has reviewed this checklist yet');
    expect(unreviewed).not.toContain('Agency Custom Checklist');
    mocks.getPack.mockResolvedValue(pack({ authoritative: false, ownerOrganizationId: 'org-1' }));
    const own = textOf(await render());
    expect(own).toContain('Agency Custom Checklist');
    expect(own).not.toContain('Not Reviewed');
  });

  it('shows the official badge for a reviewed pack', async () => {
    setUp({ requirements: ['SATISFIED'] });
    mocks.getPack.mockResolvedValue(pack());
    const text = textOf(await render());
    expect(text).toContain('Official Requirement Pack');
    expect(text).not.toContain('Not Reviewed');
  });

  it('offers the picker only the fitting reviewed checklists, never every published one', async () => {
    setUp();
    japanTourism();
    const fits = {
      packVersionId: 'pv-jp',
      packName: 'Japan Visitor',
      version: 1,
      coversTraveller: true,
      coversRoute: true,
    };
    mocks.listFittingPublicPacks.mockResolvedValue([fits]);
    mocks.listSelectablePackVersions.mockResolvedValue(
      ok([
        {
          packVersionId: 'pv-jp',
          packKey: 'jp',
          packName: 'Japan Visitor',
          version: 1,
          requirementCount: 3,
          reviewOverdue: true,
        },
      ]),
    );
    const [picker] = stubProps<{ options: { packVersionId: string; label: string }[] }>(
      await render(),
      'AttachPackForm',
    );
    // Read through the owner's gate proof, not a bare account id.
    expect(mocks.listSelectablePackVersions).toHaveBeenCalledWith(
      { synthetic: 'proof' },
      expect.objectContaining({ missionId: 'synthetic-case', fitting: [fits] }),
    );
    expect(picker?.options).toEqual([
      { packVersionId: 'pv-jp', label: 'Japan Visitor · v1 · 3 requirements · review due' },
    ]);
  });

  it('offers nothing when the fit cannot be worked out, rather than every checklist', async () => {
    setUp();
    japanTourism();
    mocks.listFittingPublicPacks.mockRejectedValue(new Error('connection reset'));
    await render();
    expect(mocks.listSelectablePackVersions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fitting: [] }),
    );
  });

  it('says it could not load checklists, never that none exists, when the look-up failed', async () => {
    const neutral = 'Checklists could not be loaded right now.';
    // The fit look-up throws.
    setUp();
    japanTourism();
    mocks.listFittingPublicPacks.mockRejectedValue(new Error('connection reset'));
    let text = textOf(await render());
    expect(text).toContain(neutral);
    expect(text).not.toMatch(/no reviewed checklist|exists for travel/);
    // The access gate refuses, so the case's details could not be read.
    vi.clearAllMocks();
    setUp({ gateRefuses: true });
    japanTourism();
    text = textOf(await render());
    expect(text).toContain(neutral);
    expect(text).not.toMatch(/no reviewed checklist|exists for travel/);
    expect(mocks.explainNoFittingPack).not.toHaveBeenCalled();
    // The picker's own list fails.
    vi.clearAllMocks();
    setUp();
    japanTourism();
    mocks.listSelectablePackVersions.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'no' },
    });
    text = textOf(await render());
    expect(text).toContain(neutral);
    expect(text).not.toMatch(/no reviewed checklist|exists for travel/);
  });

  it('says the welcome note could not check, not that there is none, when the gate refuses', async () => {
    setUp({ gateRefuses: true });
    japanTourism();
    const [welcome] = stubProps<{ body: string[] }>(await render({ welcome: '1' }), 'CaseWelcome');
    expect((welcome?.body ?? []).join(' ')).not.toContain('There is no checklist for this route');
  });

  it('shows no Source line for a citation that only fills the box, but keeps a recorded source', async () => {
    setUp({ requirements: ['SATISFIED'] });
    const filler = (extra: Record<string, unknown> = {}) =>
      mocks.listRequirements.mockResolvedValue([
        {
          id: 'req-0',
          citation: 'Yes',
          sourceInaccessibleAt: null,
          publisher: null,
          sourceTitle: null,
          sourceUrl: null,
          ...extra,
        },
      ]);
    filler();
    expect(textOf(await render())).not.toContain('Source:');
    filler({ publisher: 'Synthetic Authority', sourceTitle: 'Synthetic Page' });
    expect(textOf(await render())).toContain('Source: Synthetic Authority · Synthetic Page');
  });

  it('says there is no reviewed checklist, and why, instead of asking for a pick', async () => {
    setUp();
    japanTourism();
    mocks.explainNoFittingPack.mockResolvedValue(['NO_REVIEWED_CHECKLIST']);
    const text = textOf(await render());
    expect(text).toContain(
      'VisaStack has no reviewed checklist for travel to Japan for tourism yet',
    );
    expect(text).not.toContain('Pick a checklist: attach');
  });

  it('names the application place as the reason, and does not call the destination a place', async () => {
    setUp();
    japanTourism();
    mocks.explainNoFittingPack.mockResolvedValue([
      'OTHER_APPLICATION_POST',
      'OUTSIDE_TRAVEL_DATES',
    ]);
    const text = textOf(await render());
    expect(text).toContain(
      'A reviewed checklist exists for travel to Japan for tourism, but none of them fits this case. They are written for a different embassy or visa centre than the one on this case or different travel dates',
    );
    expect(text).not.toMatch(/official source|gov\.uk|http/i);
  });
});

/**
 * WP-LIFT-A (owner, 4 Nov 2026: redesign the case pages): one status card, one set of numbers, a
 * checklist where every row has one action and a finished row is one line.
 */
describe('the case status card and the checklist (WP-LIFT-A)', () => {
  const MIXED = [
    'CRITICAL_GAP',
    'CRITICAL_GAP',
    'EXPIRING_STALE',
    'CONFLICTING',
    'UNVERIFIED',
    'SATISFIED',
  ];

  it('counts the items to fix once: the next step, the chip, the sentence, the counts and the group agree', async () => {
    setUp({ requirements: MIXED });
    const html = await render();
    const text = textOf(html);
    expect(text).toContain('Fix 4 required items for Japan visitor visa');
    expect(text).toContain('4 required items to fix');
    expect(text).toContain('4 required items still needed');
    // Missing (2) and out of date or two values (2) are the four items to fix.
    expect(html).toContain('<dt>Missing</dt><dd>2</dd>');
    expect(html).toContain('<dt>Out of Date or Two Values</dt><dd>2</dd>');
    expect(text).toContain('Needs You 4');
    // The old wording that counted differently is gone.
    expect(text).not.toContain('requirement(s)');
    expect(text).not.toContain('required items missing');
  });

  it('says one required item in the singular everywhere', async () => {
    setUp({ requirements: ['CRITICAL_GAP'] });
    const text = textOf(await render());
    expect(text).toContain('1 required item still needed');
    expect(text).toContain('1 required item to fix');
  });

  it('keeps one filled button in the status card, and none in the empty progress', async () => {
    setUp({ requirements: MIXED, openTasks: 2 });
    const html = await render();
    const card = html.slice(
      html.indexOf('class="lift-status"'),
      html.indexOf('case-journey-reminder'),
    );
    expect(card.match(/btn-primary/g)).toHaveLength(1);
    setUp({ openTasks: 1 });
    const empty = await render();
    const emptyCard = empty.slice(
      empty.indexOf('class="lift-status"'),
      empty.indexOf('class="case-journey-reminder"'),
    );
    expect(emptyCard.match(/btn-primary/g)).toHaveLength(1);
  });

  it('offers the way forward once when the welcome note is on the page', async () => {
    setUp();
    mocks.getMissionForOwner.mockResolvedValue(ok({ ...MISSION, createdAt: new Date() }));
    const html = await render({ welcome: '1' });
    expect(html).toContain('data-stub="CaseWelcome"');
    const card = html.slice(
      html.indexOf('class="lift-status"'),
      html.indexOf('case-journey-reminder'),
    );
    // The welcome note (a stand-in here) carries the pick; the panel only says what a checklist is.
    expect(textOf(card)).toContain('No Checklist Yet');
    expect(textOf(card)).toContain('A checklist lists the papers');
    expect(card).not.toContain('Add Evidence');
    expect(card).not.toContain('Pick a Checklist');
    expect(card).not.toContain('no reviewed checklist');
  });

  it('folds nothing that hides a single row', async () => {
    setUp({ requirements: ['CRITICAL_GAP', 'CRITICAL_GAP', 'CRITICAL_GAP', 'CRITICAL_GAP'] });
    const four = await render();
    expect(four).not.toContain('case-checklist-rest');
    setUp({ requirements: Array.from({ length: 5 }, () => 'CRITICAL_GAP') });
    const five = await render();
    expect(textOf(five)).toContain('2 More Items');
  });

  it('keeps the necessity dot out of the way on a phone but in the words', async () => {
    setUp({ requirements: ['CRITICAL_GAP'] });
    mocks.computeReadiness.mockResolvedValue(
      ok({
        overallState: 'NEEDS_ACTION',
        requirementResults: [
          {
            packRequirementId: 'req-0',
            kind: 'DOCUMENT',
            key: 'bank_statement',
            optional: false,
            state: 'CRITICAL_GAP',
            necessity: 'MANDATORY',
          },
        ],
        requiredCount: 1,
        satisfiedRequired: 0,
      }),
    );
    const html = await render();
    expect(html).toContain('<span class="lift-check-dot" aria-hidden="true">· </span>Mandatory');
    // In the words the dot is still there, so the line reads "Bank Statement · Mandatory".
    expect(textOf(html)).toContain('Bank Statement · Mandatory');
  });

  it('shows the traveller confirmation beside the card, not as a second summary', async () => {
    setUp({ requirements: ['SATISFIED'] });
    const text = textOf(await render());
    expect(text).toContain('Traveller confirmation: Awaiting confirmation');
    expect(text.match(/Traveller confirmation/g)).toHaveLength(1);
  });

  it('gives each open row one action and no arrow, and finished rows one line', async () => {
    setUp({ requirements: ['CRITICAL_GAP', 'EXPIRING_STALE', 'UNVERIFIED', 'SATISFIED'] });
    const html = await render();
    const rows = html.split('class="row lift-check ').slice(1);
    expect(rows).toHaveLength(4);
    const withAction = rows.filter((row) => row.includes('lift-check-action'));
    // The missing and the out-of-date rows have the action; the one to confirm and the done one do not.
    expect(withAction).toHaveLength(2);
    for (const row of withAction) {
      expect(row.match(/lift-check-action/g)).toHaveLength(1);
      expect(row).toContain('>Provide Evidence</a>');
    }
    expect(html).not.toContain('Provide Evidence ↓');
    expect(html).not.toContain('Provide Evidence ↓'.replace('↓', '&#x2193;'));
    // A finished row is compact: the icon, the name and the pill, with its details folded.
    const done = rows.filter((row) => row.includes('lift-check-compact'));
    expect(done).toHaveLength(1);
    expect(done[0]).toContain('On File');
    expect(done[0]).toContain('More About This Item');
  });

  it('folds the source and every other detail under More About This Item', async () => {
    setUp({ requirements: ['CRITICAL_GAP'] });
    mocks.listRequirements.mockResolvedValue([
      {
        id: 'req-0',
        citation: 'rule',
        sourceInaccessibleAt: null,
        sourceTitle: 'Synthetic Page',
        sourceUrl: 'https://example.test/page',
        publisher: 'Synthetic Authority',
        observedDate: null,
      },
    ]);
    const html = await render();
    const row = html.slice(
      html.indexOf('lift-row-more'),
      html.indexOf('</details>', html.indexOf('lift-row-more')),
    );
    expect(textOf(row)).toContain('Source: Synthetic Authority · Synthetic Page');
    expect(row).toContain('href="https://example.test/page"');
    expect(textOf(row)).toContain('Suggest a Correction');
  });

  it('keeps the earlier stages unmarked: only the current stage is filled', async () => {
    setUp({ requirements: ['SATISFIED'] });
    const html = await render();
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(textOf(html)).toMatch(/Stage 2 of \d+/);
    expect(html).not.toContain('lift-step-done');
  });
});
