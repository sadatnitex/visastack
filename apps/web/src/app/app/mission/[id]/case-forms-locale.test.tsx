// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectEveryLiveMessageRendered } from '../../applicant/[id]/bn-coverage.test-support';

// The case screen's forms and panels drawn under Bengali, one visible state at a time, so that every
// live Bengali message of these components has a test that shows it.
vi.mock('@visastack/i18n', async (original) =>
  (await import('../../applicant/[id]/bn-coverage.test-support')).trackBengali(await original()),
);
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
vi.mock('./snapshots/[snapshotId]/actions', () => ({ decideAcknowledgementAction: done }));
vi.mock('../start/actions', () => ({ startTripAction: done }));
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// The start form's result (the cases it opened) is set here directly, as the action would return it.
const forced = vi.hoisted(() => ({ state: undefined as unknown }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: ((...args: Parameters<typeof actual.useActionState>) =>
      forced.state
        ? [forced.state, () => undefined, false]
        : actual.useActionState(...args)) as typeof actual.useActionState,
  };
});

const { I18nProvider } = await import('../../../../components/i18n-provider');
const { ShareOriginsProvider } = await import('../../../../components/share/share-origins');
const { appMissionCatalog } = await import('../../../../i18n/app-mission');
const { caseCountryOptions, casePurposeGroups } = await import('../../../../lib/case-choices');
const { AttachPackForm } = await import('./attach-pack-form');
const { AttemptEventForm, RecordAttemptForm, TrackReportForm } = await import('./attempt-forms');
const { CaseMoreMenu } = await import('./case-more-menu');
const { CaseWelcome } = await import('./case-welcome');
const { ChecklistSearch } = await import('./checklist-search');
const { AppointmentsPanel, EvidenceSelectionPanel, LettersPanel, TasksPanel } = await import(
  './collaboration-panels'
);
const { ComplaintPanel, FeedbackPanel } = await import('./complaint-feedback-panel');
const { ContributorRequestsPanel } = await import('./contributor-requests-panel');
const { CaseDetailsForm, ItineraryForm } = await import('./mission-buttons');
const { OutcomePanel } = await import('./outcome-panel');
const { PackageHandoffForm, PackageItemChoiceForm } = await import('./package-forms');
const { SubmissionReportPanel } = await import('./submission-report-panel');
const { AcknowledgementPanel } = await import('./snapshots/[snapshotId]/acknowledgement-panel');
const { TripStartForm } = await import('../start/start-form');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bn = appMissionCatalog.bn as Record<string, string>;
const en = appMissionCatalog.en as Record<string, string>;
const P = 'appMission.appMissionId';
const RAW_KEY = /appMission\.app[A-Z]/;
const MISSION = '00000000-0000-4000-8000-000000000101';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  forced.state = undefined;
});

const show = (node: React.ReactNode) =>
  act(() =>
    root.render(
      <I18nProvider locale="bn" pageLang="bn">
        {node}
      </I18nProvider>,
    ),
  );
/** What a reader meets: the words on screen plus every attribute (placeholders, names, hints). */
const seen = () =>
  [
    host.textContent ?? '',
    ...[...host.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.value)),
  ].join('\n');
const full = (key: string) => (key.startsWith('appMission.') ? key : `${P}${key}`);
/**
 * Each key's Bengali is on screen, and its English sentence is not (a short English word such as
 * "Date" also names other things on the page, so only sentences are checked for absence).
 */
