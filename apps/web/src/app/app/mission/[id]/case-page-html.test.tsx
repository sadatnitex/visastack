import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderServer } from '../../../../lib/next-mocks.test-support';

/**
 * The REAL case page with worst-case made-up data (a 60-item checklist, 120 tasks, 80 notes, 60
 * complaints, 60 feedback notes, 60 snapshots, document choices), rendered by the page component
 * itself with only the data reads replaced. It renders here to prove the whole page builds from
 * that data, and when CASE_PAGE_HTML_OUT is set it writes the markup to that file: the scroll
 * budget check (e2e/scroll-budget/WP-SB2.spec.ts) loads that file in a browser with the real
 * stylesheet and measures the page a person gets, not a stand-in for it.
 */

const ok = <T,>(value: T) => ({ ok: true as const, value });

/** A variable-keyed read keeps the strict index-signature rules happy. */
const OUT_VARIABLE = 'CASE_PAGE_HTML_OUT';
const readEnv = (name: string): string | undefined => process.env[name];

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
  listRequirementDetails: vi.fn(),
  latestSourceChecks: vi.fn(),
  caseExpiryConflicts: vi.fn(),
  getCasePackage: vi.fn(),
  listSelectedEvidence: vi.fn(),
  listSubmissionsForMission: vi.fn(),
  listTasks: vi.fn(),
  listChangesSinceConfirmed: vi.fn(),
  listFittingPublicPacks: vi.fn(),
  listFittingStarterPacks: vi.fn(),
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

const { default: MissionPage } = await import('./page');

const CASE_ID = '00000000-0000-4000-8000-0000000000c1';
const PERSON_ID = '10000000-0000-4000-8000-000000000002';
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

const STATES = [
  'SATISFIED',
  'SATISFIED',
  'SATISFIED',
  'CRITICAL_GAP',
  'EXPIRING_STALE',
  'UNVERIFIED',
  'NOT_APPLICABLE',
] as const;
const CATEGORIES = [
  'IDENTITY_TRAVEL_DOCUMENTS',
  'FINANCIAL_MEANS',
  'EMPLOYMENT_BUSINESS',
  'JOURNEY_ITINERARY',
  'FORMS_PROCEDURES',
] as const;
const ITEMS = 60;

const everyRequirement = Array.from({ length: ITEMS }, (_, i) => ({
  id: `req-${i}`,
  kind: i % 5 === 0 ? ('FIELD' as const) : ('DOCUMENT' as const),
  key: i % 5 === 0 ? 'full_name' : 'bank_statement',
  state: STATES[i % STATES.length] ?? 'SATISFIED',
  category: CATEGORIES[i % CATEGORIES.length] ?? null,
  optional: i % 9 === 8,
}));

/** A starter list holds about this many lines (the Japan list has 19). */
const STARTER_ITEMS = 19;
/** The requirements of the case under test: the worst case, or a starter-sized list. */
let requirements = everyRequirement;

/** The case's trip package for the same checklist: one item per applicable requirement, each with a copy. */
function casePackage() {
  const copy = {
    kind: 'DOCUMENT' as const,
    documentId: 'doc-1',
    documentVersionId: 'dv-1',
    factId: null,
    factVersionId: null,
    displayName: 'Specimen bank statement',
    documentDate: '2026-10-01',
    usable: true,
    tooOld: false,
    conflicting: false,
  };
  return {
    missionId: CASE_ID,
    phrase: 'NEEDS_ATTENTION' as const,
    reasons: ['REQUIRED_GAP' as const],
    overallState: 'NEEDS_ACTION' as const,
    requiredCount: requirements.filter((r) => !r.optional).length,
    satisfiedRequired: requirements.filter((r) => r.state === 'SATISFIED').length,
    items: requirements
      .filter((r) => r.state !== 'NOT_APPLICABLE')
      .map((r) => ({
        packRequirementId: r.id,
        kind: r.kind,
        key: r.key,
        citation: 'Bank statement for the last 6 months, stamped by the bank',
        necessity: 'MANDATORY' as const,
        provenance: 'OFFICIAL' as const,
        groupKey: null,
        state: r.state,
        blocking: !r.optional,
        proposed: r.kind === 'DOCUMENT' ? copy : null,
        chosen: null,
        alternatives: [],
        newerCopy: null,
        canExclude: r.optional,
      })),
    questions: [],
    freshness: null,
    outsideSteps: [
      {
        kind: 'APPLICATION_FORM' as const,
        label: 'Fill in the official application form',
        namedByChecklist: false,
      },
    ],
    latestHandoff: null,
    change: null,
    available: true,
    active: true,
  };
}

