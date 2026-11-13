import { describe, expect, it, vi } from 'vitest';
import { fixtureMissing, fixturePicker } from '../../../lib/master-profile-fixture';
import { drawBn, missingBengali } from './agency-bn.test-support';

vi.mock('server-only', () => ({}));
// Every action is a stand-in that answers "done"; nothing here submits a form.
const stubActions = (names: readonly string[]) => {
  const idle = vi.fn(async () => ({ ok: true, message: '' }));
  return Object.fromEntries(names.map((name) => [name, idle]));
};
vi.mock('./[orgId]/actions', () =>
  stubActions([
    'addMemberAction',
    'addNoteAction',
    'assignMemberAction',
    'cancelEvidenceRequestAction',
    'createAppointmentForOrgAction',
    'createTaskForOrgAction',
    'decideAppointmentForOrgAction',
    'decideEvidenceResponseAction',
    'decideTaskForOrgAction',
    'inviteClientAction',
    'recordDecisionAction',
    'recordIssuerVerificationAction',
    'removeLogoAction',
    'requestEvidenceAction',
    'startEvidenceReviewAction',
    'unassignMemberAction',
    'updateBrandingAction',
    'updateTaskForOrgAction',
    'uploadLogoAction',
  ]),
);
vi.mock('./[orgId]/checklists/actions', () =>
  stubActions([
    'addItemAction',
    'copyListAction',
    'discardDraftAction',
    'publishDraftAction',
    'removeItemAction',
    'saveItemAction',
    'startUpdateAction',
  ]),
);
vi.mock('./[orgId]/collection/actions', () =>
  stubActions([
    'choosePackAction',
    'createRequestAction',
    'editDraftAction',
    'emailLinkAction',
    'endRequestAction',
    'issueRequestAction',
    'newLinkAction',
  ]),
);
vi.mock('./[orgId]/evidence-copy-actions', () => ({
  downloadEvidenceCopyAction: async () => undefined,
}));

const { MissionCollaboration } = await import('./[orgId]/mission-collaboration');
const { AddMemberForm } = await import('./[orgId]/member-form');
const { ClientInvitationForm } = await import('./[orgId]/client-invitation-form');
const { RequestEvidenceForm } = await import('./[orgId]/request-evidence-form');
const { EvidenceRequestActions } = await import('./[orgId]/evidence-request-actions');
const { FollowUpCopy } = await import('./[orgId]/follow-up-copy');
const { ItemEditor, AddItemForm: ChecklistAddItemForm } = await import(
  './[orgId]/checklists/checklist-forms'
);
const {
  NewRequestForm,
  ItemEditForm,
  EmailLinkForm,
  PackChoiceForm,
  AddItemForm: CollectionAddItemForm,
} = await import('./[orgId]/collection/collection-forms');
const { CollectionLinkPanel } = await import('./[orgId]/collection/collection-link-panel');
const { BrandingForm } = await import('./[orgId]/branding-form');

/** Every sentence of a visible state must come out in Bengali, with no raw key showing. */
function expectBengali(html: string, keys: readonly string[]) {
  expect(missingBengali(html, keys)).toEqual([]);
  expect(html).not.toMatch(/appAgency\./);
}

describe('the team and client forms under Bengali', () => {
  it('draws the add-member form in Bengali, role names and placeholder included', () => {
    const html = drawBn(<AddMemberForm organizationId="o1" pendingInvitationIds={[]} />);
    expectBengali(html, [
      'appAgencyOrgidMemberForm.memberEmail',
      'appAgencyOrgidMemberForm.teammateExampleCom',
      'appAgencyOrgidMemberForm.role',
      'appAgencyOrgidMemberForm.admin',
      'appAgencyOrgidMemberForm.caseManager',
      'appAgencyOrgidMemberForm.reviewer',
    ]);
  });

  it('draws the client invitation form in Bengali when a team member can own the case', () => {
    const html = drawBn(
      <ClientInvitationForm
        organizationId="o1"
        pendingInvitationIds={[]}
        members={[{ accountId: 'u1', email: 'owner@example.com', active: true }]}
      />,
    );
    expectBengali(html, [
      'appAgencyOrgidClientInvitationForm.travellerName',
      'appAgencyOrgidClientInvitationForm.clientEmailAddress',
      'appAgencyOrgidClientInvitationForm.janeExampleCom',
      'appAgencyOrgidClientInvitationForm.janeTraveller',
      'appAgencyOrgidClientInvitationForm.requestedRouteOptional',
      'appAgencyOrgidClientInvitationForm.usB1B2BusinessVisa',
      'appAgencyOrgidClientInvitationForm.caseOwner',
    ]);
  });
});