const expectBengali = (...keys: string[]) => {
  const text = seen();
  for (const key of keys.map(full)) {
    expect(bn[key], key).toBeTruthy();
    expect(text, key).toContain(bn[key]);
    if ((en[key] ?? '').length >= 30) expect(host.textContent, key).not.toContain(en[key]);
  }
  expect(text).not.toMatch(RAW_KEY);
};
const START = 'appMission.appMissionStartStartForm.';
const pick = (select: HTMLSelectElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

describe('the attempt forms under Bengali', () => {
  const evidence = [{ value: 'v1', label: 'Courier receipt' }];
  const kinds = [
    { value: 'BANK_STATEMENT', label: 'Bank Statement' },
    { value: 'PAYSLIP', label: 'Payslip' },
  ];

  it('reports a submission with a receipt from the documents, and keeps the English Save', () => {
    show(<RecordAttemptForm missionId={MISSION} today="2026-11-13" evidenceChoices={evidence} />);
    expectBengali(
      'AttemptForms.howItWasSent',
      'AttemptForms.choose',
      'AttemptForms.dayItWasSent',
      'AttemptForms.attachADocumentOptional',
      'AttemptForms.noDocument',
      'AttemptForms.aReceiptOrConfirmationFromYour',
    );
    expect(host.textContent).toContain('Courier receipt');
  });

  it('records a decision after an attempt', () => {
    show(
      <AttemptEventForm
        missionId={MISSION}
        attemptId="a1"
        attemptNo={2}
        today="2026-11-13"
        evidenceChoices={evidence}
        documentKinds={kinds}
      />,
    );
    expect(host.textContent).toContain('প্রচেষ্টা ২-এর পর কী হয়েছে');
    expect(host.textContent).not.toContain(bn[`${P}AttemptForms.decision`]);
    pick(host.querySelector('select[name="kind"]') as HTMLSelectElement, 'DECISION');
    expectBengali('AttemptForms.decision', 'AttemptForms.dayItHappened');
    expectBengali('AttemptForms.aLetterOrReceiptFromYour');
    // Its button names the attempt in English, as its visible "Save" is English.
    expect(host.querySelector('button[type="submit"]')?.getAttribute('aria-label')).toBe(
      'Save for Attempt 2',
    );
    expect(host.querySelector('button[type="submit"]')?.textContent).toBe('Save');
  });

  it('lists the documents the embassy asked for, with an English Remove that matches its name', () => {
    show(
      <AttemptEventForm
        missionId={MISSION}
        attemptId="a1"
        attemptNo={1}
        today="2026-11-13"
        evidenceChoices={[]}
        documentKinds={kinds}
      />,
    );
    pick(host.querySelector('select[name="kind"]') as HTMLSelectElement, 'AUTHORITY_REQUEST');
    expectBengali(
      'AttemptForms.whoAsked',
      'AttemptForms.documentsTheyAskedFor',
      'AttemptForms.documentToAdd',
      'AttemptForms.chooseADocument',
      'AttemptForms.addDocument',
    );
    const next = host.querySelector('select:not([name])') as HTMLSelectElement;
    pick(next, 'PAYSLIP');
    const add = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === bn[`${P}AttemptForms.addDocument`],
    );
    act(() => add?.click());
    const remove = host.querySelector('button[aria-label="Remove Payslip"]');
    expect(remove?.textContent).toBe('Remove');
    expect(remove?.textContent).toBe(en[`${P}AttemptForms.remove`]);
  });

  it('tracks a report as an attempt with an English name that matches its English button', () => {
    show(<TrackReportForm missionId={MISSION} missionSubmissionId="s1" reportName="VFS desk" />);
    const button = host.querySelector('button[type="submit"]');
    expect(button?.getAttribute('aria-label')).toBe('Track as Attempt: VFS desk');
    expect(button?.textContent).toBe('Track as Attempt');
  });
});

describe('the case menu under Bengali', () => {
  const open = () =>
    act(() => {
      const details = host.querySelector('details') as HTMLDetailsElement;
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });

  it('offers the header actions and asks before a case is cancelled', () => {
    show(
      <CaseMoreMenu
        missionId={MISSION}
        applicantId="person-1"
        canCancel
        headerActions={{ addEvidenceHref: '/app/x', newCaseHref: '/app/y' }}
      />,
    );
    open();
    expectBengali(
      'CaseMoreMenu.more',
      'CaseMoreMenu.addEvidence',
      'CaseMoreMenu.startANewCaseFromThis',
      'CaseMoreMenu.openCaseHistory',
      'CaseMoreMenu.cancelCase',
    );
    const cancel = [...host.querySelectorAll('button.case-more-item')].at(-1) as HTMLButtonElement;
    act(() => cancel.click());
    expectBengali(
      'CaseMoreMenu.cancelThisCase',
      'CaseMoreMenu.theCaseStopsForGoodIt',
      'CaseMoreMenu.nothingIsDeletedNowItsSnapshots',
      'CaseMoreMenu.toApplyAgainLaterOpenThe',
      'CaseMoreMenu.keepTheCase',
    );
  });

  it('asks before a cancelled case is deleted for good', () => {
    show(<CaseMoreMenu missionId={MISSION} applicantId="person-1" canCancel={false} canDelete />);
    open();
    expectBengali('CaseMoreMenu.deleteCase');
    const remove = [...host.querySelectorAll('button.case-more-item')].at(-1) as HTMLButtonElement;
    act(() => remove.click());
    expectBengali(
      'CaseMoreMenu.deleteThisCase',
      'CaseMoreMenu.theCaseIsRemovedForGood',
      'CaseMoreMenu.yourProfileAndDocumentsAreNot',
      'CaseMoreMenu.thisCannotBeUndone',
      'CaseMoreMenu.keepTheCase',
    );
  });
});

