import type { TripCheck } from '@visastack/core';
import type {
  AttemptView,
  CasePackage,
  ChangesSinceConfirmed,
  Mission,
  OutcomeAttemptsView,
  PackageItem,
} from '@visastack/services';
import { JSDOM } from 'jsdom';
import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectEveryLiveMessageRendered } from '../../applicant/[id]/bn-coverage.test-support';

// The case screen's server-drawn parts (and its snapshot and Start a Trip pages) under Bengali, one
// visible state at a time, so that every live Bengali message of these parts has a test that shows it.
vi.mock('@visastack/i18n', async (original) =>
  (await import('../../applicant/[id]/bn-coverage.test-support')).trackBengali(await original()),
);
const loc = vi.hoisted(() => ({ locale: 'bn' as 'en' | 'bn', holder: null as unknown }));
// The locale is set here directly, as the language switch would set it.
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => loc.locale }));
vi.mock('server-only', () => ({}));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    loc.holder ??= build();
    return loc.holder;
  },
}));
const services = vi.hoisted(() => ({
  getMissionForOwner: vi.fn(),
  getMissionSnapshot: vi.fn(),
  listAcknowledgementsForMission: vi.fn(),
  listMissionSnapshots: vi.fn(),
  listApplicants: vi.fn(),
  tripTablesReady: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...services,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'synthetic-owner' }),
}));
const done = vi.hoisted(() => async () => ({ ok: true, message: '' }));
vi.mock('./actions', () => ({
  attachPackAction: done,
  transitionMissionAction: done,
  deleteCancelledCaseAction: done,
  snapshotMissionAction: done,
  selectEvidenceAction: done,
  unselectEvidenceAction: done,
  createTaskAction: done,
  decideTaskAction: done,
  createAppointmentAction: done,
  decideAppointmentAction: done,
  setItineraryRefAction: done,
  updateCaseDetailsAction: done,
  createContributorRequestAction: done,
  revokeContributorRequestAction: done,
  recordOutcomeAction: done,
  recordSubmissionAction: done,
  fileComplaintAction: done,
  withdrawComplaintAction: done,
  submitFeedbackAction: done,
  generateLetterAction: done,
  explainReadinessGapAction: done,
}));
vi.mock('./attempt-actions', () => ({
  trackReportAsAttemptAction: done,
  recordAttemptAction: done,
  recordAttemptEventAction: done,
}));
vi.mock('./package-actions', () => ({
  recordPackageChoiceAction: done,
  markPackageChangeReviewedAction: done,
  confirmPackageHandoffAction: done,
}));
vi.mock('./edits-actions', () => ({ saveWordingAction: done }));
vi.mock('./suggest-correction-actions', () => ({ suggestCaseCorrectionAction: done }));
vi.mock('./snapshots/[snapshotId]/actions', () => ({ decideAcknowledgementAction: done }));
vi.mock('../start/actions', () => ({ startTripAction: done }));
// The case's own panels are drawn under Bengali in case-forms-locale.test.tsx.
vi.mock('./collaboration-panels', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return {
    AppointmentsPanel: stub('AppointmentsPanel'),
    EvidenceItemChoices: stub('EvidenceItemChoices'),
    EvidenceSelectionPanel: stub('EvidenceSelectionPanel'),
    LettersPanel: stub('LettersPanel'),
    TasksPanel: stub('TasksPanel'),
  };
});

const { I18nProvider } = await import('../../../../components/i18n-provider');
const { appMissionCatalog } = await import('../../../../i18n/app-mission');
const { primeLocale } = await import('../../../../lib/i18n-server');
const { AttemptPanel } = await import('./attempt-panel');
const { CaseChecklist, CaseExpiringDocuments, CaseSources } = await import('./case-checklist');
const { CaseItemPane } = await import('./case-item-pane');
const { CaseMobileBar } = await import('./case-mobile-bar');
const { CaseRail } = await import('./case-rail');
const { CaseSecondary } = await import('./case-secondary');
const { CaseNoChecklistSummary } = await import('./case-status-panel');
const { ChangesSinceConfirmedList } = await import('./changes-since-confirmed');
const { PackagePanel } = await import('./package-panel');
const { TripChecksPanel } = await import('./trip-checks-panel');
const { default: SnapshotsPage } = await import('./snapshots/page');
const { default: SnapshotPage } = await import('./snapshots/[snapshotId]/page');
const { default: TripStartPage } = await import('../start/page');

