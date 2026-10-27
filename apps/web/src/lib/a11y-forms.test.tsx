import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MissionState } from '@visastack/core';
import type { AiProviderConfig } from '@visastack/services';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from './axe.test-support';
import { fixtureDocumentGroups, fixtureFieldGroups, fixtureView } from './master-profile-fixture';
import './next-mocks.test-support';

/**
 * Every form and action button is rendered the way a person meets it (waiting for
 * input, working, and failed, with and without a named field at fault) and the markup is
 * put through the accessibility scan. The server actions are replaced by stand-ins that do
 * nothing: this checks what the screen is made of, not what the server does.
 *
 * It does not claim more than it can see. Colour contrast and layout need a browser, and
 * a scan finds structural faults, not whether a screen reader user can finish the task.
 */

const mocked = vi.hoisted(() => ({
  /** What `useActionState` reports while a case is being checked; `undefined` = the real hook. */
  forced: undefined as
    | undefined
    | { state: { ok: boolean; message: string; field?: string }; pending: boolean },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: ((...args: Parameters<typeof actual.useActionState>) =>
      mocked.forced
        ? [mocked.forced.state, () => undefined, mocked.forced.pending]
        : actual.useActionState(...args)) as typeof actual.useActionState,
  };
});

const standIn = vi.hoisted(
  () => () =>
    new Proxy(
      {},
      {
        has: () => true,
        get: (_target, key) =>
          key === 'then' ? undefined : async () => ({ ok: true, message: '' }),
      },
    ),
);
vi.mock('../app/app/actions', standIn);
vi.mock('../app/app/admin/actions', standIn);
vi.mock('../app/app/admin/ai-settings/actions', standIn);
vi.mock('../app/app/admin/document-protection/actions', standIn);
vi.mock('../app/app/admin/complaints/actions', standIn);
vi.mock('../app/app/admin/organizations/[orgId]/actions', standIn);
vi.mock('../app/app/admin/packs/actions', standIn);
vi.mock('../app/app/agency/actions', standIn);
vi.mock('../app/app/agency/[orgId]/actions', standIn);
vi.mock('../app/app/applicant/[id]/actions', standIn);
vi.mock('../app/app/applicant/[id]/section-actions', standIn);
vi.mock('../app/app/applicant/[id]/evidence/actions', standIn);
vi.mock('../app/app/applicant/[id]/missions/actions', standIn);
vi.mock('../app/app/applicant/[id]/sharing/actions', standIn);
vi.mock('../app/app/client-invitations/accept/actions', standIn);
vi.mock('../app/app/contributor-requests/accept/actions', standIn);
vi.mock('../app/app/invitations/accept/actions', standIn);
vi.mock('../app/app/mission/[id]/actions', standIn);
vi.mock('../app/app/mission/[id]/snapshots/[snapshotId]/actions', standIn);
vi.mock('../app/app/privacy/actions', standIn);
vi.mock('../app/app/staff-code/actions', standIn);

const { AddApplicantForm } = await import('../app/app/add-applicant-form');
const { ConsentButton } = await import('../app/app/consent-button');
const adminButtons = await import('../app/app/admin/action-buttons');
const adminForms = await import('../app/app/admin/admin-forms');
const aiSettings = await import('../app/app/admin/ai-settings/forms');
const protectionForms = await import('../app/app/admin/document-protection/forms');
const staffCodeForms = await import('../app/app/staff-code/forms');
const complaintForms = await import('../app/app/admin/complaints/forms');
const organisationForms = await import('../app/app/admin/organizations/[orgId]/forms');
const packForms = await import('../app/app/admin/packs/pack-forms');
const packVersionButtons = await import('../app/app/admin/packs/pack-version-buttons');
const { PurgeButton } = await import('../app/app/admin/purge-button');
const { ReconcileButtons } = await import('../app/app/admin/reconcile-buttons');
const { BrandingForm } = await import('../app/app/agency/[orgId]/branding-form');
const { ClientInvitationForm } = await import('../app/app/agency/[orgId]/client-invitation-form');
const { ClientInvitationRevokeButton } = await import(
  '../app/app/agency/[orgId]/client-invitation-revoke-button'
);
const { EvidenceRequestActions } = await import(
  '../app/app/agency/[orgId]/evidence-request-actions'
);
const { InvitationRevokeButton } = await import(
  '../app/app/agency/[orgId]/invitation-revoke-button'
);
const { AddMemberForm } = await import('../app/app/agency/[orgId]/member-form');
const { MemberToggleButton } = await import('../app/app/agency/[orgId]/member-toggle-button');
const { MissionCollaboration } = await import('../app/app/agency/[orgId]/mission-collaboration');
const { RequestEvidenceForm } = await import('../app/app/agency/[orgId]/request-evidence-form');
const { DocumentTypeForm } = await import('../app/app/applicant/[id]/document-type-form');
const { RequireDifferentReviewerToggle } = await import(
  '../app/app/agency/[orgId]/require-different-reviewer-toggle'
);
const { CreateOrgForm } = await import('../app/app/agency/create-org-form');
const aiReview = await import('../app/app/applicant/[id]/ai-review');
const { DocumentUploader } = await import('../app/app/applicant/[id]/document-uploader');
const { SubmitResponseForm } = await import(
  '../app/app/applicant/[id]/evidence/submit-response-form'
);
const { CreateMissionForm } = await import(
  '../app/app/applicant/[id]/missions/create-mission-form'
);
const { PrepareAgainForm } = await import(
  '../app/app/applicant/[id]/missions/prepare-again/prepare-again-form'
);
const { NameReview } = await import('../app/app/applicant/[id]/name-review');
const { DocumentSuggestionCard } = await import(
  '../app/app/applicant/[id]/document-suggestion-card'
);
const { ProfileEditor } = await import('../app/app/applicant/[id]/profile-editor');
const { GrantForm } = await import('../app/app/applicant/[id]/sharing/grant-form');
const { GrantOpButtons } = await import('../app/app/applicant/[id]/sharing/grant-op-buttons');
const { ScopeExpansionForm } = await import(
  '../app/app/applicant/[id]/sharing/scope-expansion-form'
);
const { CaseExceptions } = await import('../app/app/applicant/[id]/sharing/case-exceptions');
vi.mock('../app/app/sharing-invitations/accept/actions', standIn);
const { AcceptSharingInvitationForm } = await import(
  '../app/app/sharing-invitations/accept/accept-form'
);
const { AcceptClientInvitationForm } = await import(
  '../app/app/client-invitations/accept/accept-form'
);
const { ConsentGate } = await import('../app/app/client-invitations/accept/consent-gate');
const { SubmitEvidenceForm } = await import(
  '../app/app/contributor-requests/accept/submit-evidence-form'
);
const { AcceptInvitationForm } = await import('../app/app/invitations/accept/accept-form');
const { AttachPackForm } = await import('../app/app/mission/[id]/attach-pack-form');
const collaborationPanels = await import('../app/app/mission/[id]/collaboration-panels');
const complaintFeedbackPanels = await import('../app/app/mission/[id]/complaint-feedback-panel');
const { ContributorRequestsPanel } = await import(
  '../app/app/mission/[id]/contributor-requests-panel'
);
const missionButtons = await import('../app/app/mission/[id]/mission-buttons');
const { OutcomePanel } = await import('../app/app/mission/[id]/outcome-panel');
const { ExplainGapButton } = await import('../app/app/mission/[id]/readiness-gap-explain');
const { AcknowledgementPanel } = await import(
  '../app/app/mission/[id]/snapshots/[snapshotId]/acknowledgement-panel'
);
const { SubmissionReportPanel } = await import('../app/app/mission/[id]/submission-report-panel');
const { DeletionPanel } = await import('../app/app/privacy/deletion-panel');
const { LargeExportPanel } = await import('../app/app/privacy/large-export-panel');