/** The first `limit` of `total` rows, as a capped read answers. */
const page = <T,>(total: number, limit: number | undefined, row: (i: number) => T) =>
  Array.from({ length: Math.min(total, limit ?? total) }, (_, i) => row(i));

function setUp(count = ITEMS, purpose: string | null = null) {
  requirements = everyRequirement.slice(0, count);
  mocks.getMissionForOwner.mockResolvedValue(
    ok({
      id: CASE_ID,
      applicantId: PERSON_ID,
      title: 'Japan visitor visa',
      destination: 'Japan',
      purpose,
      jurisdiction: 'Japan Visa Application Centre, Dhaka',
      serviceCategory: 'Tourist visa',
      state: 'IN_PROGRESS',
      packVersionId: 'pv-1',
      itineraryRef: 'Rahman Family Japan 2027',
      manualMode: false,
      travelStartDate: new Date('2027-03-14T00:00:00Z'),
      travelEndDate: new Date('2027-03-28T00:00:00Z'),
      targetDeadline: new Date('2027-01-20T00:00:00Z'),
      createdAt: daysAgo(30),
      updatedAt: daysAgo(1),
    }),
  );
  mocks.computeTripChecks.mockResolvedValue([
    {
      key: 'passport_validity',
      level: 'ok',
      title: 'Passport validity',
      detail: 'Your passport is valid for more than 6 months after your trip ends.',
    },
    {
      key: 'insurance_cover',
      level: 'check',
      title: 'Travel insurance cover',
      detail: 'No travel insurance is on your profile for these dates.',
    },
  ]);
  const results = requirements.map((r) => ({
    packRequirementId: r.id,
    kind: r.kind,
    key: r.key,
    optional: r.optional,
    state: r.state,
    necessity: 'MANDATORY',
    provenance: 'OFFICIAL',
  }));
  mocks.computeReadiness.mockResolvedValue(
    ok({
      overallState: 'NEEDS_ACTION',
      requirementResults: results,
      requiredCount: results.filter((r) => !r.optional).length,
      satisfiedRequired: results.filter((r) => r.state === 'SATISFIED').length,
    }),
  );
  mocks.listRequirements.mockResolvedValue(
    requirements.map((r) => ({
      id: r.id,
      kind: r.kind,
      key: r.key,
      citation: 'Bank statement for the last 6 months, stamped by the bank',
      notes: null,
      maxAgeDays: null,
      sourceTitle: 'Temporary Visitor visa',
      sourceUrl: 'https://www.bd.emb-japan.go.jp/itpr_en/visa.html',
      publisher: 'Embassy of Japan in Bangladesh',
      observedDate: new Date('2026-09-18T00:00:00Z'),
      sourceInaccessibleAt: null,
    })),
  );
  mocks.listRequirementDetails.mockResolvedValue(
    new Map(
      requirements.map((r) => [
        r.id,
        {
          category: r.category,
          acceptedForm: null,
          translationNeeded: null,
          originalNeeded: null,
          statementPeriodMonths: null,
          validMonthsAfterTravel: null,
          effectiveSince: new Date('2026-07-01T00:00:00Z'),
        },
      ]),
    ),
  );
  mocks.latestSourceChecks.mockResolvedValue(
    new Map([['https://www.bd.emb-japan.go.jp/itpr_en/visa.html', daysAgo(3)]]),
  );
  mocks.caseExpiryConflicts.mockResolvedValue([]);
  // The Trip Package lists every applicable item again with its own choice form, so the worst case
  // must carry it: without it the budget never measured the longest block on the page.
  mocks.getCasePackage.mockResolvedValue(ok(casePackage()));
  mocks.getPackVersion.mockResolvedValue({
    packId: 'p1',
    version: 4,
    effectiveDate: new Date('2026-07-01T00:00:00Z'),
  });
  mocks.getPack.mockResolvedValue({
    name: 'Japan Temporary Visitor Visa (Tourism)',
    authoritative: true,
    ownerOrganizationId: null,
    route: 'Tourism',
    jurisdiction: 'Japan',
  });
  mocks.getLatestExplanationForRequirement.mockResolvedValue(undefined);
  mocks.getApplicant.mockResolvedValue({
    id: PERSON_ID,
    displayName: 'Karim Rahman',
    timezone: 'Asia/Dhaka',
  });
  for (const name of [
    'listGeneratedOutputs',
    'listAccessForApplicant',
    'listContributorRequests',
    'listAppointments',
    'listOutcomesForMission',
    'listSubmissionsForMission',
    'listSelectedEvidence',
  ] as const) {
    mocks[name].mockResolvedValue(ok([]));
  }
  mocks.getEvidenceCandidates.mockResolvedValue(
    ok(
      requirements
        .filter((r) => r.state === 'SATISFIED' || r.state === 'EXPIRING_STALE')
        .map((r) => ({
          packRequirementId: r.id,
          kind: r.kind,
          key: r.key,
          citation: 'Bank statement for the last 6 months',
          factCandidates: [],
          documentCandidates: [
            {
              documentId: `doc-${r.id}`,
              displayName: 'Specimen bank statement',
              eligible: true,
              staleness: { status: 'FRESH' },
            },
          ],
          selectedFactIds: [],
          selectedDocumentIds: [],
        })),
    ),
  );
  mocks.listMissionSnapshots.mockImplementation(
    async (_db: unknown, _account: unknown, _id: unknown, o?: { limit?: number }) =>
      ok({
        items: page(60, o?.limit, (i) => ({
          id: `snap-${i}`,
          version: 60 - i,
          createdAt: daysAgo(i + 1),
          content: {},
          checksum: `a1b2c3d4e5f60718293a4b5c6d7e8f${String(i).padStart(2, '0')}`,
        })),
        nextCursor: 'more',
      }),
  );
  mocks.listComplaintsForMission.mockImplementation(
    async (_db: unknown, _account: unknown, _id: unknown, o?: { limit?: number }) =>
      ok({
        items: page(60, o?.limit, (i) => ({
          id: `complaint-${i}`,
          description: `Complaint ${i}`,
          status: 'OPEN',
          createdAt: daysAgo(i + 1),
        })),
        total: 60,
      }),
  );
  mocks.listFeedbackForMission.mockImplementation(
    async (_db: unknown, _account: unknown, _id: unknown, o?: { limit?: number }) =>
      ok({
        items: page(60, o?.limit, (i) => ({
          id: `feedback-${i}`,
          body: `Feedback ${i}`,
          createdAt: daysAgo(i + 1),
        })),
        total: 60,
      }),
  );
  mocks.listSelectablePackVersions.mockResolvedValue(ok([]));
  mocks.explainNoFittingPack.mockResolvedValue([]);
  mocks.listFittingPublicPacks.mockResolvedValue([]);
  mocks.listFittingStarterPacks.mockResolvedValue([]);
  mocks.readTravellerCoverage.mockResolvedValue({ nationality: ['Bangladeshi'], residence: [] });
  mocks.listMissionsByItineraryRef.mockResolvedValue([
    { id: 'case-2', title: 'Japan visitor visa', applicantName: 'Amina Rahman' },
  ]);
  mocks.listNotesForOwner.mockImplementation(
    async (_db: unknown, _account: unknown, _id: unknown, o?: { limit?: number }) => ({
      items: page(80, o?.limit, (i) => ({
        id: `note-${i}`,
        body: `Please bring the original document for item ${i}.`,
        authorEmail: 'agent@example.test',
        createdAt: daysAgo(i + 1),
      })),
      total: 80,
    }),
  );
  mocks.listTasks.mockImplementation(
    async (_db: unknown, _account: unknown, _id: unknown, o?: { limit?: number }) =>
      ok({
        items: page(120, o?.limit, (i) => ({
          id: `task-${i}`,
          description: `Task ${i}: collect a document`,
          status: 'OPEN',
          priority: 'NORMAL',
          dueDate: new Date(Date.now() + (i + 3) * DAY),
          dueTimezone: 'Asia/Dhaka',
          addedBy: null,
        })),
        total: 120,
        open: 120,
      }),
  );
  mocks.requireAccess.mockResolvedValue(ok({ synthetic: 'proof' }));
  mocks.listChangesSinceConfirmed.mockResolvedValue(ok(null));
  mocks.getLiveAcknowledgement.mockResolvedValue(undefined);
  mocks.listAcknowledgementsForMission.mockResolvedValue(ok([]));
}