const bn = appMissionCatalog.bn as Record<string, string>;
const en = appMissionCatalog.en as Record<string, string>;
const P = 'appMission.appMissionId';
const RAW_KEY = /appMission\.app[A-Z]/;
const MISSION = '00000000-0000-4000-8000-000000000101';
const ok = <T,>(value: T) => ({ ok: true as const, value });

let page: Document;
/** Draws a server part (or a page) as one Bengali request does, with the client parts inside. */
async function draw(node: ReactNode | Promise<ReactNode>) {
  loc.holder = null;
  loc.locale = 'bn';
  await primeLocale();
  const html = renderToStaticMarkup(
    <I18nProvider locale="bn" pageLang="bn">
      {await node}
    </I18nProvider>,
  );
  page = new JSDOM(`<body>${html}</body>`).window.document;
  return page;
}
const words = () => (page.body.textContent ?? '').replace(/\s+/g, ' ');
/** What a reader meets: the words on screen plus every attribute (names, hints, placeholders). */
const seen = () =>
  [
    words(),
    ...[...page.body.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.value)),
  ].join('\n');
const full = (key: string) => (key.startsWith('appMission.') ? key : `${P}${key}`);
/**
 * Each key's Bengali is on screen, and its English sentence is not (a short English word such as
 * "Case" or a tab name also appears in English elsewhere on the page, so only sentences are checked
 * for absence).
 */
const expectBengali = (...keys: string[]) => {
  const text = seen();
  for (const key of keys.map(full)) {
    expect(bn[key], key).toBeTruthy();
    expect(text, key).toContain(bn[key]);
    if ((en[key] ?? '').length >= 30) expect(words(), key).not.toContain(en[key]);
  }
  expect(text).not.toMatch(RAW_KEY);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the attempts card under Bengali', () => {
  const base: AttemptView = {
    id: '00000000-0000-4000-8000-0000000000a1',
    attemptNo: 1,
    binding: 'PACKAGE_HANDOFF',
    packName: 'Synthetic Visitor',
    packVersion: 3,
    packChecksum: 'c'.repeat(64),
    selectedDocuments: 4,
    selectedDetails: 9,
    channel: 'VISA_APPLICATION_CENTER',
    submittedOn: '2026-10-02',
    fromSubmissionReport: true,
    documentSupplied: false,
    receipt: 'NONE',
    standing: { kind: 'UNKNOWN' },
    events: [],
  };
  const card = (view: Partial<OutcomeAttemptsView>) =>
    draw(
      <AttemptPanel
        missionId={MISSION}
        today="2026-11-03"
        documentKinds={[{ value: 'BANK_STATEMENT', label: 'Bank Statement' }]}
        view={{ available: true, attempts: [], evidenceChoices: [], untrackedReports: [], ...view }}
      />,
    );

  it('says attempts are coming when the attempt tables are not there yet', async () => {
    await card({ available: false });
    expectBengali(
      'AttemptPanel.afterSubmission',
      'AttemptPanel.applicationAttempts',
      'AttemptPanel.attemptsCanBeRecordedHereSoon',
    );
  });

  it('says nothing is recorded yet before the first submission', async () => {
    await card({});
    expectBengali('AttemptPanel.nothingRecordedYetReportTheSubmission');
  });

  it('numbers each attempt, names an unlisted decision and an unknown office, and offers another', async () => {
    await card({
      attempts: [
        {
          ...base,
          standing: {
            kind: 'DECIDED',
            decision: 'SOMETHING_ELSE',
            occurredOn: '2026-10-20',
            documentSupplied: true,
          },
        } as AttemptView,
        {
          ...base,
          id: '00000000-0000-4000-8000-0000000000a2',
          attemptNo: 2,
          events: [
            {
              id: 'e1',
              kind: 'AUTHORITY_REQUEST',
              decision: null,
              requestSource: null,
              requestedDocTypes: ['BANK_STATEMENT'],
              occurredOn: '2026-10-25',
              documentSupplied: false,
            },
            {
              id: 'e2',
              kind: 'DECISION',
              decision: 'SOMETHING_ELSE',
              requestSource: null,
              requestedDocTypes: [],
              occurredOn: '2026-10-28',
              documentSupplied: false,
            },
          ],
        } as AttemptView,
      ],
    });
    expect(words()).toContain('প্রচেষ্টা ১');
    expect(words()).toContain('প্রচেষ্টা ২');
    expectBengali(
      'AttemptPanel.otherDecision',
      'AttemptPanel.noDecisionRecorded',
      'AttemptPanel.officialOffice',
      'AttemptForms.decision',
      'AttemptPanel.addWhatHappened',
      'AttemptPanel.recordAnotherAttempt',
      'AttemptPanel.forAResubmissionANewApplication',
    );
    // The decision line carries an English date and an English basis, so it stays English.
    expect(words()).toContain('Decision on Oct 20, 2026: Document Attached.');
  });
});