describe('the evidence request form under Bengali', () => {
  const fixed = {
    applicantId: 'a-1',
    applicantName: 'Test Applicant',
    missionId: 'm-1',
    caseTitle: 'Japan Visit',
  };

  it('draws the search, the picking help and the form labels in Bengali (chosen traveller)', () => {
    const html = drawBn(
      <RequestEvidenceForm
        organizationId="o1"
        picker={fixturePicker}
        applicants={[{ applicantId: 'a-1', displayName: 'Test Applicant' }]}
      />,
    );
    expectBengali(html, [
      'appAgencyOrgidEvidencePicker.searchDocumentsAndDetails',
      'appAgencyOrgidEvidencePicker.forExampleNidTradeLicenceSolvency',
      'appAgencyOrgidEvidencePicker.chooseAsManyAsYouNeed',
      'appAgencyOrgidRequestEvidenceForm.chooseATraveller',
      'appAgencyOrgidRequestEvidenceForm.traveller',
      'appAgencyOrgidRequestEvidenceForm.messageOptional',
      'appAgencyOrgidRequestEvidenceForm.dueDateOptional',
      'appAgencyOrgidRequestEvidenceForm.forExampleNeededForTheVisa',
      'appAgencyOrgidRequestEvidenceForm.theMessageAndTheDueDate',
    ]);
  });

  it('draws the missing list and its any-one-of group in Bengali (a case workspace)', () => {
    const html = drawBn(
      <RequestEvidenceForm
        organizationId="o1"
        picker={fixturePicker}
        fixed={fixed}
        missing={fixtureMissing}
      />,
    );
    expectBengali(html, [
      'appAgencyOrgidEvidencePicker.anyOneOfThese',
      'appAgencyOrgidEvidencePicker.theTravellerNeedsOnlyOneOf',
    ]);
  });
});

describe('the decision buttons under Bengali', () => {
  it('draws every decision in Bengali for a copy that can be decided', () => {
    const html = drawBn(
      <EvidenceRequestActions
        organizationId="o1"
        requestId="r1"
        status="RECEIVED"
        submissionId="s1"
      />,
    );
    expectBengali(html, [
      'appAgencyOrgidEvidenceRequestActions.needsReplacement',
      'appAgencyOrgidEvidenceRequestActions.moreDecisions',
      'appAgencyOrgidEvidenceRequestActions.contradiction',
      'appAgencyOrgidEvidenceRequestActions.proposeCorrection',
    ]);
  });
});

describe('the follow-up message under Bengali', () => {
  it('draws the label and the read-first note, and the note left out line when it applies', () => {
    const html = drawBn(<FollowUpCopy text={'Hello\nPlease send the file.'} agencyNoteLeftOut />);
    expectBengali(html, [
      'appAgencyOrgidFollowUpCopy.messageToCopy',
      'appAgencyOrgidFollowUpCopy.readItFirstItIsNot',
      'appAgencyOrgidFollowUpCopy.yourNoteWasLeftOutBecause',
    ]);
  });
});

describe('the checklist forms under Bengali', () => {
  it('draws the item editor with the necessity words and who the item is for', () => {
    const html = drawBn(
      <ItemEditor
        organizationId="o1"
        packId="p1"
        requirementId="r1"
        kind="DOCUMENT"
        label="Passport"
        docType="PASSPORT"
        necessity="MANDATORY"
        wording={null}
        appliesWhen={null}
      />,
    );
    expectBengali(html, [
      'appAgencyOrgidChecklistsChecklistForms.required',
      'appAgencyOrgidChecklistsChecklistForms.recommended',
      'appAgencyOrgidChecklistsChecklistForms.optional',
      'appAgencyOrgidChecklistsChecklistForms.whoItIsFor',
    ]);
  });

  it('draws the add item form in Bengali too', () => {
    const html = drawBn(
      <ChecklistAddItemForm organizationId="o1" packId="p1" packVersionId="v1" />,
    );
    expectBengali(html, [
      'appAgencyOrgidChecklistsChecklistForms.required',
      'appAgencyOrgidChecklistsChecklistForms.whoItIsFor',
    ]);
  });
});