interface Case {
  readonly name: string;
  readonly element: () => ReactElement;
  /** Inputs the form's own errors can point at (the ones its server action can report). */
  readonly fields?: readonly string[];
  /** The component appears once per row on a page, so two of them must not clash. */
  readonly repeated?: boolean;
}

const PLANS = [
  { id: 'p1', name: 'Starter' },
  { id: 'p2', name: 'Agency' },
];
const APPLICANTS = [
  { id: 'a1', displayName: 'Rahim Uddin' },
  { id: 'a2', displayName: 'Nusrat Jahan' },
];
const DOCUMENTS = [
  { id: 'd1', displayName: 'Passport' },
  { id: 'd2', displayName: 'Bank Statement' },
];

/** A different id each time, so two copies of a row component do not share one. */
let rows = 0;
const rowId = () => `row-${++rows}`;
const row = (name: string, element: () => ReactElement): Case => ({
  name,
  element,
  repeated: true,
});

const PEOPLE: readonly Case[] = [
  {
    name: 'add a person',
    element: () => <AddApplicantForm />,
    fields: ['displayName', 'authorityConfirmed'],
  },
  row('consent switch (off)', () => (
    <ConsentButton type="CORE_PROCESSING" granted={false} locale="en" label="Core processing" />
  )),
  row('consent switch (on)', () => (
    <ConsentButton type="SHARING" granted locale="en" label="Sharing" />
  )),
  { name: 'accept an invitation', element: () => <AcceptInvitationForm token="t1" /> },
  {
    name: 'personal sharing invitation acceptance',
    element: () => <AcceptSharingInvitationForm token="synthetic-token" />,
  },
  {
    name: 'accept a client invitation',
    element: () => <AcceptClientInvitationForm token="t1" applicants={APPLICANTS} />,
  },
  { name: 'consent choices on an invitation', element: () => <ConsentGate core={false} sharing /> },
  {
    name: 'send a document someone asked for',
    element: () => <SubmitEvidenceForm token="t1" docType="BANK_STATEMENT" />,
  },
  { name: 'create an organisation', element: () => <CreateOrgForm /> },
];

const DOCS: readonly Case[] = [
  {
    name: 'upload a document',
    element: () => <DocumentUploader applicantId="a1" limitLabel="5 MB" />,
    fields: ['file'],
  },
  row('review a suggested file name', () => (
    <NameReview
      applicantId="a1"
      nameVersionId="n1"
      originalName="scan001.pdf"
      proposedName="passport-main-page.pdf"
      classification={{ classifiedType: 'PASSPORT', confidence: 0.92, reviewRequired: false }}
    />
  )),
  row('review a suggested file name (no type guess)', () => (
    <NameReview
      applicantId="a1"
      nameVersionId="n2"
      originalName="IMG_20240101.jpg"
      proposedName="document.jpg"
      classification={null}
    />
  )),
  row('check the suggested kind and name', () => (
    <DocumentSuggestionCard
      applicantId="a1"
      groups={fixtureDocumentGroups}
      protectedKinds={['PASSPORT']}
      suggestion={{
        documentId: 'd1',
        nameVersionId: 'n1',
        typeProposalId: 'k1',
        kind: 'BANK_STATEMENT',
        kindLabel: 'Bank Statement',
        recordGroup: 'Money',
        source: 'ai',
        clear: true,
        proposedName: 'Bank Statement - Anna Eriksson.pdf',
        nameAfterKind: ' - Anna Eriksson.pdf',
        protectedNow: true,
        removesFreshSignIn: true,
      }}
    />
  )),
  row('choose a kind and name for a document', () => (
    <DocumentSuggestionCard
      applicantId="a1"
      groups={fixtureDocumentGroups}
      protectedKinds={['PASSPORT']}
      suggestion={{
        documentId: 'd2',
        nameVersionId: 'n2',
        typeProposalId: null,
        kind: null,
        kindLabel: null,
        recordGroup: null,
        source: 'rules',
        clear: false,
        proposedName: 'Document - Anna Eriksson.pdf',
        nameAfterKind: ' - Anna Eriksson.pdf',
        protectedNow: true,
        removesFreshSignIn: true,
      }}
    />
  )),
  row('read a document with the text reader', () => (
    <aiReview.OcrResultView
      text="Sample text from the page."
      reviewIssues={['Low contrast in the lower half']}
      usedFallback
    />
  )),
  row('run the field reader', () => (
    <aiReview.RunAiExtractionButton applicantId="a1" documentVersionId="v1" />
  )),
  row('run the text reader', () => (
    <aiReview.RunOcrButton applicantId="a1" documentVersionId="v1" />
  )),
  row('run the document type check', () => (
    <aiReview.RunClassificationButton applicantId="a1" documentVersionId="v1" />
  )),
  row('run the consistency check', () => (
    <aiReview.RunInconsistencyCheckButton applicantId="a1" documentVersionId="v1" />
  )),
  row('review a suggested value', () => (
    <aiReview.AiProposalReview
      applicantId="a1"
      canApprove
      proposal={{
        id: 'pr1',
        type: 'FIELD',
        fieldKey: 'passport_number',
        value: 'A1234567',
        confidence: 0.88,
        rationale: 'Read from the data page.',
        evidence: [{ snippet: 'P<BGDUDDIN<<RAHIM', verified: true }],
      }}
    />
  )),
  row('review a suggested value (cannot approve yet)', () => (
    <aiReview.AiProposalReview
      applicantId="a1"
      canApprove={false}
      proposal={{
        id: 'pr2',
        type: 'FIELD',
        fieldKey: null,
        value: null,
        confidence: 0.4,
        rationale: null,
        evidence: [],
      }}
    />
  )),
  row('check what we found in a document', () => (
    <aiReview.DocumentFindings
      applicantId="a1"
      canApprove
      proposals={[
        {
          id: 'pr3',
          type: 'NEW',
          fieldKey: 'given_name',
          fieldLabel: 'Given Name',
          value: 'Ayesha',
          confidence: 95,
          rationale: null,
          evidence: [{ snippet: 'Ayesha', verified: true }],
          clear: true,
        },
        {
          id: 'pr4',
          type: 'NEW',
          fieldKey: 'occupation',
          fieldLabel: 'Occupation',
          value: 'Engineer',
          confidence: 95,
          rationale: null,
          evidence: [{ snippet: 'Engineer', verified: true }],
          clear: true,
        },
        {
          id: 'pr5',
          type: 'NEW',
          fieldKey: 'city',
          fieldLabel: 'City',
          value: 'Dhaka',
          confidence: 90,
          rationale: null,
          evidence: [{ snippet: 'Dhaka', verified: true }],
          clear: true,
          difference: { current: 'Chittagong' },
        },
      ]}
    />
  )),
  row('review a mismatch flag', () => (
    <aiReview.InconsistencyFlagReview
      applicantId="a1"
      flag={{
        id: 'f1',
        description: 'The surname differs between two documents.',
        confidence: 0.7,
        rationale: 'Spelling differs.',
      }}
    />
  )),
  row('review a suggested document type', () => (
    <aiReview.DocumentTypeProposalReview
      applicantId="a1"
      canApprove
      proposal={{
        id: 'dt1',
        suggestedType: 'BANK_STATEMENT',
        confidence: 0.81,
        rationale: 'Account table found.',
      }}
    />
  )),
  {
    name: 'answer an evidence request with a profile value',
    element: () => (
      <SubmitResponseForm
        applicantId="a1"
        requestId="r1"
        kind="FIELD"
        candidateFacts={[
          { factId: 'f1', value: 'A1234567' },
          { factId: 'f2', value: 'B7654321' },
        ]}
        candidateDocuments={[]}
      />
    ),
  },
  {
    name: 'answer an evidence request with a document',
    element: () => (
      <SubmitResponseForm
        applicantId="a1"
        requestId="r2"
        kind="DOCUMENT"
        candidateFacts={[]}
        candidateDocuments={[
          { documentId: 'd1', displayName: 'Passport', usable: true, statusLabel: 'Checked' },
          {
            documentId: 'd2',
            displayName: 'Old statement',
            usable: false,
            statusLabel: 'Out of date',
          },
        ]}
      />
    ),
  },
  {
    name: 'answer an evidence request with nothing to offer',
    element: () => (
      <SubmitResponseForm
        applicantId="a1"
        requestId="r3"
        kind="DOCUMENT"
        candidateFacts={[]}
        candidateDocuments={[]}
      />
    ),
  },
];