describe('the checklist, its sources and expiring documents under Bengali', () => {
  it('names the checklist and where it came from', async () => {
    await draw(
      <CaseChecklist
        applicantId="person-1"
        rows={[]}
        packName="Japan Temporary Visitor Visa"
        itemHref={(id) => `#${id}`}
      />,
    );
    expectBengali('CaseChecklist.evidenceChecklist');
    expect(words()).toContain('Japan Temporary Visitor Visa থেকে');
  });

  it('lists the documents that expire before the trip ends and the checklist sources', async () => {
    await draw(
      <>
        <CaseExpiringDocuments
          documents={[
            {
              documentId: 'd1',
              name: 'Passport',
              expiresAt: '2027-03-20',
              neededUntil: '2027-03-28',
            },
          ]}
        />
        <CaseSources
          sources={[
            {
              href: 'https://example.test/rules',
              name: 'Embassy of Japan',
              checkedAt: '2026-11-01',
              inEffectSince: null,
            },
          ]}
        />
      </>,
    );
    expectBengali(
      'CaseChecklist.documentsThatExpireBeforeYourTrip',
      'CaseChecklist.sourcesForThisChecklist',
    );
  });
});

describe('the item panel under Bengali', () => {
  const ID = '30000000-0000-4000-8000-000000000001';
  const row = (over: Record<string, unknown> = {}) =>
    ({
      packRequirementId: ID,
      kind: 'DOCUMENT',
      key: 'PASSPORT',
      optional: false,
      state: 'CRITICAL_GAP',
      citation: 'Synthetic rule',
      sourceTitle: null,
      sourceUrl: null,
      publisher: null,
      observedDate: null,
      sourceInaccessible: false,
      category: null,
      necessity: 'MANDATORY',
      ...over,
    }) as ComponentProps<typeof CaseItemPane>['row'];
  const copy = {
    kind: 'DOCUMENT' as const,
    documentId: 'd1',
    documentVersionId: '00000000-0000-4000-8000-0000000000a1',
    factId: null,
    factVersionId: null,
    displayName: 'Passport Scan',
    documentDate: '2026-10-01',
    usable: true,
    tooOld: false,
    conflicting: false,
  };
  const item: PackageItem = {
    packRequirementId: ID,
    kind: 'DOCUMENT',
    key: 'PASSPORT',
    citation: 'Synthetic rule',
    necessity: 'MANDATORY',
    provenance: 'OFFICIAL',
    groupKey: null,
    state: 'SATISFIED',
    blocking: true,
    proposed: copy,
    chosen: null,
    alternatives: [],
    newerCopy: null,
    canExclude: true,
  };
  const pane = (over: Partial<ComponentProps<typeof CaseItemPane>>, r = row()) =>
    draw(
      <CaseItemPane
        missionId={MISSION}
        applicantId="10000000-0000-4000-8000-000000000001"
        row={r}
        rows={[r]}
        chosen={undefined}
        formatLines={undefined}
        candidate={undefined}
        evidenceEditable
        packageItem={undefined}
        packageEditable={false}
        explanations={{ configured: false, off: undefined, byRequirement: new Map() }}
        wordingEditable={false}
        wordingMax={400}
        selfReviewed
        {...over}
      />,
    );

  it('shows a missing item, your own wording, its source and the document chosen for it', async () => {
    await pane(
      { chosen: ['Passport Scan'] },
      row({
        myWording: 'My passport',
        sourceInaccessible: true,
        sourceUrl: 'https://example.test/rules',
        publisher: 'Embassy of Japan',
      }),
    );
    expectBengali(
      'CaseItemPane.yourWording',
      'CaseItemPane.sourceCurrentlyUnreachableUnderReview',
      'CaseItemPane.viewSource',
      'CaseItemPane.provideEvidence',
    );
    expect(words()).toContain('মূল: Passport');
    expect(words()).toContain('বেছে নেওয়া ডকুমেন্ট: Passport Scan');
  });

  it('calls an item with no name unnamed', async () => {
    await pane({}, row({ kind: 'FIELD', key: '' }));
    expectBengali('CaseItemPane.unnamed');
  });

  it('asks which of several files counts, and which goes in the handoff', async () => {
    const doc = { eligible: true, staleness: 'fresh' as const };
    await pane(
      {
        candidate: {
          packRequirementId: ID,
          kind: 'DOCUMENT',
          label: 'Passport',
          citation: 'rule',
          factCandidates: [],
          documentCandidates: [
            { ...doc, documentId: 'd1', displayName: 'Old passport' },
            { ...doc, documentId: 'd2', displayName: 'New passport' },
          ],
          selectedFactIds: [],
          selectedDocumentIds: [],
          selectionIdsByCandidate: {},
        },
        packageItem: {
          ...item,
          chosen: {
            choice: 'COPY',
            copy: { ...copy, usable: false },
            reason: null,
            chosenAt: '2026-11-01T08:00:00.000Z',
          },
          newerCopy: { ...copy, displayName: 'Passport Scan 2' },
        } as PackageItem,
      },
      row({ state: 'SATISFIED' }),
    );
    expectBengali(
      'CaseItemPane.whichFileCounts',
      'CaseItemPane.severalAreOnFileUntilYou',
      'CaseItemPane.whichFileGoesInTheHandoff',
      'CaseItemPane.theChosenCopyCanNoLonger',
    );
    // It names the newer copy by its English name and an unformatted date, so it stays English.
    expect(words()).toContain('A newer copy is available: Passport Scan 2 (2026-10-01).');
  });
});