describe('the welcome note and the checklist search under Bengali', () => {
  it('folds the welcome words under About This and closes with Got It', () => {
    window.scrollTo = vi.fn();
    show(
      <CaseWelcome
        title="Your case is open"
        lead="Start with the checklist."
        body={['One line.']}
        action={{ href: '#readiness', label: 'See the Checklist' }}
      />,
    );
    expectBengali('CaseWelcome.aboutThis', 'CaseWelcome.gotIt');
  });

  it('counts the matching rows and says when nothing matches', () => {
    const scope = document.createElement('div');
    scope.id = 'readiness';
    scope.innerHTML = Array.from(
      { length: 9 },
      (_, i) => `<div data-pattern="list-row"><a data-pane-open="r${i}">Row ${i}</a></div>`,
    ).join('');
    document.body.append(scope);
    show(<ChecklistSearch scopeId="readiness" rows={9} />);
    expect(host.querySelector('output')?.textContent).toBe('৯টির মধ্যে ৯টি আইটেম মিলেছে।');
    // The search box keeps its English name, so its placeholder stays English with it.
    expect(host.querySelector('input')?.getAttribute('placeholder')).toBe('Search the Checklist');
    const input = host.querySelector('input') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'nothing like this',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expectBengali('ChecklistSearch.noItemsMatch');
    expect(host.querySelector('output')?.textContent).toBe('৯টির মধ্যে ০টি আইটেম মিলেছে।');
    scope.remove();
  });
});

describe('the requirement pack, case details and itinerary forms under Bengali', () => {
  it('asks for a pack by name', () => {
    show(
      <AttachPackForm missionId={MISSION} options={[{ packVersionId: 'p1', label: 'Japan' }]} />,
    );
    expectBengali('AttachPackForm.requirementPack', 'AttachPackForm.chooseARequirementPack');
  });

  it('labels the case details and the itinerary reference', () => {
    show(
      <>
        <CaseDetailsForm
          missionId={MISSION}
          jurisdiction={null}
          serviceCategory={null}
          travelStartDate={null}
          travelEndDate={null}
          targetDeadline={null}
          manualMode
        />
        <ItineraryForm missionId={MISSION} itineraryRef={null} />
      </>,
    );
    expectBengali(
      'MissionButtons.serviceCategory',
      'MissionButtons.eGTouristStudentWork',
      'MissionButtons.travelDates',
      'MissionButtons.travelStartDate',
      'MissionButtons.travelEndDate',
      'MissionButtons.targetDeadline',
      'MissionButtons.eGSmithFamilyEurope2026',
      'CaseRail.itineraryReference',
    );
  });
});