const PROFILE: readonly Case[] = [
  {
    name: 'profile editor (empty)',
    element: () => (
      <ProfileEditor
        applicantId="a1"
        values={{}}
        repeatingValues={{}}
        assurance={new Map()}
        view={fixtureView()}
      />
    ),
    fields: ['value', 'effectiveFrom'],
  },
  {
    name: 'profile editor (with values and assurance)',
    element: () => (
      <ProfileEditor
        applicantId="a1"
        values={{
          given_name: {
            factId: 'f1',
            value: 'Rahim',
            status: 'CONFIRMED',
            updatedAt: '2025-01-02T00:00:00Z',
          },
          passport_number: {
            factId: 'f2',
            value: 'A1234567',
            status: 'DECLARED',
            effectiveFrom: '2024-01-01',
          },
        }}
        repeatingValues={{}}
        view={fixtureView()}
        assurance={
          new Map([
            [
              'f2',
              {
                applicantDeclared: true,
                documentSupplied: true,
                machineChecks: [
                  {
                    name: 'Checksum',
                    passed: true,
                    detail: null,
                    performedAt: '2025-01-03T00:00:00Z',
                  },
                ],
                agencyReviews: [
                  {
                    missionTitle: 'UK visit',
                    outcome: 'ACCEPTED',
                    reason: null,
                    decidedAt: '2025-02-01T00:00:00Z',
                  },
                ],
                issuerConfirmations: [],
                tier: 'E2',
              },
            ],
          ])
        }
      />
    ),
    fields: ['value', 'effectiveFrom'],
  },
];

const SHARING: readonly Case[] = [
  {
    name: 'share with someone',
    element: () => <GrantForm applicantId="a1" documents={DOCUMENTS} />,
  },
  row('pause, resume or stop a share', () => (
    <GrantOpButtons
      applicantId="a1"
      grantId="g1"
      ops={[
        { op: 'pause', label: 'Pause', variant: 'secondary' },
        { op: 'revoke', label: 'Stop sharing', variant: 'danger' },
      ]}
    />
  )),
  {
    name: 'widen a share to new documents',
    element: () => <ScopeExpansionForm applicantId="a1" grantId="g1" candidates={DOCUMENTS} />,
  },
  row('allow a case an all-cases share leaves out', () => (
    <CaseExceptions
      applicantId="a1"
      grantId="g1"
      recipientLabel="Agency A"
      exceptions={[
        { missionId: 'm2', title: 'Japan trip 2026' },
        { missionId: 'm3', title: 'Canada study', sharedSeparately: true },
      ]}
    />
  )),
];

