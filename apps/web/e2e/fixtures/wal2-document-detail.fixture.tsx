import Link from 'next/link';
import { DocumentFindings } from '../../src/app/app/applicant/[id]/ai-review';
import { AppSuggestionsSection } from '../../src/app/app/applicant/[id]/app-suggestions';
import { DocumentExpiryForm } from '../../src/app/app/applicant/[id]/document-expiry-form';
import { DocumentRenameForm } from '../../src/app/app/applicant/[id]/document-rename-form';
import { WorkspaceShell } from '../../src/app/app/workspace-shell';
import { DocumentHeroCard } from '../../src/components/document-detail/document-hero-card';
import { DocumentWalletBrowser } from '../../src/components/document-wallet-browser';
import depth from '../../src/components/pictures/pictures-depth.css?inline';
import { SafeCopyEditor } from '../../src/components/safe-copy-editor';
import { ExpandableSection } from '../../src/components/ui-lift/expandable-section';

/**
 * WAL2 fixture (Example data only): the opened document as the documents page draws it, with the
 * real hero card, the real Check What We Found (rows, one-at-a-time review, accept bar), the real
 * date, expiry, rename and safe copy forms inside Expandable Sections, the real signed-in shell
 * with its bottom bar, and the Add button markup the page always draws. Server actions are stood
 * in by the fixture bundler. Used by e2e/wallet/u2-document-detail.spec.ts.
 */
export interface Wal2FixtureProps {
  /** Every detail section starts open, so Save and the date fields are in the page flow. */
  readonly open?: boolean;
  /**
   * `profile`: the Profile page's suggestions from a connected app, which share the review card
   * (with the large choice tiles for a difference), in the same signed-in shell.
   */
  readonly view?: 'document' | 'profile';
}

const APPLICANT = '10000000-0000-4000-8000-000000000001';
const DOC = '20000000-0000-4000-8000-000000000001';

type Finding = Parameters<typeof DocumentFindings>[0]['proposals'][number];

const finding = (id: string, fieldLabel: string, value: string, extra: Partial<Finding> = {}) =>
  ({
    id,
    type: 'NEW',
    fieldKey: fieldLabel.toLowerCase().replace(/ /g, '_'),
    fieldLabel,
    value,
    confidence: 95,
    rationale: null,
    evidence: [{ snippet: value, verified: true }],
    clear: true,
    ...extra,
  }) as Finding;

/** Eight details: six ordinary (four clear, two to check), one Sensitive, one that differs. */
const FINDINGS: readonly Finding[] = [
  finding('f1', 'Given Name', 'Example'),
  finding('f2', 'Family Name', 'Traveller'),
  finding('f3', 'Nationality', 'Bangladeshi'),
  finding('f4', 'Place of Birth', 'Example City With A Long Name For Wrapping'),
  finding('f5', 'Occupation', 'Example Work', { clear: false }),
  finding('f6', 'Issuing Authority', 'Example Office', { clear: false }),
  finding('f7', 'Passport Number', 'X0000000', { sensitive: true }),
  finding('f8', 'Date of Birth', '1990-01-01', {
    sensitive: true,
    difference: { current: null },
    editor: { kind: 'date' },
  }),
];

function Details({ open }: { readonly open: boolean }) {
  return (
    <div>
      <div className="wallet-document-actions doc-detail-stack">
        <DocumentFindings applicantId={APPLICANT} canApprove proposals={FINDINGS} />
        <ExpandableSection
          title="Dates"
          summary={<span data-value="date">No Document Date</span>}
          defaultOpen={open}
          className="doc-detail-section"
        >
          <form className="field-stack">
            <label className="field-label" htmlFor={`date-${DOC}`}>
              Document Date
            </label>
            <div className="field-inline">
              <input id={`date-${DOC}`} name="documentDate" type="date" className="input" />
              <button type="submit" className="btn btn-secondary">
                Save
              </button>
            </div>
          </form>
          <DocumentExpiryForm
            applicantId={APPLICANT}
            documentId={DOC}
            origin="NONE"
            typedOn={null}
            mismatch={false}
            savedLabel={null}
            typedLabel={null}
          />
        </ExpandableSection>
        <ExpandableSection
          title="Name and Kind"
          summary={<span data-value="kind">Passport</span>}
          defaultOpen={open}
          className="doc-detail-section"
        >
          <DocumentRenameForm applicantId={APPLICANT} documentId={DOC} name="Example Passport" />
        </ExpandableSection>
        <ExpandableSection title="Safe Copy" defaultOpen={open} className="doc-detail-section">
          <SafeCopyEditor
            documentId={DOC}
            versionId="30000000-0000-4000-8000-000000000001"
            available
            returnTo={`/app/applicant/${APPLICANT}/documents?document=${DOC}`}
            initialState="NOT_PREPARED"
          />
        </ExpandableSection>
        <ExpandableSection
          title="Reading and Checks"
          defaultOpen={open}
          className="doc-detail-section"
        >
          <form>
            <button className="btn btn-secondary" type="submit">
              Check the File Again
            </button>
          </form>
        </ExpandableSection>
      </div>
    </div>
  );
}

