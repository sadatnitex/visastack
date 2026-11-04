import { useEffect, useState } from 'react';
import { OpenCaseFromLink } from '../../src/app/app/agency/[orgId]/cases/open-case-from-link';
import { RequestEvidenceForm } from '../../src/app/app/agency/[orgId]/request-evidence-form';
import { NeedsDecision } from '../../src/app/app/applicant/[id]/documents/needs-decision';
import { AttachPackForm } from '../../src/app/app/mission/[id]/attach-pack-form';
import { CaseStageTracker } from '../../src/components/case-preparation-summary';
import { CaseReadinessRing } from '../../src/components/case-readiness-ring';
import { DocumentReviewPanel } from '../../src/components/document-review-panel';
import { NextStepCard, PageHeader, StatusBadge } from '../../src/components/ui';
import { CASE_STATE_LABELS } from '../../src/lib/case-stages';
import { fixtureDocumentGroups, fixtureFieldGroups } from '../../src/lib/master-profile-fixture';
import { FIXTURE_NAVIGATE_EVENT } from './navigation';

/**
 * Tier 1a journey screens (docs/operations/staging-journeys.md): the real product components of
 * four screens that exist today, mounted in a browser with made-up data. Server work is a
 * stand-in, so this proves how the screens look, read and respond to the keyboard at each width.
 * It proves nothing about sign-in, permissions or stored data.
 *
 * Views:
 * - `wallet`: the documents page (list, review panel, and the "Needs One Decision" card that
 *   carries the corrected-copy and same-file choices).
 * - `case`: a case page card (stage, progress, next step, requirement pack choice).
 * - `request`: the agency's evidence request form as it stands today.
 * - `cases-link`: an agency Cases list of anchor-only links and the real link opener.
 */
export interface JourneyScreensProps {
  readonly view: 'wallet' | 'case' | 'case-no-packs' | 'request' | 'cases-link';
}

const FILES = [
  {
    id: 'doc-passport-new',
    name: 'Specimen Passport, Newer Scan',
    safetyLabel: 'Safety checks passed',
    safetyTone: 'success' as const,
    processingLabel: 'Ready',
    previewAllowed: true,
  },
  {
    id: 'doc-passport-old',
    name: 'Specimen Passport, First Scan',
    safetyLabel: 'Safety checks passed',
    safetyTone: 'success' as const,
    processingLabel: 'Ready',
    previewAllowed: true,
  },
  {
    id: 'doc-letter',
    name: 'Specimen Letter Still Being Checked',
    safetyLabel: 'Being checked',
    safetyTone: 'neutral' as const,
    processingLabel: 'Processing',
    previewAllowed: false,
  },
];

const NO_ACTION = async () => undefined;

function Wallet() {
  return (
    <>
      <PageHeader
        title="Documents"
        description="Your documents, kept private. Open one to check it."
        back={{ href: '/app/applicant/synthetic', label: 'Overview' }}
      />
      <NeedsDecision
        applicantId="synthetic"
        items={[
          {
            kind: 'relation',
            proposalId: 'proposal-new-copy',
            documentId: 'doc-passport-new',
            title: 'Specimen Passport, Newer Scan',
            relatedDocumentId: 'doc-passport-old',
            relatedTitle: 'Specimen Passport, First Scan',
            relation: 'CORRECTED_SCAN',
            labels: { newDocument: 'Newer Copy', relatedDocument: 'Earlier Copy' },
          },
          {
            kind: 'relation',
            proposalId: 'proposal-same-file',
            documentId: 'doc-letter',
            title: 'Specimen Letter Still Being Checked',
            relatedDocumentId: 'doc-passport-old',
            relatedTitle: 'Specimen Passport, First Scan',
            relation: 'EXACT_DUPLICATE',
            labels: { newDocument: 'Same File', relatedDocument: 'Same File' },
          },
          {
            kind: 'unknown_type',
            documentId: 'doc-letter',
            title: 'Specimen Letter Still Being Checked',
          },
        ]}
        linked={[]}
      />
      <div className="document-wallet-layout">
        <article className="card">
          <h2 className="card-title">Your Documents</h2>
          <div className="rows">
            {FILES.map((file) => (
              <a
                className="row row-link"
                key={file.id}
                href={`/app/applicant/synthetic/documents?document=${file.id}#wallet-selected-document`}
              >
                <span className="row-key">{file.name}</span>
                <StatusBadge tone={file.previewAllowed ? 'success' : 'neutral'}>
                  {file.processingLabel}
                </StatusBadge>
              </a>
            ))}
          </div>
        </article>
        <DocumentReviewPanel applicantId="synthetic" documents={FILES} previewAction={NO_ACTION} />
      </div>
    </>
  );
}

