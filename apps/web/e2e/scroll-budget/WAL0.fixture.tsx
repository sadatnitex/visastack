import { DocumentWalletBrowser } from '../../src/components/document-wallet-browser';
import { DepthScope } from '../../src/components/depth-scope';
import { SafeCopyEditor } from '../../src/components/safe-copy-editor';
import { ReadingStatus } from '../../src/app/app/applicant/[id]/reading-status';
import { CaseMoreMenu } from '../../src/app/app/mission/[id]/case-more-menu';
import { TasksPanel } from '../../src/app/app/mission/[id]/collaboration-panels';
import { SnapshotButton } from '../../src/app/app/mission/[id]/mission-buttons';
import { DepthSwitch } from '../../src/components/depth-switch';
import { PageHeader } from '../../src/components/ui';
import { depthCopyFor } from '../../src/lib/ccd/depth-copy';
import { WorkspaceShell } from '../../src/app/app/workspace-shell';
import { readingStatusCopy } from '../../src/lib/document-reading';
import type { DepthChoice } from '../../src/lib/ccd/depth';

/**
 * WAL0 fixture (Example data only).
 * - `sheet`: the real document sheet (DocumentWalletBrowser with a made-up document selected,
 *   the real Safe Copy section, reading status, Check the File Again and a date form) inside the
 *   real signed-in shell (workspace shell, bottom bar) with the real Add button markup the
 *   documents page draws. `open` opens the sheet the way a tap on a row does.
 * - `strip`: the case page's pill strip with its real class names and links, at a depth level.
 */
export interface Wal0FixtureProps {
  readonly view: 'sheet' | 'strip';
  readonly depth?: DepthChoice;
  /** Mirrors the page: the Add button is left out when the address already names a document. */
  readonly addButton?: boolean;
}

const APPLICANT = '10000000-0000-4000-8000-000000000001';
const DOC = '20000000-0000-4000-8000-000000000001';

function Details() {
  const copy = readingStatusCopy({ stage: 'could_not_read' } as never, { canReadAgain: true });
  return (
    <div>
      <div
        className="wallet-document-actions"
        style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}
      >
        <SafeCopyEditor
          documentId={DOC}
          versionId="30000000-0000-4000-8000-000000000001"
          available
          returnTo={`/app/applicant/${APPLICANT}/documents?document=${DOC}`}
          initialState="NOT_PREPARED"
        />
        {copy ? (
          <ReadingStatus copy={copy} stage="could_not_read" applicantId={APPLICANT} />
        ) : null}
        <form>
          <button className="btn btn-secondary" type="submit">
            Check the File Again
          </button>
        </form>
        <form>
          <label htmlFor="wal0-date">Document Date</label>
          <input id="wal0-date" className="input" type="date" name="date" />
          <button className="btn btn-primary" type="submit">
            Save
          </button>
        </form>
      </div>
    </div>
  );
}

function Shell({ children }: { readonly children: React.ReactNode }) {
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
      {children}
    </WorkspaceShell>
  );
}

function Sheet({ addButton }: { readonly addButton: boolean }) {
  return (
    <Shell>
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
              ready: true,
              needsReview: false,
              expiring: false,
              safetyLabel: 'Clean',
              processingLabel: 'Ready',
              previewAllowed: true,
              details: <Details />,
            },
          ]}
        />
        {addButton ? (
          <>
            <div className="docs-add-fab-space" aria-hidden="true" />
            <a className="docs-add-fab" href="/add" aria-label="Add Documents">
              <span aria-hidden="true">Add</span>
            </a>
          </>
        ) : null}
      </div>
    </Shell>
  );
}

const LINKS: readonly (readonly [string, string, 'glance' | 'browse' | 'everything'])[] = [
  ['#trip-checks', 'Dates', 'browse'],
  ['#readiness', 'Readiness', 'glance'],
  ['#trip-package', 'Trip Package', 'browse'],
  ['#evidence', 'Evidence', 'everything'],
  ['#work', 'Tasks and Letters', 'browse'],
  ['#snapshots', 'Snapshots', 'everything'],
  ['#contributors', 'Contributors', 'browse'],
  ['#notes', 'Notes', 'browse'],
  ['#outcome', 'Submission and Outcome', 'everything'],
];

/** A pasted web address with no spaces: the worst case for a task title. */
const LONG_URL = `https://example.com/${'a'.repeat(100)}`;

function Strip({ depth }: { readonly depth: DepthChoice }) {
  return (
    <Shell>
      <section className="section container lift-case">
        <DepthScope family="case" depth={depth}>
          <PageHeader
            back={{ href: '/cases', label: 'Example Traveller · Cases' }}
            eyebrow="Case"
            title="Example Study Visa"
            actions={
              <>
                <div className="case-header-wide">
                  <a className="btn btn-secondary" href="#evidence">
                    Add Evidence
                  </a>
                </div>
                <div className="case-header-wide" data-level="browse">
                  <a className="btn btn-secondary" href="/new">
                    Start a New Case from This One
                  </a>
                  <SnapshotButton missionId="40000000-0000-4000-8000-000000000001" />
                </div>
                <CaseMoreMenu
                  missionId="40000000-0000-4000-8000-000000000001"
                  applicantId={APPLICANT}
                  canCancel
                  headerActions={{ addEvidenceHref: '#evidence', newCaseHref: '/new', snapshot: true }}
                />
              </>
            }
          />
          <DepthSwitch family="case" initial={depth} copy={depthCopyFor('case')} notesBehindInfo />
          <nav className="jump-nav" aria-label="Sections of this case" data-level="browse">
            {LINKS.map(([href, label, level]) => (
              <a key={href} href={href} data-level={level}>
                {label}
              </a>
            ))}
          </nav>
          <div className="lift-case-grid case-working-area">
           <div data-level="browse">
            <div className="grid" id="work">
            <TasksPanel
              missionId="40000000-0000-4000-8000-000000000001"
              tasks={[
                {
                  id: '50000000-0000-4000-8000-000000000001',
                  description: LONG_URL,
                  status: 'OPEN',
                  priority: 'NORMAL',
                  dueDate: null,
                  dueTimezone: null,
                },
              ]}
            />
            </div>
           </div>
          </div>
        </DepthScope>
      </section>
    </Shell>
  );
}

export default function Wal0Fixture({ view, depth = 'browse', addButton = true }: Wal0FixtureProps) {
  return view === 'strip' ? <Strip depth={depth} /> : <Sheet addButton={addButton} />;
}