function ProfileSuggestions() {
  return (
    <WorkspaceShell
      access={{
        travellers: [{ id: APPLICANT, name: 'Example Traveller', relationship: 'SELF' }],
        agencies: [],
        platform: null,
      }}
      accountName="Example Traveller"
      signOut={<span />}
    >
      <div className="container">
        <AppSuggestionsSection
          applicantId={APPLICANT}
          canApprove
          proposals={[
            finding('p1', 'Occupation', 'Example Work', {
              app: 'Example App',
              rationale: 'From your message.',
              difference: { current: 'Example Old Work' },
              clear: false,
            }),
            finding('p2', 'City', 'Example City', { app: 'Example App', clear: false }),
          ]}
        />
      </div>
    </WorkspaceShell>
  );
}

export default function Wal2DocumentDetailFixture({
  open = false,
  view = 'document',
}: Wal2FixtureProps) {
  if (view === 'profile') return <ProfileSuggestions />;
  return (
    <>
      <WorkspaceShell
        access={{
          travellers: [{ id: APPLICANT, name: 'Example Traveller', relationship: 'SELF' }],
          agencies: [],
          platform: null,
        }}
        accountName="Example Traveller"
        signOut={<span />}
      >
        <div className="container">
          <DocumentWalletBrowser
            applicantId={APPLICANT}
            initialSelection={DOC}
            documents={[
              {
                id: DOC,
                name: 'Example Passport',
                kind: 'Passport',
                docType: 'PASSPORT',
                category: 'Identity',
                version: 1,
                updatedAt: '2026-11-01T10:00:00.000Z',
                ready: false,
                needsReview: true,
                expiring: false,
                safetyLabel: 'File Type Checked',
                processingLabel: 'Needs Review',
                previewAllowed: true,
                hero: (
                  <DocumentHeroCard
                    nameId={`doc-name-${DOC}`}
                    name="Example Passport"
                    kind="Passport"
                    docType="PASSPORT"
                    facts={['Updated 1 Nov 2026']}
                    marks={[
                      {
                        id: 'safety',
                        label: 'File Type Checked',
                        explain: 'We checked that the file is the type it says it is.',
                        tone: 'ok',
                      },
                      {
                        id: 'expiry',
                        label: 'Expiry Not Confirmed',
                        explain: 'No expiry date is confirmed for this document yet.',
                        tone: 'neutral',
                      },
                      {
                        id: 'processing',
                        label: 'Needs Review',
                        explain: 'Where this file is in our checks right now.',
                        tone: 'neutral',
                        live: true,
                      },
                      {
                        id: 'safe-copy',
                        label: 'Safe Copy: Not Prepared Yet',
                        explain:
                          'A copy with private details masked, for sharing. Your original file is never changed.',
                        tone: 'neutral',
                      },
                    ]}
                    actions={
                      <>
                        <form>
                          <button type="submit" className="btn btn-secondary">
                            Preview
                          </button>
                        </form>
                        <form>
                          <button type="submit" className="btn btn-secondary">
                            Download Original
                          </button>
                        </form>
                      </>
                    }
                  />
                ),
                details: <Details open={open} />,
              },
            ]}
          />
          <div className="docs-add-fab-space" aria-hidden="true" />
          <Link className="docs-add-fab" href="/add" aria-label="Add Documents">
            <span aria-hidden="true">Add</span>
          </Link>
        </div>
      </WorkspaceShell>
      {/* The picture stylesheet, which the page loads with its pictures. */}
      <style>{depth}</style>
    </>
  );
}