describe('the collection forms under Bengali', () => {
  const necessities = [
    { value: 'MANDATORY', label: 'Required' },
    { value: 'OPTIONAL', label: 'Optional' },
  ];

  it('draws the new request form in Bengali', () => {
    const html = drawBn(
      <NewRequestForm
        organizationId="o1"
        countries={[{ iso2: 'JP', name: 'Japan' }]}
        purposeGroups={[{ label: 'Travel', options: [{ key: 'tourism', label: 'Tourism' }] }]}
      />,
    );
    expectBengali(html, [
      'appAgencyOrgidCollectionCollectionForms.whoItIsForOptional',
      'appAgencyOrgidCollectionCollectionForms.name',
      'appAgencyOrgidCollectionCollectionForms.nationality',
      'appAgencyOrgidCollectionCollectionForms.countryOfResidence',
      'appAgencyOrgidCollectionCollectionForms.travelToOptional',
      'appAgencyOrgidCollectionCollectionForms.travelFromOptional',
      'appAgencyOrgidCollectionCollectionForms.specificRouteOptional',
      'appAgencyOrgidCollectionCollectionForms.whatYouAlreadyKnowOptional',
    ]);
  });

  it('draws an item edit form in Bengali, and its Remove name stays English like its button', () => {
    const html = drawBn(
      <ItemEditForm
        organizationId="o1"
        requestId="r1"
        item={{ id: 'i1', label: 'Passport', note: null, necessity: 'MANDATORY', agency: true }}
        first={false}
        last={false}
        removable
        necessities={necessities}
      />,
    );
    expect(html).not.toMatch(/appAgency\./);
    // The visible button says Remove, so its spoken name is English too (rule 16).
    expect(html).toContain('aria-label="Remove: Passport"');
    expect(html).not.toMatch(/aria-label="[^"]*সরান/);
  });

  it('draws the add item form with its note label in Bengali', () => {
    const html = drawBn(
      <CollectionAddItemForm organizationId="o1" requestId="r1" necessities={necessities} />,
    );
    expectBengali(html, ['appAgencyOrgidCollectionCollectionForms.noteToThePersonOptional']);
  });

  it('draws the checklist choice in Bengali', () => {
    const html = drawBn(
      <PackChoiceForm
        organizationId="o1"
        requestId="r1"
        choices={[{ packVersionId: 'pv1', label: 'UK Standard Visitor' }]}
        current="pv1"
      />,
    );
    expectBengali(html, ['appAgencyOrgidCollectionCollectionForms.checklistToFollow']);
  });

  it('draws the email link form in Bengali', () => {
    const html = drawBn(<EmailLinkForm organizationId="o1" requestId="r1" defaultEmail={null} />);
    expectBengali(html, ['appAgencyOrgidCollectionCollectionForms.emailAddress']);
  });

  it('draws the private link panel with its Copy Link button in Bengali', () => {
    const html = drawBn(<CollectionLinkPanel url="https://example.test/r/abc" />);
    expectBengali(html, ['appAgencyOrgidCollectionCollectionLinkPanel.copyLink']);
  });
});

describe('the branding form under Bengali', () => {
  it('draws the preview line in Bengali', () => {
    const html = drawBn(
      <BrandingForm organizationId="o1" name="Skyline Visa" accentColor={null} logoUrl={null} />,
    );
    expectBengali(html, ['appAgencyOrgidBrandingForm.agencyWorkspace']);
  });
});

describe('the case workspace under Bengali', () => {
  it('draws tasks, appointments, notes and the decision form in Bengali', () => {
    const html = drawBn(
      <MissionCollaboration
        organizationId="o1"
        missionId="m1"
        applicantId="a1"
        title="UK visit"
        referenceCode="VS-1"
        applicantName="Rahim Uddin"
        viewerAssigned
        members={[{ accountId: 'u1', email: 'first@example.com' }]}
        assignments={[{ id: 'as1', memberAccountId: 'u1', memberEmail: 'first@example.com' }]}
        notes={[
          {
            id: 'n1',
            body: 'Called the client',
            authorEmail: 'first@example.com',
            createdAt: '2026-11-03T08:00:00Z',
            visibility: 'AGENCY_INTERNAL',
          },
        ]}
        tasks={[
          {
            id: 't1',
            description: 'Book the visa appointment',
            status: 'OPEN',
            priority: 'HIGH',
            assigneeAccountId: null,
            dueDate: '2026-11-20',
          },
        ]}
        appointments={[]}
        requirements={[{ id: 'req1', label: 'Passport' }]}
        decisions={[]}
        issuerVerifications={[]}
      />,
    );
    expectBengali(html, [
      'appAgencyOrgidMissionCollaboration.notes',
      'appAgencyOrgidMissionCollaboration.tasks',
      'appAgencyOrgidMissionCollaboration.addATask',
      'appAgencyOrgidMissionCollaboration.taskDescription',
      'appAgencyOrgidMissionCollaboration.priority',
      'appAgencyOrgidMissionCollaboration.dueDateOptional',
      'appAgencyOrgidMissionCollaboration.assigned',
      'appAgencyOrgidMissionCollaboration.unassigned',
      'appAgencyOrgidMissionCollaboration.appointments',
      'appAgencyOrgidMissionCollaboration.noAppointmentsScheduled',
      'appAgencyOrgidMissionCollaboration.appointmentTitle',
      'appAgencyOrgidMissionCollaboration.date',
      'appAgencyOrgidMissionCollaboration.time',
      'appAgencyOrgidMissionCollaboration.timeZone',
      'appAgencyOrgidMissionCollaboration.place',
      'appAgencyOrgidMissionCollaboration.channel',
      'appAgencyOrgidMissionCollaboration.decision',
      'appAgencyOrgidMissionCollaboration.accept',
      'appAgencyOrgidMissionCollaboration.reasonOptional',
      'appAgencyOrgidMissionCollaboration.caseReference',
    ]);
  });

  it('says there are no open tasks in Bengali when the list is empty', () => {
    const html = drawBn(
      <MissionCollaboration
        organizationId="o1"
        missionId="m1"
        applicantId="a1"
        title="UK visit"
        applicantName="Rahim Uddin"
        viewerAssigned={false}
        members={[]}
        assignments={[]}
        notes={[]}
        tasks={[]}
        appointments={[]}
        requirements={[]}
        decisions={[]}
        issuerVerifications={[]}
      />,
    );
    expectBengali(html, ['appAgencyOrgidMissionCollaboration.noOpenTasks']);
  });
});