const CASES_MISSION: readonly Case[] = [
  { name: 'start a case', element: () => <CreateMissionForm applicantId="a1" /> },
  {
    name: 'prepare a case again',
    element: () => (
      <PrepareAgainForm
        applicantId="a1"
        fromMissionId="m1"
        defaultTitle="Japan trip 2025"
        expectedPackVersionId="pv1"
        checklistNote="Checklist: Japan (version 2)."
        groups={[
          {
            key: 'REUSABLE',
            title: 'Reusable',
            hint: 'Current records your new case can use.',
            tone: 'success',
            items: [
              {
                id: 'r1',
                label: 'Passport Number',
                reason: 'Used in your last case and still current.',
                optional: false,
                records: [
                  { value: 'r1|f|f1', label: 'A1234567', carriable: true, preselected: true },
                ],
              },
            ],
          },
          {
            key: 'NEEDS_REVIEW',
            title: 'Needs Refreshing or Review',
            hint: 'Nothing here is reused until you check it.',
            tone: 'warning',
            items: [
              {
                id: 'r2',
                label: 'Bank Statement',
                reason: 'Older than this route allows.',
                optional: false,
                records: [
                  { value: 'r2|d|d1', label: 'bank.pdf', carriable: false, preselected: false },
                ],
              },
            ],
          },
          { key: 'MISSING', title: 'Missing', hint: 'Still needed.', tone: 'neutral', items: [] },
        ]}
        sharingQuestions={[
          {
            kind: 'grant',
            id: 'g1',
            recipient: 'Agency A',
            purpose: 'collaboration',
            pending: false,
          },
          {
            kind: 'invitation',
            id: 'i1',
            recipient: 'p@example.test',
            purpose: 'help',
            pending: true,
          },
        ]}
      />
    ),
  },
  {
    name: 'attach a rule pack to a case',
    element: () => (
      <AttachPackForm
        missionId="m1"
        options={[
          { packVersionId: 'pv1', label: 'UK student v3' },
          { packVersionId: 'pv2', label: 'Schengen v1' },
        ]}
      />
    ),
  },
  {
    name: 'case details',
    element: () => (
      <missionButtons.CaseDetailsForm
        missionId="m1"
        jurisdiction="UK"
        serviceCategory="Student"
        travelStartDate={new Date('2026-09-01T00:00:00Z')}
        travelEndDate={null}
        targetDeadline={new Date('2026-07-15T00:00:00Z')}
        manualMode={false}
      />
    ),
  },
  {
    name: 'case details (empty)',
    element: () => (
      <missionButtons.CaseDetailsForm
        missionId="m1"
        jurisdiction={null}
        serviceCategory={null}
        travelStartDate={null}
        travelEndDate={null}
        targetDeadline={null}
        manualMode
      />
    ),
  },
  {
    name: 'itinerary reference',
    element: () => <missionButtons.ItineraryForm missionId="m1" itineraryRef="PNR-ABC123" />,
  },
  { name: 'save a snapshot', element: () => <missionButtons.SnapshotButton missionId="m1" /> },
  {
    name: 'move a case to its next stage',
    element: () => (
      <missionButtons.TransitionButtons
        missionId="m1"
        nextStates={['IN_PROGRESS', 'READY_FOR_REVIEW'] as unknown as readonly MissionState[]}
      />
    ),
  },
  row('explain a readiness gap', () => (
    <ExplainGapButton missionId="m1" packRequirementId="req1" explanation={null} />
  )),
  row('explain a readiness gap (already explained)', () => (
    <ExplainGapButton
      missionId="m1"
      packRequirementId="req2"
      explanation="Your passport expires within six months."
    />
  )),
  {
    name: 'tasks',
    element: () => (
      <collaborationPanels.TasksPanel
        missionId="m1"
        tasks={[
          {
            id: 't1',
            description: 'Book the biometrics visit',
            status: 'OPEN',
            priority: 'HIGH',
            dueDate: '2026-05-01',
            dueTimezone: 'Asia/Dhaka',
          },
          {
            id: 't2',
            description: 'Print the cover letter',
            status: 'DONE',
            priority: 'LOW',
            dueDate: null,
            dueTimezone: null,
          },
        ]}
      />
    ),
  },
  {
    name: 'tasks (none yet)',
    element: () => <collaborationPanels.TasksPanel missionId="m1" tasks={[]} />,
  },
  {
    name: 'appointments',
    element: () => (
      <collaborationPanels.AppointmentsPanel
        missionId="m1"
        appointments={[
          {
            id: 'ap1',
            title: 'Visa centre',
            localDateTime: '2026-05-02T10:30',
            timezone: 'Asia/Dhaka',
            place: 'Gulshan',
            channel: null,
            status: 'OPEN',
          },
        ]}
      />
    ),
  },
  {
    name: 'appointments (none yet)',
    element: () => <collaborationPanels.AppointmentsPanel missionId="m1" appointments={[]} />,
  },
  {
    name: 'letters',
    element: () => (
      <collaborationPanels.LettersPanel
        missionId="m1"
        canGenerate
        letters={[
          {
            id: 'l1',
            version: 2,
            content: 'To whom it may concern, I am applying for...',
            createdAt: '2026-04-01T09:00:00Z',
          },
        ]}
      />
    ),
  },
  {
    name: 'letters (cannot create yet)',
    element: () => (
      <collaborationPanels.LettersPanel missionId="m1" canGenerate={false} letters={[]} />
    ),
  },
  {
    name: 'choose evidence for each requirement',
    element: () => (
      <collaborationPanels.EvidenceSelectionPanel
        missionId="m1"
        candidates={[
          {
            packRequirementId: 'req1',
            kind: 'DOCUMENT',
            label: 'Valid passport',
            citation: 'Guidance 4.2',
            factCandidates: [],
            documentCandidates: [
              { documentId: 'd1', displayName: 'Passport', eligible: true, staleness: 'fresh' },
              {
                documentId: 'd2',
                displayName: 'Old passport',
                eligible: false,
                staleness: 'stale',
              },
            ],
            selectedFactIds: [],
            selectedDocumentIds: ['d1'],
            selectionIdsByCandidate: { d1: 'sel1' },
          },
          {
            packRequirementId: 'req2',
            kind: 'FIELD',
            label: 'Home address',
            citation: 'Guidance 5.1',
            factCandidates: [
              { factId: 'f1', value: '12 Road, Dhaka', repeatingRecordKey: null, eligible: true },
            ],
            documentCandidates: [],
            selectedFactIds: [],
            selectedDocumentIds: [],
            selectionIdsByCandidate: {},
          },
        ]}
      />
    ),
  },
  {
    name: 'complaints',
    element: () => (
      <complaintFeedbackPanels.ComplaintPanel
        missionId="m1"
        complaints={[
          {
            id: 'c1',
            description: 'The agency missed my appointment.',
            status: 'OPEN',
            resolution: null,
            createdAt: '2026-03-01T09:00:00Z',
            events: [
              {
                id: 'e1',
                fromStatus: null,
                toStatus: 'OPEN',
                note: null,
                createdAt: '2026-03-01T09:00:00Z',
              },
            ],
          },
        ]}
      />
    ),
  },
  {
    name: 'complaints (none yet)',
    element: () => <complaintFeedbackPanels.ComplaintPanel missionId="m1" complaints={[]} />,
  },
  {
    name: 'feedback',
    element: () => (
      <complaintFeedbackPanels.FeedbackPanel
        missionId="m1"
        canSubmit
        feedback={[{ id: 'fb1', comments: 'Clear and quick.', createdAt: '2026-03-02T09:00:00Z' }]}
      />
    ),
  },
  {
    name: 'feedback (cannot submit yet)',
    element: () => (
      <complaintFeedbackPanels.FeedbackPanel missionId="m1" canSubmit={false} feedback={[]} />
    ),
  },
  {
    name: 'documents asked of other people',
    element: () => (
      <ContributorRequestsPanel
        missionId="m1"
        requests={[
          {
            id: 'cr1',
            contributorEmail: 'employer@example.com',
            docType: 'EMPLOYMENT_LETTER',
            purpose: 'Proof of employment',
            status: 'PENDING',
            expiresAt: '2026-06-01T00:00:00Z',
          },
          {
            id: 'cr2',
            contributorEmail: 'sponsor@example.com',
            docType: 'BANK_STATEMENT',
            purpose: 'Sponsor funds',
            status: 'RECEIVED',
            expiresAt: '2026-06-01T00:00:00Z',
          },
        ]}
      />
    ),
  },
  {
    name: 'outcome of an application',
    element: () => (
      <OutcomePanel
        missionId="m1"
        evidenceOptions={DOCUMENTS.map((d) => ({ documentId: d.id, displayName: d.displayName }))}
        outcomes={[
          {
            id: 'o1',
            decision: 'APPROVED',
            decisionDate: '2026-05-20',
            officialWording: 'Granted for 6 months.',
            agencyInterpretation: null,
            createdAt: '2026-05-21T09:00:00Z',
          },
        ]}
      />
    ),
  },
  {
    name: 'outcome of an application (none yet)',
    element: () => <OutcomePanel missionId="m1" evidenceOptions={[]} outcomes={[]} />,
  },
  {
    name: 'submission report',
    element: () => (
      <SubmissionReportPanel
        missionId="m1"
        eligible
        submissions={[
          {
            id: 's1',
            channel: 'Online portal',
            externalReportDescription: 'Submitted with all pages',
            externalReference: 'REF-1',
            submittedAt: '2026-05-10T09:00:00Z',
          },
        ]}
      />
    ),
  },
  {
    name: 'submission report (not allowed yet)',
    element: () => <SubmissionReportPanel missionId="m1" eligible={false} submissions={[]} />,
  },
  {
    name: 'acknowledge a snapshot',
    element: () => (
      <AcknowledgementPanel
        missionId="m1"
        snapshotId="s1"
        checksum="9f2c1ab"
        history={[
          {
            id: 'h1',
            decision: 'CORRECTION_REQUESTED',
            reason: 'The name is misspelt.',
            createdAt: new Date('2026-04-02T00:00:00Z'),
            invalidatedAt: new Date('2026-04-03T00:00:00Z'),
          },
          {
            id: 'h2',
            decision: 'ACKNOWLEDGED',
            reason: null,
            createdAt: new Date('2026-04-04T00:00:00Z'),
            invalidatedAt: null,
          },
        ]}
      />
    ),
  },
  {
    name: 'acknowledge a snapshot (first time)',
    element: () => (
      <AcknowledgementPanel missionId="m1" snapshotId="s2" checksum="aa11" history={[]} />
    ),
  },
];