describe('the phone bar, the no-checklist summary and the changes alert under Bengali', () => {
  it('counts the items on file in Bengali digits in the phone bar', async () => {
    await draw(
      <CaseMobileBar
        nextStep={{
          kind: 'missing',
          label: 'required items to fix',
          href: '#readiness',
          count: 4,
          tone: 'danger',
          opens: 'case-checklist-needs-you',
        }}
        progress={{ done: 6, total: 12 }}
      />,
    );
    expect(page.querySelector('.lift-bar-count')?.textContent).toBe('১২টির মধ্যে ৬টি');
    expectBengali('CaseMobileBar.nextStep', 'CaseMobileBar.requiredItemsOnFile');
  });

  it('asks why there is no checklist when none fits, and what one is otherwise', async () => {
    await draw(
      <CaseNoChecklistSummary
        packOptionCount={0}
        noChecklistLine="No published checklist covers this route yet."
        welcomeShown={false}
      />,
    );
    expectBengali('CaseStatusPanel.noChecklistYet', 'CaseStatusPanel.whyIsThereNoChecklist');
    await draw(<CaseNoChecklistSummary packOptionCount={2} noChecklistLine={null} welcomeShown />);
    expectBengali('CaseStatusPanel.whatIsAChecklist');
  });

  const changes = (over: Partial<ChangesSinceConfirmed>, exact = true) =>
    ({
      snapshot: {
        id: 'snap-1',
        missionId: MISSION,
        missionTitle: 'Japan visa',
        version: 2,
        takenAt: '2026-11-01T08:00:00.000Z',
        exact,
      },
      review: {},
      changes: [],
      unchangedDetailCount: 0,
      confirmedAt: '2026-11-01T08:00:00.000Z',
      ...over,
    }) as unknown as ChangesSinceConfirmed;

  it('says an older snapshot cannot list its changes, and when nothing listed differs', async () => {
    await draw(<ChangesSinceConfirmedList applicantId="person-1" changes={changes({}, false)} />);
    expectBengali('ChangesSinceConfirmed.thisOlderSnapshotDidNotRecord');
    await draw(<ChangesSinceConfirmedList applicantId="person-1" changes={changes({})} />);
    expectBengali(
      'ChangesSinceConfirmed.noDetailDocumentOrCaseDate',
      'ChangesSinceConfirmed.seeWhatChanged',
    );
  });

  it('counts every change when more than the alert shows', async () => {
    const added = Array.from({ length: 10 }, (_, i) => ({
      kind: 'detail',
      change: 'added',
      fieldKey: 'given_name',
      repeatingRecordKey: null,
      factId: `fact-${i}`,
      priorFactVersionId: null,
      currentFactVersionId: `version-${i}`,
    }));
    await draw(
      <ChangesSinceConfirmedList
        applicantId="person-1"
        changes={changes({ changes: added as never })}
      />,
    );
    expect(page.querySelector('.case-changes-all')?.textContent).toBe('সব ১০টি পরিবর্তন দেখুন');
  });
});