describe('tasks, appointments, letters and evidence choices under Bengali', () => {
  const task = {
    id: 't1',
    description: 'Book the biometrics appointment',
    priority: 'NORMAL' as const,
    dueDate: '2026-11-20T00:00:00.000Z',
    dueTimezone: 'Asia/Dhaka',
  };

  it('shows an empty task list and the form to add one', () => {
    show(<TasksPanel missionId={MISSION} tasks={[]} />);
    expectBengali(
      'CollaborationPanels.checklist',
      'CollaborationPanels.tasks',
      'CollaborationPanels.noOpenTasks',
      'CollaborationPanels.addATask',
      'CollaborationPanels.taskDescription',
      'CollaborationPanels.priority',
      'CollaborationPanels.dueDateOptional',
      'CollaborationPanels.dueTimeZoneOptional',
    );
  });

  it('marks a task in progress with a Bengali due date, and keeps the AI app line English', () => {
    show(
      <TasksPanel
        missionId={MISSION}
        tasks={[{ ...task, status: 'IN_PROGRESS', addedBy: 'an AI App' }]}
      />,
    );
    expectBengali('CollaborationPanels.inProgress');
    expect(host.textContent).toContain('নির্ধারিত তারিখ ২০ নভে, ২০২৬');
    // "an AI App" is English, so the line that names who added the task stays English.
    expect(host.textContent).toContain('Added by an AI App');
  });

  it('shows no appointments, then one upcoming and one past', () => {
    show(<AppointmentsPanel missionId={MISSION} appointments={[]} />);
    expectBengali(
      'CollaborationPanels.meetings',
      'CollaborationPanels.appointments',
      'CollaborationPanels.noAppointmentsScheduled',
      'CollaborationPanels.eGVisaInterviewPrepCall',
      'CollaborationPanels.appointmentTitle',
      'CollaborationPanels.date',
      'CollaborationPanels.time',
      'CollaborationPanels.placeOptional',
      'CollaborationPanels.place',
      'CollaborationPanels.channelEGVideoCallOptional',
      'CollaborationPanels.channel',
    );
    const appointment = {
      title: 'Biometrics',
      timezone: 'Asia/Dhaka',
      place: 'VFS Gulshan',
      channel: null,
    };
    show(
      <AppointmentsPanel
        missionId={MISSION}
        appointments={[
          { ...appointment, id: 'a1', localDateTime: '2099-01-10T10:00', status: 'OPEN' },
          { ...appointment, id: 'a2', localDateTime: '2020-01-10T10:00', status: 'DONE' },
        ]}
      />,
    );
    expectBengali('CollaborationPanels.addToCalendar');
    expect(host.textContent).toContain('১টি পেরিয়ে গেছে');
  });

  it('lists a letter by version and says when nothing can ground one yet', () => {
    show(
      <LettersPanel
        missionId={MISSION}
        canGenerate={false}
        letters={[
          { id: 'l1', version: 3, content: 'Dear officer,', createdAt: '2026-11-02T08:00:00.000Z' },
        ]}
      />,
    );
    expectBengali(
      'CollaborationPanels.groundedDocuments',
      'CollaborationPanels.coverLetters',
      'CollaborationPanels.nothingEligibleToGroundALetter',
    );
    expect(host.querySelector('summary')?.textContent).toBe('সংস্করণ ৩ · ২ নভে, ২০২৬');
    show(<LettersPanel missionId={MISSION} canGenerate letters={[]} />);
    expectBengali('CollaborationPanels.noLettersGeneratedYet');
  });

  it('asks which of several documents backs a requirement', () => {
    const doc = { eligible: true, staleness: 'fresh' as const };
    show(
      <EvidenceSelectionPanel
        missionId={MISSION}
        candidates={[
          {
            packRequirementId: 'q1',
            kind: 'DOCUMENT',
            label: 'Bank statement',
            citation: 'rule',
            factCandidates: [],
            documentCandidates: [
              { ...doc, documentId: 'd1', displayName: 'October statement' },
              { ...doc, documentId: 'd2', displayName: 'November statement' },
            ],
            selectedFactIds: [],
            selectedDocumentIds: [],
            selectionIdsByCandidate: {},
          },
        ]}
      />,
    );
    expectBengali(
      'CollaborationPanels.precision',
      'CollaborationPanels.selectEvidence',
      'CollaborationPanels.moreThanOneInstanceIsOn',
    );
  });
});