const applicable = (count: number) =>
  everyRequirement.slice(0, count).filter((r) => r.state !== 'NOT_APPLICABLE').length;

describe('the real case page with worst-case data', () => {
  it('renders every part of the page from it, and writes the markup for the scroll budget check', async () => {
    setUp();
    const html = await renderServer(
      await MissionPage({
        params: Promise.resolve({ id: CASE_ID }),
        searchParams: Promise.resolve({}),
      }),
    );
    // The whole page is there: the status panel, the checklist, the rail, the More card, the bar.
    expect(html).toContain('Japan visitor visa');
    expect(html).toContain('Evidence Checklist');
    expect(html).toContain('More for This Case');
    expect(html).toContain('Trip Date Checks');
    expect(html).toContain('Sources for This Checklist');
    expect(html).toContain('case-sticky-next');
    // The capped lists show their first rows, not all of them.
    expect((html.match(/id="case-task-/g) ?? []).length).toBe(10);
    expect((html.match(/id="case-note-/g) ?? []).length).toBe(10);
    // The Trip Package is on the page, and every item has a panel (with its package choice) the
    // list opens, so the budget measures the page a person gets with all of them in it.
    expect(html).toContain('Trip Package');
    expect((html.match(/data-pattern="detail-pane"/g) ?? []).length).toBe(ITEMS);
    expect((html.match(/class="package-choice-form"/g) ?? []).length).toBe(applicable(ITEMS));
    // The package no longer lists its items a second time.
    expect(html).not.toContain('class="package-item"');
    const out = readEnv(OUT_VARIABLE);
    if (out) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, html);
    }
  });

  it('draws the purpose picture in front of the purpose word in the header, hidden from readers', async () => {
    setUp(STARTER_ITEMS, 'Medical Treatment');
    const html = await renderServer(
      await MissionPage({
        params: Promise.resolve({ id: CASE_ID }),
        searchParams: Promise.resolve({}),
      }),
    );
    const header = html.slice(html.indexOf('Japan visitor visa'));
    const picture = header.match(
      /<span class="country-flag-purpose"><span class="mark-tile"[^>]*>/,
    )?.[0];
    expect(picture).toContain('data-mark="tripMedical"');
    expect(picture).toContain('aria-hidden="true"');
    expect(header).toMatch(/country-flag-purpose.*?<\/span><\/span>Medical Treatment/);
  });

  it('shows the purpose word but no picture for words the picker does not offer', async () => {
    setUp(STARTER_ITEMS, 'Seeing my cousin');
    const html = await renderServer(
      await MissionPage({
        params: Promise.resolve({ id: CASE_ID }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(html).toContain('Seeing my cousin');
    expect(html).not.toContain('country-flag-purpose');
  });

  it('draws a starter-sized list with its package, so the totals are checked at the size people get', async () => {
    setUp(STARTER_ITEMS);
    const html = await renderServer(
      await MissionPage({
        params: Promise.resolve({ id: CASE_ID }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(html).toContain('Evidence Checklist');
    expect((html.match(/data-pattern="detail-pane"/g) ?? []).length).toBe(STARTER_ITEMS);
    expect((html.match(/class="package-choice-form"/g) ?? []).length).toBe(
      applicable(STARTER_ITEMS),
    );
    // Every checklist row is on the page once, whatever folder holds it.
    expect((html.match(/data-pattern="list-row"/g) ?? []).length).toBe(STARTER_ITEMS);
  });
});