describe('the trip package under Bengali', () => {
  const passport: PackageItem = {
    packRequirementId: '00000000-0000-4000-8000-000000000001',
    kind: 'DOCUMENT',
    key: 'passport',
    citation: 'Synthetic rule 1',
    necessity: 'MANDATORY',
    provenance: 'OFFICIAL',
    groupKey: null,
    state: 'SATISFIED',
    blocking: true,
    proposed: null,
    chosen: null,
    alternatives: [],
    newerCopy: null,
    canExclude: false,
  };
  const pkg = (over: Partial<CasePackage> = {}): CasePackage => ({
    missionId: MISSION,
    phrase: 'READY_FOR_FINAL_REVIEW',
    reasons: [],
    overallState: 'READY_FOR_APPLICANT_REVIEW',
    requiredCount: 1,
    satisfiedRequired: 1,
    items: [passport],
    questions: [],
    freshness: null,
    outsideSteps: [
      {
        kind: 'APPLICATION_FORM',
        label: 'Fill in and send the official application form yourself.',
        namedByChecklist: false,
      },
    ],
    latestHandoff: null,
    change: null,
    available: true,
    active: true,
    ...over,
  });

  it('asks its questions, lists an item without a checklist row and warns about freshness', async () => {
    await draw(
      <PackagePanel
        listedIds={new Set(['someone-else'])}
        pkg={pkg({
          questions: [
            { kind: 'TRAVEL_DATES', fieldKey: null },
            { kind: 'FACT', fieldKey: 'given_name' },
          ] as CasePackage['questions'],
          freshness: { caveats: ['CHECKLIST_REPLACED'] } as unknown as CasePackage['freshness'],
        })}
      />,
    );
    expectBengali(
      'PackagePanel.tripPackage',
      'PackagePanel.thisShowsWhatYouHaveReady',
      'PackagePanel.toChooseWhichFileAnItem',
      'PackagePanel.questionsForThisChecklist',
      'PackagePanel.addYourTravelDatesUnderEdit',
      'PackagePanel.otherItemsInThisPackage',
      'PackagePanel.freshnessCheck',
      'PackagePanel.outsideVisastack',
    );
    // The answer it asks for is named in English, so that line stays English.
    expect(words()).toContain('Add and confirm your Given Name in your profile.');
  });
});

describe('the trip date checks under Bengali', () => {
  it('says when the dates could not be checked, when none apply, and lists the ones that do', async () => {
    await draw(<TripChecksPanel checks={null} />);
    expectBengali(
      'TripChecksPanel.dates',
      'CaseRail.tripDateChecks',
      'TripChecksPanel.weCouldNotCheckYourDates',
      'TripChecksPanel.aboutTheseChecks',
      'TripChecksPanel.commonChecksOfYourTripDates',
    );
    await draw(<TripChecksPanel checks={[]} />);
    expectBengali('TripChecksPanel.noDateChecksApplyYet');
    const checks: readonly TripCheck[] = [
      { key: 'passport_validity', level: 'ok', title: 'Passport validity', detail: 'Fine.' },
    ];
    await draw(<TripChecksPanel checks={checks} />);
    expectBengali('TripChecksPanel.tripDateChecks');
  });
});