const PRIVACY: readonly Case[] = [
  {
    name: 'delete my account',
    element: () => (
      <DeletionPanel
        scheduledFor={null}
        holds={[]}
        impact={{
          applicants: APPLICANTS,
          missionCount: 2,
          documentCount: 14,
          activePlatformRoleCount: 0,
          authoredMissionNoteCount: 3,
        }}
      />
    ),
  },
  {
    name: 'delete my account (blocked by a legal hold)',
    element: () => (
      <DeletionPanel
        scheduledFor={null}
        impact={{
          applicants: APPLICANTS,
          missionCount: 1,
          documentCount: 3,
          activePlatformRoleCount: 1,
          authoredMissionNoteCount: 0,
        }}
        holds={[
          {
            id: 'h1',
            applicantDisplayName: 'Rahim Uddin',
            reason: 'Open dispute',
            placedAt: '2026-01-02',
            reviewAt: '2026-07-01',
            accessibleTo: ['Compliance team'],
            scope: { kind: 'mission', missionTitle: 'UK visit' },
          },
          {
            id: 'h2',
            applicantDisplayName: 'Nusrat Jahan',
            reason: 'Regulator request',
            placedAt: '2026-02-02',
            reviewAt: null,
            accessibleTo: [],
            scope: { kind: 'applicant' },
          },
        ]}
      />
    ),
  },
  {
    name: 'delete my account (already scheduled)',
    element: () => (
      <DeletionPanel
        scheduledFor="2026-12-01T00:00:00Z"
        holds={[]}
        impact={{
          applicants: [],
          missionCount: 0,
          documentCount: 0,
          activePlatformRoleCount: 0,
          authoredMissionNoteCount: 0,
        }}
      />
    ),
  },
  { name: 'large export (nothing requested)', element: () => <LargeExportPanel jobs={[]} /> },
  {
    name: 'large export (every state)',
    element: () => (
      <LargeExportPanel
        jobs={[
          {
            id: 'j1',
            status: 'READY',
            createdAt: '2026-05-01T09:00:00Z',
            readyAt: '2026-05-01T09:05:00Z',
            expiresAt: '2026-05-02T09:05:00Z',
            lastError: null,
          },
          {
            id: 'j2',
            status: 'PENDING',
            createdAt: '2026-05-01T09:00:00Z',
            readyAt: null,
            expiresAt: null,
            lastError: null,
          },
          {
            id: 'j3',
            status: 'FAILED',
            createdAt: '2026-04-01T09:00:00Z',
            readyAt: null,
            expiresAt: null,
            lastError: 'Storage unavailable',
          },
          {
            id: 'j4',
            status: 'EXPIRED',
            createdAt: '2026-03-01T09:00:00Z',
            readyAt: '2026-03-01T09:05:00Z',
            expiresAt: '2026-03-02T09:05:00Z',
            lastError: null,
          },
        ]}
      />
    ),
  },
];