describe('complaints, feedback and contributor requests under Bengali', () => {
  it('shows a resolved complaint, its first event and the form for a new one', () => {
    show(
      <ComplaintPanel
        missionId={MISSION}
        complaints={[
          {
            id: 'c1',
            description: 'Slow replies',
            status: 'RESOLVED',
            resolution: 'Agency apologised',
            createdAt: '2026-11-01T08:00:00.000Z',
            events: [
              {
                id: 'e1',
                fromStatus: null,
                toStatus: 'OPEN',
                note: null,
                createdAt: '2026-11-01T08:00:00.000Z',
              },
            ],
          },
        ]}
      />,
    );
    expectBengali(
      'ComplaintFeedbackPanel.oversight',
      'ComplaintFeedbackPanel.caseComplaint',
      'ComplaintFeedbackPanel.reviewedOnlyByAuthorizedQualityStaff',
      'ComplaintFeedbackPanel.fileANewComplaint',
      'ComplaintFeedbackPanel.describeTheIssueWithHowThis',
    );
    expect(host.textContent).toContain('সমাধান: Agency apologised');
    // The status word is English, so its line stays English.
    expect(host.textContent).toContain('Filed (OPEN)');
  });

  it('asks for feedback once the case is closed, and says when it opens before that', () => {
    show(<FeedbackPanel missionId={MISSION} feedback={[]} canSubmit />);
    expectBengali(
      'ComplaintFeedbackPanel.privateFeedback',
      'ComplaintFeedbackPanel.onlyYouAndAuthorizedQualityStaff',
      'ComplaintFeedbackPanel.shareFeedbackOnHowThisCase',
    );
    show(<FeedbackPanel missionId={MISSION} feedback={[]} canSubmit={false} />);
    expectBengali('ComplaintFeedbackPanel.feedbackBecomesAvailableOnceThisCase');
  });

  it('asks a contributor for one document, and shares the request link', async () => {
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    forced.state = {
      ok: true,
      message: '',
      acceptUrl:
        'https://vs.example.test/app/contributor-requests/accept?token=abcDEF123_-xyzABC456',
      requestId: 'r9',
    };
    show(
      <ShareOriginsProvider origin="https://vs.example.test">
        <ContributorRequestsPanel missionId={MISSION} requests={[]} />
      </ShareOriginsProvider>,
    );
    expectBengali(
      'ContributorRequestsPanel.contributorEmail',
      'ContributorRequestsPanel.whatSNeededExactlyOneDocument',
      'ContributorRequestsPanel.eGSponsorBankStatement',
      'ContributorRequestsPanel.whyTheContributorWillSeeThis',
      'ContributorRequestsPanel.eGToSupportTheFinancial',
      'ContributorRequestsPanel.messageOptional',
    );
    // The phone's share sheet is titled in Bengali.
    const more = [...host.querySelectorAll('.wa-share button')].at(0) as HTMLButtonElement;
    await act(async () => more.click());
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ title: bn[`${P}ContributorRequestsPanel.visastackRequest`] }),
    );
    expect(bn[`${P}ContributorRequestsPanel.visastackRequest`]).toBe('VisaStack অনুরোধ');
    Reflect.deleteProperty(navigator, 'share');
    // An address is the same in both languages.
    expect(bn[`${P}ContributorRequestsPanel.sponsorExampleCom`]).toBe('sponsor@example.com');
    expect(host.querySelector('input[type="email"]')?.getAttribute('placeholder')).toBe(
      'sponsor@example.com',
    );
  });
});

describe('the outcome, submission and package forms under Bengali', () => {
  it('records a first outcome with a document to back it', () => {
    show(
      <OutcomePanel
        missionId={MISSION}
        outcomes={[]}
        evidenceOptions={[{ documentId: 'd1', displayName: 'Decision letter' }]}
      />,
    );
    expectBengali(
      'OutcomePanel.caseOutcome',
      'OutcomePanel.theOfficialWordingAndYourOwn',
      'OutcomePanel.noOutcomeRecordedYet',
      'OutcomePanel.decisionDate',
      'OutcomePanel.officialWordingOptional',
      'OutcomePanel.exactWordingFromTheDecisionLetter',
      'OutcomePanel.yourInterpretationOptional',
      'OutcomePanel.keptSeparateFromTheWordingAbove',
      'OutcomePanel.evidenceOptional',
      'OutcomePanel.none',
    );
  });

  it('keeps the official wording of a decision English and puts the reading in Bengali', () => {
    show(
      <OutcomePanel
        missionId={MISSION}
        evidenceOptions={[]}
        outcomes={[
          {
            id: 'o1',
            decision: 'APPROVED',
            decisionDate: '2026-11-10',
            officialWording: 'Visa granted',
            agencyInterpretation: 'Approved as asked',
            createdAt: '2026-11-10T08:00:00.000Z',
          },
        ]}
      />,
    );
    expect(host.textContent).toContain('Official: Visa granted');
    expect(host.textContent).toContain('ব্যাখ্যা: Approved as asked');
  });

  it('reports a submission with its reference, and says when it cannot be reported yet', () => {
    show(
      <SubmissionReportPanel
        missionId={MISSION}
        eligible
        submissions={[
          {
            id: 's1',
            channel: 'IN_PERSON',
            externalReportDescription: 'Handed in at VFS',
            externalReference: 'VFS-123',
            submittedAt: '2026-11-03T08:00:00.000Z',
          },
        ]}
      />,
    );
    expectBengali(
      'SubmissionReportPanel.filing',
      'SubmissionReportPanel.submissionReport',
      'SubmissionReportPanel.howWasItSubmitted',
      'SubmissionReportPanel.description',
      'SubmissionReportPanel.whatWasActuallyFiledAndWhere',
      'SubmissionReportPanel.referenceNumberOptional',
      'SubmissionReportPanel.eGTrackingOrReceiptNumber',
      'SubmissionReportPanel.submittedOnOptionalDefaultsToNow',
    );
    expect(host.textContent).toContain(' · রেফারেন্স: VFS-123');
    show(<SubmissionReportPanel missionId={MISSION} eligible={false} submissions={[]} />);
    expectBengali(
      'SubmissionReportPanel.noSubmissionReportedYet',
      'SubmissionReportPanel.thisCaseMustReachSubmissionReady',
    );
  });

  it('chooses what a package item uses, with the English Save Choice name kept English', () => {
    show(
      <>
        <PackageItemChoiceForm
          missionId={MISSION}
          packRequirementId="q1"
          itemName="Passport"
          options={[{ value: 'v1', label: 'Passport scan' }]}
          current="v1"
          canExclude
          hasChoice
        />
        <PackageHandoffForm missionId={MISSION} />
      </>,
    );
    expectBengali(
      'PackageForms.leaveMissingForNow',
      'PackageForms.leaveOutOfThisPackage',
      'PackageForms.goBackToTheSuggestedCopy',
      'PackageForms.reasonForLeavingOut',
      'PackageForms.neededOnlyWhenYouLeaveThis',
      'PackageForms.iHaveReadTheStepsOutside',
    );
    expect(host.textContent).toContain('What to Use for Passport');
    expect(seen()).toContain('Save Choice for Passport');
  });
});