describe('the case rail under Bengali', () => {
  const mission = (extra: Record<string, unknown> = {}) =>
    ({
      id: MISSION,
      title: 'Japan visitor visa',
      state: 'IN_PROGRESS',
      jurisdiction: 'Japan Visa Application Centre, Dhaka',
      serviceCategory: 'Tourist visa',
      travelStartDate: new Date('2027-03-14T00:00:00Z'),
      travelEndDate: new Date('2027-03-28T00:00:00Z'),
      targetDeadline: null,
      packVersionId: 'pv-1',
      itineraryRef: null,
      manualMode: false,
      ...extra,
    }) as unknown as Mission;
  const rail = (extra: Record<string, unknown> = {}) =>
    draw(
      <CaseRail
        {...({
          mission: mission(),
          applicantId: 'person-1',
          packInfo: {
            name: 'Japan Temporary Visitor Visa (Tourism)',
            badge: 'Official Requirement Pack',
            reviewed: true,
            coverage: 'For travel to Japan · Tourism',
            notice: null,
            effectiveDate: null,
          },
          packOptions: [],
          noChecklistLines: [],
          primaryAttach: false,
          nextStates: ['READY_FOR_REVIEW', 'CANCELLED'],
          stageStates: ['READY_FOR_REVIEW'],
          snapshots: [
            {
              id: 'snap-1',
              version: 1,
              checksum: 'a1b2c3d4e5f60718',
              content: { state: 'LOCKED' },
            },
          ],
          moreSnapshots: true,
          linkedMissions: [],
          tripChecks: { view: 'checks', checks: [] },
          sources: [],
          ...extra,
        } as unknown as ComponentProps<typeof CaseRail>)}
      />,
    );

  it('shows the case details, its deadline, the checklist, a packet snapshot and the stages', async () => {
    await rail({ mission: mission({ targetDeadline: new Date('2027-02-01T00:00:00Z') }) });
    expectBengali(
      'CaseRail.aboutThisCase',
      'CaseRail.case',
      'CaseRail.caseDetails',
      'CaseRail.editCaseDetails',
      'CaseRail.requirements',
      'CaseRail.reviewed',
      'CaseRail.history',
      'CaseRail.snapshots',
      'CaseRail.applicationPacket',
      'CaseRail.seeAllSnapshots',
      'CaseRail.familyTrip',
      'CaseRail.itineraryReference',
      'CaseRail.anOptionalLabelLinkingThisCase',
      'CaseRail.linkToAFamilyTrip',
      'CaseRail.workflow',
      'CaseRail.advanceTheCase',
      'CaseRail.tripDateChecks',
    );
    expect(words()).toContain('লক্ষ্যমাত্রার শেষ তারিখ: ১ ফেব, ২০২৭');
  });

  it('offers a checklist to pick, with no snapshots and no further stage', async () => {
    await rail({
      mission: mission({ packVersionId: null }),
      packInfo: null,
      packOptions: [{ packVersionId: 'p1', label: 'Japan' }],
      snapshots: [],
      moreSnapshots: false,
      stageStates: [],
    });
    expectBengali(
      'CaseRail.pickAChecklistAttachAPublished',
      'CaseRail.noSnapshotsYetCaptureOneTo',
      'CaseRail.thereIsNoFurtherStageFrom',
    );
  });

  it('says a closed case has no checklist and is in a final state', async () => {
    await rail({
      mission: mission({ packVersionId: null, state: 'CANCELLED' }),
      packInfo: null,
      nextStates: [],
      stageStates: [],
    });
    expectBengali('CaseRail.noChecklistWasLinkedToThis', 'CaseRail.thisCaseIsInATerminal');
  });
});

describe('More for This Case under Bengali', () => {
  it('names its sections and says an agency note has no known author', async () => {
    const none = {
      tasks: false,
      notes: false,
      outcomes: false,
      complaints: false,
      feedback: false,
    };
    const noMore = { tasks: null, notes: null, outcomes: null, complaints: null, feedback: null };
    await draw(
      <CaseSecondary
        {...({
          missionId: MISSION,
          missionState: 'IN_PROGRESS',
          candidates: [],
          evidenceLifecycle: { byDocument: {} },
          selectionIdsByCandidate: {},
          tasks: [],
          finishedTaskTotal: 0,
          appointments: [],
          letters: [],
          contributorRequests: [],
          notes: [
            {
              id: 'n1',
              body: 'Bring the original bank letter.',
              authorEmail: null,
              createdAt: '2026-11-01T08:00:00.000Z',
            },
          ],
          submissions: [],
          outcomes: [],
          evidenceOptions: [],
          outcomeAttempts: null,
          attemptToday: '2026-11-04',
          complaints: [],
          feedback: [],
          canSubmitFeedback: true,
          expanded: none,
          more: noMore,
          notesLevel: 'browse',
        } as unknown as ComponentProps<typeof CaseSecondary>)}
      />,
    );
    expectBengali(
      'CaseSecondary.moreForThisCase',
      'CaseSecondary.sectionsOfThisCase',
      'CaseSecondary.delegate',
      'CaseSecondary.askAContributor',
      'CaseSecondary.askASponsorOrFamilyMember',
      'CaseSecondary.collaboration',
      'CaseSecondary.notesFromYourAgency',
      'CaseSecondary.notesAnAgencyWorkingThisCase',
      'CaseSecondary.unknown',
    );
    await draw(
      <CaseSecondary
        {...({
          missionId: MISSION,
          missionState: 'IN_PROGRESS',
          candidates: [],
          evidenceLifecycle: { byDocument: {} },
          selectionIdsByCandidate: {},
          tasks: [],
          finishedTaskTotal: 0,
          appointments: [],
          letters: [],
          contributorRequests: [],
          notes: [],
          submissions: [],
          outcomes: [],
          evidenceOptions: [],
          outcomeAttempts: null,
          attemptToday: '2026-11-04',
          complaints: [],
          feedback: [],
          canSubmitFeedback: true,
          expanded: none,
          more: noMore,
          notesLevel: 'browse',
        } as unknown as ComponentProps<typeof CaseSecondary>)}
      />,
    );
    expectBengali('CaseSecondary.noNotesSharedWithYouYet');
  });
});