const AGENCY: readonly Case[] = [
  {
    name: 'agency branding',
    element: () => (
      <BrandingForm
        organizationId="o1"
        name="Skyline Visa Services"
        accentColor="#1a5fb4"
        logoUrl="/api/branding/logo/00000000-0000-4000-8000-000000000001?v=abc"
      />
    ),
  },
  {
    name: 'agency branding (unset)',
    element: () => (
      <BrandingForm organizationId="o1" name="Skyline" accentColor={null} logoUrl={null} />
    ),
  },
  {
    name: 'invite a client',
    element: () => (
      <ClientInvitationForm
        organizationId="o1"
        members={[
          { accountId: 'm1', email: 'staff@example.com', active: true },
          { accountId: 'm2', email: 'former@example.com', active: false },
        ]}
      />
    ),
  },
  row('withdraw a client invitation', () => (
    <ClientInvitationRevokeButton organizationId="o1" invitationId="i1" />
  )),
  row('withdraw a staff invitation', () => (
    <InvitationRevokeButton organizationId="o1" invitationId="i1" />
  )),
  { name: 'add a team member', element: () => <AddMemberForm organizationId="o1" /> },
  row('switch a team member on or off (active)', () => (
    <MemberToggleButton organizationId="o1" membershipId="m1" active />
  )),
  row('switch a team member on or off (inactive)', () => (
    <MemberToggleButton organizationId="o1" membershipId="m2" active={false} />
  )),
  row('require a different reviewer (on)', () => (
    <RequireDifferentReviewerToggle organizationId="o1" required />
  )),
  row('require a different reviewer (off)', () => (
    <RequireDifferentReviewerToggle organizationId="o1" required={false} />
  )),
  row('evidence request actions (waiting)', () => (
    <EvidenceRequestActions organizationId="o1" requestId="r1" status="PENDING" />
  )),
  row('evidence request actions (received)', () => (
    <EvidenceRequestActions organizationId="o1" requestId="r2" status="RECEIVED" />
  )),
  {
    name: 'ask for evidence',
    element: () => (
      <RequestEvidenceForm
        organizationId="o1"
        fieldGroups={fixtureFieldGroups}
        documentGroups={fixtureDocumentGroups}
        applicants={[{ applicantId: 'a1', displayName: 'Rahim Uddin' }]}
        missions={[{ missionId: 'm1', title: 'UK visit', applicantName: 'Rahim Uddin' }]}
      />
    ),
  },
  {
    name: 'say what kind of document this is',
    element: () => (
      <DocumentTypeForm
        applicantId="a1"
        documentId="d1"
        docType="OTHER"
        subject="Marriage Certificate"
        groups={fixtureDocumentGroups}
      />
    ),
  },
  {
    name: 'ask for evidence (no cases yet)',
    element: () => (
      <RequestEvidenceForm
        organizationId="o1"
        fieldGroups={fixtureFieldGroups}
        documentGroups={fixtureDocumentGroups}
        applicants={[{ applicantId: 'a1', displayName: 'Rahim Uddin' }]}
      />
    ),
  },
  {
    name: 'team case workspace',
    element: () => (
      <MissionCollaboration
        organizationId="o1"
        missionId="m1"
        applicantId="a1"
        title="UK visit"
        applicantName="Rahim Uddin"
        viewerAssigned
        members={[
          { accountId: 'u1', email: 'staff@example.com' },
          { accountId: 'u2', email: 'lead@example.com' },
        ]}
        assignments={[{ id: 'as1', memberAccountId: 'u1', memberEmail: 'staff@example.com' }]}
        notes={[
          {
            id: 'n1',
            body: 'Called the client.',
            authorEmail: 'staff@example.com',
            createdAt: '2026-04-01T09:00:00Z',
            visibility: 'AGENCY_INTERNAL',
          },
          {
            id: 'n2',
            body: 'Please send the bank letter.',
            authorEmail: 'lead@example.com',
            createdAt: '2026-04-02T09:00:00Z',
            visibility: 'TRAVELLER_SHARED',
          },
        ]}
        tasks={[
          {
            id: 't1',
            description: 'Check passport validity',
            status: 'OPEN',
            priority: 'NORMAL',
            assigneeAccountId: 'u1',
            dueDate: '2026-05-01',
          },
        ]}
        appointments={[
          {
            id: 'ap1',
            title: 'Biometrics',
            localDateTime: '2026-05-02T10:30',
            timezone: 'Asia/Dhaka',
            place: 'Gulshan',
            channel: null,
            status: 'OPEN',
          },
        ]}
        requirements={[
          { id: 'req1', label: 'Valid passport' },
          { id: 'req2', label: 'Bank Statement' },
        ]}
        decisions={[
          {
            id: 'dc1',
            packRequirementId: 'req1',
            outcome: 'ACCEPTED',
            reason: null,
            createdAt: '2026-04-03T09:00:00Z',
          },
        ]}
        issuerVerifications={[
          {
            id: 'iv1',
            packRequirementId: 'req2',
            issuerIdentity: 'City Bank',
            exactClaim: 'Balance above 5,000',
            response: 'CONFIRMED',
            validUntil: '2026-08-01',
            expired: false,
          },
          {
            id: 'iv2',
            packRequirementId: 'req1',
            issuerIdentity: 'Passport Office',
            exactClaim: 'Passport is valid',
            response: 'CONFIRMED',
            validUntil: '2025-01-01',
            expired: true,
          },
        ]}
      />
    ),
  },
  {
    name: 'team case workspace (empty, not assigned)',
    element: () => (
      <MissionCollaboration
        organizationId="o1"
        missionId="m2"
        applicantId="a2"
        title="Schengen trip"
        applicantName="Nusrat Jahan"
        viewerAssigned={false}
        members={[]}
        assignments={[]}
        notes={[]}
        tasks={[]}
        appointments={[]}
        requirements={[]}
        decisions={[]}
        issuerVerifications={[]}
      />
    ),
  },
];