describe('the final review under Bengali', () => {
  it('says the case changed since the last confirmation, keeping the dated line English', () => {
    show(
      <AcknowledgementPanel
        missionId={MISSION}
        snapshotId="00000000-0000-4000-8000-000000000202"
        checksum="a1b2c3d4e5f60718"
        history={[
          {
            id: 'h1',
            decision: 'ACKNOWLEDGED',
            reason: null,
            createdAt: new Date('2026-11-01T08:00:00Z'),
            invalidatedAt: new Date('2026-11-05T08:00:00Z'),
          },
        ]}
      />,
    );
    expectBengali(
      'SnapshotsSnapshotidAcknowledgementPanel.finalReview',
      'SnapshotsSnapshotidAcknowledgementPanel.confirmThisPreparedFile',
      'SnapshotsSnapshotidAcknowledgementPanel.thisPageIsTheExactEvidence',
      'SnapshotsSnapshotidAcknowledgementPanel.whatYouAreConfirming',
      'SnapshotsSnapshotidAcknowledgementPanel.thatYouHaveReadItAcknowledging',
      'SnapshotsSnapshotidAcknowledgementPanel.ifTheCaseChangesAfterwardsThis',
      'SnapshotsSnapshotidAcknowledgementPanel.theCaseChangedAfterYouLast',
      'SnapshotsSnapshotidAcknowledgementPanel.reasonRequiredToRejectOrRequest',
      'SnapshotsSnapshotidAcknowledgementPanel.whatNeedsToChangeOrWhy',
    );
    expect(host.textContent).toContain('Historical -- the case changed after this decision');
  });
});

describe('starting a trip under Bengali', () => {
  const form = () => (
    <TripStartForm
      countries={caseCountryOptions()}
      purposes={casePurposeGroups()}
      travellers={[{ applicantId: 'p1', name: 'Rahima Akter' }]}
    />
  );

  it('asks where, who and what each traveller gets', () => {
    show(form());
    expectBengali(
      `${START}whereAreYouGoing`,
      `${START}forExampleJapan`,
      `${START}typeANameOrOpenThe`,
      `${START}whoSTravelling`,
      'CaseWelcome.aboutThis',
      `${START}eachTravellerGetsTheirOwnCase`,
      `${START}startTheTrip`,
    );
  });

  it('links each case it opened, new or existing, by the traveller name', () => {
    forced.state = {
      ok: true,
      message: '',
      cases: [
        { missionId: 'm1', name: 'Rahima Akter', existing: false },
        { missionId: 'm2', name: 'Karim Hossain', existing: true },
      ],
    };
    show(form());
    const links = [...host.querySelectorAll('a[href$="#trip-package"]')].map((a) => a.textContent);
    expect(links).toEqual(['Rahima Akter-এর ভিসা ফাইল খুলুন', 'Karim Hossain-এর বিদ্যমান ভিসা ফাইলটি খুলুন']);
  });
});

describe('every live Bengali message of these components', () => {
  it.each([
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
  ])('%s is rendered under Bengali by a test above', (component) => {
    expectEveryLiveMessageRendered(appMissionCatalog, `${P}${component}.`);
  });

  it('StartStartForm is rendered under Bengali by a test above', () => {
    expectEveryLiveMessageRendered(appMissionCatalog, 'appMission.appMissionStartStartForm.');
  });
});