describe('the snapshot pages under Bengali', () => {
  const snap = (version: number, state: string) => ({
    id: `snap-${version}`,
    version,
    checksum: 'abc',
    createdAt: new Date('2026-11-01T08:00:00Z'),
    content: { state },
  });

  it('lists the snapshots, marks a packet and pages to older ones', async () => {
    services.getMissionForOwner.mockResolvedValue(ok({ id: MISSION, title: 'Japan visa' }));
    services.listMissionSnapshots.mockResolvedValue(
      ok({ items: [snap(2, 'LOCKED'), snap(1, 'IN_PROGRESS')], nextCursor: 'older-cursor' }),
    );
    await draw(SnapshotsPage({ params: Promise.resolve({ id: MISSION }) }));
    expectBengali(
      'SnapshotsPage.case',
      'SnapshotsPage.allSnapshots',
      'SnapshotsPage.eachSnapshotKeepsExactlyWhatThis',
      'SnapshotsSnapshotidPage.applicationPacket',
      'SnapshotsPage.moreSnapshots',
      'SnapshotsPage.showOlderSnapshots',
    );
  });

  it('says when there are none, and when the oldest are shown', async () => {
    services.getMissionForOwner.mockResolvedValue(ok({ id: MISSION, title: 'Japan visa' }));
    services.listMissionSnapshots.mockResolvedValue(ok({ items: [], nextCursor: null }));
    await draw(SnapshotsPage({ params: Promise.resolve({ id: MISSION }) }));
    expectBengali('SnapshotsPage.noSnapshotsYetTakeOneFrom');
    await draw(
      SnapshotsPage({
        params: Promise.resolve({ id: MISSION }),
        searchParams: Promise.resolve({ before: 'some-cursor' }),
      }),
    );
    expectBengali(
      'SnapshotsPage.theseAreTheOldestSnapshotsOf',
      'SnapshotsPage.backToTheNewestSnapshots',
    );
  });

  const content = (state: string, rows: number, empty = false) => ({
    missionId: MISSION,
    state,
    packVersion: null,
    evidenceScope: 'case_selected',
    facts: empty
      ? []
      : Array.from({ length: 10 }, (_, i) => ({
          factId: `fact-${i}`,
          fieldKey: 'given_name',
          value: `Value ${i}`,
          repeatingRecordKey: null,
        })),
    documents: empty
      ? []
      : Array.from({ length: 9 }, (_, i) => ({
          documentId: `doc-${i}`,
          documentVersionId: `version-${i}`,
          docType: null,
          displayName: `Document ${i}`,
          sha256: null,
          eligible: true,
        })),
    requirementMapping: Array.from({ length: rows }, (_, i) => ({
      kind: i % 2 === 0 ? 'DOCUMENT' : 'FIELD',
      key: `requirement_${i}`,
      citation: 'rule',
      optional: false,
      satisfied: i === 0,
      ...(i % 2 === 0
        ? { documents: [{ documentId: 'd', displayName: 'Old', eligible: false }] }
        : { facts: [{ factId: 'f', value: 'Old', eligible: false }] }),
    })),
    readiness: null,
  });
  const open = () =>
    draw(SnapshotPage({ params: Promise.resolve({ id: MISSION, snapshotId: 'snap-1' }) }));

  it('shows a working snapshot with its requirements, facts and documents', async () => {
    services.getMissionForOwner.mockResolvedValue(ok({ id: MISSION, title: 'Japan visa' }));
    services.listAcknowledgementsForMission.mockResolvedValue(ok([]));
    services.getMissionSnapshot.mockResolvedValue(
      ok({ id: 'snap-1', version: 3, checksum: 'abc', content: content('IN_PROGRESS', 12) }),
    );
    await open();
    expectBengali(
      'SnapshotsSnapshotidPage.workingSnapshot',
      'SnapshotsSnapshotidPage.downloadJson',
      'SnapshotsSnapshotidPage.eachPackRequirementResolvedToThe',
      'SnapshotsSnapshotidPage.requirements',
      'SnapshotsSnapshotidPage.satisfied',
      'SnapshotsSnapshotidPage.notSatisfied',
      'SnapshotsSnapshotidPage.noEligibleDocument',
      'SnapshotsSnapshotidPage.noEligibleValue',
      'SnapshotsSnapshotidPage.facts',
      'SnapshotsSnapshotidPage.documents',
    );
    expect(page.querySelector('h1')?.textContent).toBe('সংস্করণ ৩');
    const more = [...page.querySelectorAll('.snapshot-rows-more-closed')].map((s) => s.textContent);
    expect(more).toEqual(['সব ১২টি প্রয়োজনীয়তা দেখান', 'সব ১০টি তথ্য দেখান', 'সব ৯টি ডকুমেন্টস দেখান']);
    const fewer = [...page.querySelectorAll('.snapshot-rows-more-open')].map((s) => s.textContent);
    expect(fewer).toEqual(['কম প্রয়োজনীয়তা দেখান', 'কম তথ্য দেখান', 'কম ডকুমেন্টস দেখান']);
    // The state word in the description is English, so the description stays English.
    expect(words()).toContain('Captured while IN_PROGRESS · checksum abc');
  });

  it('shows an application packet with no facts or documents', async () => {
    services.getMissionForOwner.mockResolvedValue(ok({ id: MISSION, title: 'Japan visa' }));
    services.listAcknowledgementsForMission.mockResolvedValue(ok([]));
    services.getMissionSnapshot.mockResolvedValue(
      ok({ id: 'snap-1', version: 4, checksum: 'abc', content: content('LOCKED', 1, true) }),
    );
    await open();
    expectBengali(
      'SnapshotsSnapshotidPage.applicationPacket',
      'SnapshotsSnapshotidPage.noFactsRecorded',
      'SnapshotsSnapshotidPage.noDocumentsRecorded',
    );
  });
});