const ADMIN: readonly Case[] = [
  row('release a legal hold', () => <adminButtons.ReleaseHoldButton holdId={rowId()} />),
  row('retry a job', () => <adminButtons.RetryJobButton jobId={rowId()} />),
  row('retry an erasure job', () => <adminButtons.RetryErasureJobButton jobId={rowId()} />),
  row('revoke a role', () => <adminButtons.RevokeRoleButton grantId={rowId()} />),
  row('reset an authenticator', () => (
    <adminButtons.ResetAuthenticatorButton targetAccountId={rowId()} />
  )),
  row('turn on the authenticator app', () => (
    <staffCodeForms.ConfirmEnrolmentForm returnTo="/app/admin" />
  )),
  row('make new backup codes', () => <staffCodeForms.RegenerateCodesForm returnTo="/app/admin" />),
  row('revoke an invitation', () => <adminButtons.RevokeInvitationButton invitationId={rowId()} />),
  row('approve or reject an organisation', () => (
    <adminButtons.OrgReviewButtons organizationId={rowId()} />
  )),
  row('suspend an organisation', () => <adminButtons.OrgSuspendButton organizationId={rowId()} />),
  row('terminate an organisation', () => (
    <adminButtons.OrgTerminateButton organizationId={rowId()} />
  )),
  { name: 'invite a staff member', element: () => <adminForms.InviteForm /> },
  { name: 'grant a platform role', element: () => <adminForms.GrantRoleForm /> },
  { name: 'retention policy', element: () => <adminForms.RetentionPolicyForm /> },
  {
    name: 'place a legal hold',
    element: () => <adminForms.LegalHoldForm applicants={APPLICANTS} />,
  },
  {
    name: 'new AI configuration',
    element: () => (
      <aiSettings.CreateDraftConfigForm
        existingConfigs={[
          {
            id: 'c1',
            provider: 'openai',
            model: 'gpt-x',
            status: 'ACTIVE',
          } as unknown as AiProviderConfig,
        ]}
      />
    ),
  },
  {
    name: 'new AI configuration (first one)',
    element: () => <aiSettings.CreateDraftConfigForm existingConfigs={[]} />,
  },
  row('test an AI connection', () => <aiSettings.TestConnectionButton configId={rowId()} />),
  row('run an AI evaluation', () => <aiSettings.RunEvaluationButton configId={rowId()} />),
  row('activate an AI configuration', () => <aiSettings.ActivateConfigButton configId={rowId()} />),
  { name: 'roll back the AI configuration', element: () => <aiSettings.RollbackConfigButton /> },
  { name: 'switch AI off in an emergency', element: () => <aiSettings.EmergencyDisableButton /> },
  row('revoke an AI key', () => <aiSettings.RevokeKeyButton configId={rowId()} />),
  row('record AI provider data terms', () => <aiSettings.RecordTermsForm configId={rowId()} />),
  {
    name: 'turn the AI data setting on',
    element: () => <aiSettings.DataRuleForm requireNoTraining={false} />,
  },
  {
    name: 'turn the AI data setting off',
    element: () => <aiSettings.DataRuleForm requireNoTraining={true} />,
  },
  {
    ...row('document protection switch (on)', () => (
      <protectionForms.ProtectionSwitch
        scope="CATEGORY"
        switchKey="medical"
        name="Medical"
        restricted
        defaultRestricted
        overridden={false}
      />
    )),
    fields: ['reason'],
  },
  row('document protection switch (off, changed by an admin)', () => (
    <protectionForms.ProtectionSwitch
      scope="UNKNOWN_TYPE"
      switchKey="unknown"
      name="Documents Not Sorted Yet"
      restricted={false}
      defaultRestricted
      overridden
      offWarning="These could be passports."
    />
  )),
  row('assign a complaint', () => <complaintForms.AssignComplaintForm complaintId={rowId()} />),
  row('update a complaint (open)', () => (
    <complaintForms.UpdateComplaintStatusForm complaintId={rowId()} currentStatus="OPEN" />
  )),
  row('update a complaint (closed)', () => (
    <complaintForms.UpdateComplaintStatusForm complaintId={rowId()} currentStatus="CLOSED" />
  )),
  {
    name: 'activate a plan',
    element: () => <organisationForms.ActivatePlanForm organizationId="o1" plans={PLANS} />,
  },
  {
    name: 'end a subscription',
    element: () => <organisationForms.EndSubscriptionButton organizationId="o1" />,
  },
  {
    name: 'schedule a downgrade',
    element: () => <organisationForms.ScheduleDowngradeForm organizationId="o1" plans={PLANS} />,
  },
  {
    name: 'cancel a downgrade',
    element: () => <organisationForms.CancelDowngradeButton organizationId="o1" downgradeId="d1" />,
  },
  {
    name: 'open a billing account',
    element: () => <organisationForms.OpenBillingAccountForm organizationId="o1" />,
  },
  {
    name: 'change billing status',
    element: () => (
      <organisationForms.TransitionBillingStatusForm
        organizationId="o1"
        legalStatuses={['ACTIVE', 'PAST_DUE', 'CLOSED']}
      />
    ),
  },
  {
    name: 'change billing status (none allowed)',
    element: () => (
      <organisationForms.TransitionBillingStatusForm organizationId="o1" legalStatuses={[]} />
    ),
  },
  {
    name: 'create an invoice',
    element: () => <organisationForms.CreateInvoiceForm organizationId="o1" plans={PLANS} />,
  },
  row('record a payment', () => (
    <organisationForms.RecordPaymentForm
      organizationId="o1"
      invoiceId={rowId()}
      currency="BDT"
      idempotencyKey="6f1c2d1e-8a54-4c8f-9d55-0a1b2c3d4e5f"
    />
  )),
  row('void an invoice', () => (
    <organisationForms.VoidInvoiceButton organizationId="o1" invoiceId={rowId()} />
  )),
  {
    name: 'grant an override',
    element: () => <organisationForms.GrantOverrideForm organizationId="o1" />,
  },
  row('revoke an override', () => (
    <organisationForms.RevokeOverrideButton organizationId="o1" overrideId={rowId()} />
  )),
  { name: 'create a rule pack', element: () => <packForms.CreatePackForm /> },
  {
    name: 'add a requirement',
    element: () => <packForms.AddRequirementForm packId="pk1" packVersionId="pv1" />,
  },
  {
    name: 'record a requirement source review',
    element: () => (
      <packForms.RequirementSourceReviewForm
        packId="pk1"
        requirementId="req1"
        sourceUrl="https://example.gov/requirements"
        sourceTitle="Official requirements"
        publisher="Immigration authority"
        observedDate="2026-10-01"
      />
    ),
  },
  {
    name: 'verify a checksum',
    element: () => <packForms.VerifyChecksumForm packVersionId="pv1" />,
  },
  {
    name: 'public guidance for a pack',
    element: () => (
      <packForms.PublicTrustContentForm
        packId="pk1"
        packVersionId="pv1"
        routeDescription="Student route"
        officialFeeMinorUnits={36400}
        officialFeeCurrency="GBP"
        officialChannelName="Home Office"
        officialChannelUrl="https://example.gov/apply"
        officialReportingUrl="https://example.gov/report"
      />
    ),
  },
  {
    name: 'public guidance for a pack (empty)',
    element: () => (
      <packForms.PublicTrustContentForm
        packId="pk1"
        packVersionId="pv1"
        routeDescription={null}
        officialFeeMinorUnits={null}
        officialFeeCurrency={null}
        officialChannelName={null}
        officialChannelUrl={null}
        officialReportingUrl={null}
      />
    ),
  },
  { name: 'document expiry policy', element: () => <packForms.SetDocumentExpiryPolicyForm /> },
  {
    name: 'open a pack version',
    element: () => <packVersionButtons.OpenVersionButton packId="pk1" />,
  },
  row('approve a pack version', () => (
    <packVersionButtons.ApproveVersionButton packId="pk1" packVersionId={rowId()} />
  )),
  row('publish a pack version', () => (
    <packVersionButtons.PublishVersionButton packId="pk1" packVersionId={rowId()} />
  )),
  row('withdraw a pack version', () => (
    <packVersionButtons.WithdrawVersionButton packId="pk1" packVersionId={rowId()} />
  )),
  row('publish public guidance (unpublished)', () => (
    <packVersionButtons.PublicTrustPublishButton
      packId="pk1"
      packVersionId={rowId()}
      published={false}
    />
  )),
  row('publish public guidance (published)', () => (
    <packVersionButtons.PublicTrustPublishButton packId="pk1" packVersionId={rowId()} published />
  )),
  row('mark an official fee out of date', () => (
    <packVersionButtons.OfficialFeeStaleButton packId="pk1" packVersionId={rowId()} stale={false} />
  )),
  row('mark an official fee current', () => (
    <packVersionButtons.OfficialFeeStaleButton packId="pk1" packVersionId={rowId()} stale />
  )),
  row('mark a source unreachable', () => (
    <packVersionButtons.SourceInaccessibleButton
      packId="pk1"
      requirementId={rowId()}
      inaccessible={false}
    />
  )),
  row('mark a source reachable', () => (
    <packVersionButtons.SourceInaccessibleButton
      packId="pk1"
      requirementId={rowId()}
      inaccessible
    />
  )),
  { name: 'purge old data', element: () => <PurgeButton eligibleCount={12} /> },
  { name: 'purge old data (nothing to purge)', element: () => <PurgeButton eligibleCount={0} /> },
  { name: 'reconcile', element: () => <ReconcileButtons /> },
];