function CaseCard({ packs }: { readonly packs: boolean }) {
  return (
    <>
      <PageHeader
        eyebrow="Case"
        title="Specimen Visitor Visa, Autumn 2026"
        description="One place for this application: where it stands and what comes next."
        back={{ href: '/app/applicant/synthetic/missions', label: 'Cases' }}
      />
      <CaseStageTracker
        state="IN_PROGRESS"
        labels={CASE_STATE_LABELS}
        nextStates={['READY_FOR_REVIEW']}
        cancelInMore
      />
      <NextStepCard
        title="Add Your Bank Statement"
        why="It is the next thing this checklist asks for."
        href="/app/applicant/synthetic/documents/add"
        action="Add a Document"
      />
      <article className="card">
        <h2 className="card-title">Checklist Progress</h2>
        <CaseReadinessRing readiness={{ requiredCount: 9, satisfiedRequired: 4 }} />
        <p className="muted">
          Completeness of the checklist is not an approval probability. Nobody can promise an
          outcome.
        </p>
      </article>
      <article className="card">
        <h2 className="card-title">Requirement Pack</h2>
        <AttachPackForm
          missionId="synthetic-case"
          options={
            packs
              ? [
                  { packVersionId: 'pack-specimen-1', label: 'Specimen Visitor Pack, Version 1' },
                  { packVersionId: 'pack-specimen-2', label: 'Specimen Study Pack, Version 3' },
                ]
              : []
          }
        />
      </article>
    </>
  );
}

function Request() {
  return (
    <>
      <PageHeader
        title="Requests"
        description="Ask a traveller for a detail or a document. They decide what to send."
      />
      <article className="card">
        <h2 className="card-title">Ask for Evidence</h2>
        <RequestEvidenceForm
          organizationId="synthetic-org"
          fieldGroups={fixtureFieldGroups}
          documentGroups={fixtureDocumentGroups}
          applicants={[{ applicantId: 'applicant-1', displayName: 'Specimen Traveller' }]}
          missions={[
            {
              missionId: 'case-1',
              title: 'Specimen Visitor Visa',
              applicantName: 'Specimen Traveller',
            },
          ]}
        />
      </article>
    </>
  );
}

const CASES_PATH = '/app/agency/synthetic/cases';
const CASES = [
  { id: '0b7a4c1e-5d3f-4a62-9c18-3e2f7a9b0d11', title: 'Specimen Visitor Visa, Autumn 2026' },
  { id: '7c2d9e40-1b8a-4f56-8a07-6d5e4c3b2a10', title: 'Specimen Study Visa, January 2027' },
  { id: 'a1f3b5d7-9e2c-4b84-a6d0-8f1e3c5b7a92', title: 'Specimen Family Visit, Summer 2027' },
];

/** The case named in the address bar, as the real Cases page reads it from `?case=`. */
function openCaseFromAddress(): string | null {
  return new URLSearchParams(window.location.search).get('case');
}

function CasesLink() {
  // The real page lives at this address; the fixture moves there once, before the opener first
  // reads it. The opener turns an anchor-only link into `?case=<id>#mission-<id>`.
  useState(() => {
    window.history.replaceState(null, '', CASES_PATH);
    window.__uiFixturePath = CASES_PATH;
  });
  const [open, setOpen] = useState<string | null>(openCaseFromAddress);
  useEffect(() => {
    const read = () => setOpen(openCaseFromAddress());
    window.addEventListener(FIXTURE_NAVIGATE_EVENT, read);
    window.addEventListener('popstate', read);
    return () => {
      window.removeEventListener(FIXTURE_NAVIGATE_EVENT, read);
      window.removeEventListener('popstate', read);
    };
  }, []);
  const current = CASES.find((c) => c.id === open);
  return (
    <>
      <OpenCaseFromLink />
      <PageHeader title="Cases" description="The cases you can see. Choose one to open it." />
      <article className="card">
        <h2 className="card-title">Your Cases</h2>
        <ul className="agency-case-list" aria-label="Cases">
          {CASES.map((c) => (
            <li key={c.id} className="agency-case-list-row">
              <a className="row row-link" href={`${CASES_PATH}#mission-${c.id}`}>
                <span className="row-key">{c.title}</span>
              </a>
            </li>
          ))}
        </ul>
      </article>
      {current ? (
        <section
          className="card"
          id={`mission-${current.id}`}
          aria-labelledby="open-case-title"
          data-open-case={current.id}
        >
          <h2 className="card-title" id="open-case-title">
            {current.title}
          </h2>
          <p className="muted">This is the open case. Its team, notes and tasks appear here.</p>
        </section>
      ) : (
        <p className="card-body muted" data-open-case="">
          Choose a case to open its workspace: its team, notes, tasks and appointments.
        </p>
      )}
    </>
  );
}

export default function JourneyScreens({ view }: JourneyScreensProps) {
  if (view === 'wallet') return <Wallet />;
  if (view === 'case') return <CaseCard packs />;
  if (view === 'case-no-packs') return <CaseCard packs={false} />;
  if (view === 'request') return <Request />;
  return <CasesLink />;
}