describe('the Start a Trip page under Bengali', () => {
  it('heads the page and explains a group trip', async () => {
    services.listApplicants.mockResolvedValue([
      { id: 'p1', displayName: 'Rahima Akter' },
      { id: 'p2', displayName: 'Karim Hossain' },
    ]);
    services.tripTablesReady.mockResolvedValue(true);
    await draw(TripStartPage({}));
    expectBengali(
      'appMission.appMissionStartPage.startATrip',
      'appMission.appMissionStartPage.aboutStartingATrip',
      'appMission.appMissionStartPage.tellUsWhereYouAreGoing',
      'appMission.appMissionStartPage.travellingTogether',
    );
  });
});

describe('every live Bengali message of these parts', () => {
  it.each([
    'AttemptPanel',
    'CaseChecklist',
    'CaseItemPane',
    'CaseMobileBar',
    'CaseRail',
    'CaseSecondary',
    'CaseStatusPanel',
    'ChangesSinceConfirmed',
    'PackagePanel',
    'TripChecksPanel',
    'SnapshotsPage',
    'SnapshotsSnapshotidPage',
  ])('%s is rendered under Bengali by a test above', (component) => {
    expectEveryLiveMessageRendered(appMissionCatalog, `${P}${component}.`);
  });

  it('the Start a Trip page is rendered under Bengali by a test above', () => {
    expectEveryLiveMessageRendered(appMissionCatalog, 'appMission.appMissionStartPage.');
  });

  it('every live Bengali message of the case screens has a test (here or in case-forms-locale)', () => {
    const covered = new Set([
      ...[
        'AttachPackForm',
        'AttemptForms',
        'CaseMoreMenu',
        'CaseWelcome',
        'ChecklistSearch',
        'CollaborationPanels',
        'ComplaintFeedbackPanel',
        'ContributorRequestsPanel',
        'MissionButtons',
        'OutcomePanel',
        'PackageForms',
        'SubmissionReportPanel',
        'SnapshotsSnapshotidAcknowledgementPanel',
        'AttemptPanel',
        'CaseChecklist',
        'CaseItemPane',
        'CaseMobileBar',
        'CaseRail',
        'CaseSecondary',
        'CaseStatusPanel',
        'ChangesSinceConfirmed',
        'PackagePanel',
        'TripChecksPanel',
        'SnapshotsPage',
        'SnapshotsSnapshotidPage',
      ].map((c) => `appMissionId${c}`),
      'appMissionStartPage',
      'appMissionStartStartForm',
    ]);
    // A new component with Bengali must join one of the two lists above, with its own test.
    expect(
      Object.keys(appMissionCatalog.bn).filter((key) => !covered.has(key.split('.')[1] ?? '')),
    ).toEqual([]);
  });
});