const CASES: readonly Case[] = [
  ...PEOPLE,
  ...DOCS,
  ...PROFILE,
  ...SHARING,
  ...CASES_MISSION,
  ...PRIVACY,
  ...AGENCY,
  ...ADMIN,
];

type Forced = NonNullable<typeof mocked.forced>;
const STATES: readonly { readonly label: string; readonly forced: Forced | undefined }[] = [
  { label: 'waiting', forced: undefined },
  { label: 'working', forced: { state: { ok: true, message: '' }, pending: true } },
  {
    label: 'failed',
    forced: { state: { ok: false, message: 'Something went wrong. Try again.' }, pending: false },
  },
  { label: 'done', forced: { state: { ok: true, message: 'Saved.' }, pending: false } },
];

function render(item: Case, forced: Forced | undefined): string {
  mocked.forced = forced;
  try {
    // Row-level components are rendered twice in ONE tree, as on a page with two rows, so
    // that ids made for each copy (and any id written into the markup by hand) are compared.
    return renderToStaticMarkup(
      item.repeated ? (
        <>
          {item.element()}
          {item.element()}
        </>
      ) : (
        item.element()
      ),
    );
  } finally {
    mocked.forced = undefined;
  }
}

/**
 * Each case is scanned in four states and the biggest screens (the profile editor has
 * hundreds of fields) take seconds on a fast machine. vitest's default of five seconds is
 * too tight for a slower CI runner, and one timeout used to fail every test after it.
 */
const SCAN_TIMEOUT_MS = 90_000;

const disabledCount = (html: string) => (html.match(/\sdisabled(=|\s|>|\/)/g) ?? []).length;

describe('every form and action button', () => {
  it('has a case for each of the 100-odd components, and no two cases share a name', () => {
    expect(CASES.length).toBeGreaterThan(100);
    const names = CASES.map((c) => c.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it.each(CASES.map((c) => [c.name, c] as const))(
    '%s has no accessibility problems in any state',
    async (_name, item) => {
      const problems: string[] = [];
      for (const { label, forced } of STATES) {
        const html = render(item, forced);
        for (const found of await axeViolations(html)) problems.push(`[${label}] ${found}`);
      }
      expect(problems).toEqual([]);
    },
    SCAN_TIMEOUT_MS,
  );

  it.each(CASES.map((c) => [c.name, c] as const))(
    '%s keeps keyboard focus while it works (nothing becomes disabled)',
    (_name, item) => {
      const waiting = disabledCount(render(item, undefined));
      const working = disabledCount(render(item, STATES[1]?.forced));
      expect(working).toBeLessThanOrEqual(waiting);
    },
  );

  it.each(CASES.filter((c) => c.fields !== undefined).map((c) => [c.name, c] as const))(
    '%s marks the field at fault when its action names one',
    async (_name, item) => {
      let checked = 0;
      for (const field of item.fields ?? []) {
        const html = render(item, {
          state: { ok: false, message: 'Check this field.', field },
          pending: false,
        });
        // Not every named field exists in every state of the screen, so only fields that are
        // rendered have to be marked; at least one of the form's fields must be.
        if (!html.includes(`name="${field}"`)) continue;
        checked++;
        expect(html, field).toContain('aria-invalid="true"');
        expect(await axeViolations(html), field).toEqual([]);
      }
      expect(checked, 'none of the fields this case names is on the screen').toBeGreaterThan(0);
    },
    SCAN_TIMEOUT_MS,
  );

  it('speaks a failure through the alert region and not only by colour', () => {
    for (const item of CASES) {
      const html = render(item, STATES[2]?.forced);
      if (!html.includes('field-msg')) continue;
      expect(html, item.name).toContain('role="alert"');
      expect(html, item.name).toContain('Something went wrong. Try again.');
    }
  });
});

/** The guard that stops a new form from being added without being scanned. */
const SRC = fileURLToPath(new URL('..', import.meta.url));

function formFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...formFiles(full));
    else if (entry.endsWith('.tsx') && !entry.includes('.test.')) {
      if (readFileSync(full, 'utf8').includes('useActionState')) out.push(full);
    }
  }
  return out;
}

function exportedComponents(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names: string[] = [];
  sf.forEachChild((node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      names.push(node.name.text);
    }
  });
  return names;
}

describe('the list of screens being scanned', () => {
  const thisFile = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const files = formFiles(join(SRC, 'app'));

  it('actually finds the forms it is meant to check', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('includes every file that has a form in it', () => {
    const missing = files
      .map((file) => relative(SRC, file).replace(/\.tsx$/, ''))
      .filter((path) => !thisFile.includes(`'../${path}'`));
    expect(missing).toEqual([]);
  });

  it('includes every form and button those files export', () => {
    const missing = files.flatMap((file) =>
      exportedComponents(file)
        .filter((name) => !new RegExp(`<(\\w+\\.)?${name}[\\s/>]`).test(thisFile))
        .map((name) => `${relative(SRC, file)}: ${name}`),
    );
    expect(missing).toEqual([]);
  });
});
