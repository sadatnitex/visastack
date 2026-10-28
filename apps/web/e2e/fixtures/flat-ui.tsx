import { createRoot } from 'react-dom/client';
import { AppNav, WorkspaceToolbar } from '../../src/app/app/app-nav';
import { ProfileEditor } from '../../src/app/app/applicant/[id]/profile-editor';
import { GrantForm } from '../../src/app/app/applicant/[id]/sharing/grant-form';
import { SubNav } from '../../src/app/app/subnav';
import { WorkspaceShell } from '../../src/app/app/workspace-shell';
import { CaseReadinessRing } from '../../src/components/case-readiness-ring';
import { DeadlineClock, type DeadlineLine } from '../../src/components/deadline-clock';
import {
  type DocumentReviewEntry,
  DocumentReviewPanel,
} from '../../src/components/document-review-panel';
import { ProgressRing } from '../../src/components/progress-ring';
import {
  AttentionList,
  Checklist,
  EmptyState,
  NextStepCard,
  PageHeader,
  StatusBadge,
} from '../../src/components/ui';
import { fixtureView } from '../../src/lib/master-profile-fixture';
import { PRIMARY_NAV, agencyTabs, applicantTabs, platformTabs } from '../../src/lib/navigation';

type Mode =
  | 'overview'
  | 'profile'
  | 'documents'
  | 'case'
  | 'sharing'
  | 'agency'
  | 'admin'
  | 'shell'
  | 'staff';
declare global {
  interface Window {
    __uiFixturePath?: string;
    __uiFixtureActions?: string[];
    /** The sidebar state the layout would have read from this device's cookie. */
    __uiFixtureSidebar?: 'expanded' | 'collapsed';
    __mountUiFixture?: (mode: Mode) => void;
  }
}
const rows: readonly DocumentReviewEntry[] = [
  {
    id: 'synthetic-clean',
    name: 'Synthetic passport',
    safetyLabel: 'Safety checks passed',
    safetyTone: 'success',
    processingLabel: 'Ready',
    previewAllowed: true,
  },
  {
    id: 'synthetic-pending',
    name: 'Synthetic letter still being checked',
    safetyLabel: 'Being checked',
    safetyTone: 'neutral',
    processingLabel: 'Processing',
    previewAllowed: false,
  },
];
const titles: Record<Mode, string> = {
  overview: 'Your next application',
  profile: 'My profile',
  documents: 'Documents',
  case: 'Visitor visa case',
  sharing: 'Sharing and access',
  agency: 'Synthetic agency workspace',
  admin: 'Platform operations',
  shell: 'Workspace shell',
  staff: 'Platform Overview',
};
const paths: Record<Mode, string> = {
  overview: '/app',
  profile: '/app/applicant/synthetic/profile',
  documents: '/app/applicant/synthetic/documents',
  case: '/app/mission/synthetic',
  sharing: '/app/applicant/synthetic/sharing',
  agency: '/app/agency/synthetic',
  admin: '/app/admin',
  shell: '/app',
  staff: '/app/admin',
};
const preview = async (form: FormData) => {
  window.__uiFixtureActions?.push(String(form.get('documentId')));
};
/** The progress ring in each place it appears: large, medium, in list rows, full, and empty with its teaching line. */
function Rings() {
  return (
    <article className="card" data-fixture="rings">
      <h2 className="card-title">Checklist progress</h2>
      <div className="case-preparation-summary">
        <div className="case-preparation-ring">
          <ProgressRing size="lg" done={6} total={9} centre="67%" />
        </div>
        <div className="case-preparation-counts">
          <h3>Evidence progress</h3>
          <p className="muted">Completeness is not an approval probability.</p>
        </div>
      </div>
      <ProgressRing done={3} total={9} />
      <div className="rows">
        <a className="row row-link" href="/app/mission/one">
          <span className="row-key">
            Visitor visa, a title long enough to wrap on a narrow phone screen
            <span className="progress-ring-row">
              <CaseReadinessRing size="sm" readiness={{ requiredCount: 9, satisfiedRequired: 6 }} />
            </span>
          </span>
        </a>
        <a className="row row-link" href="/app/mission/two">
          <span className="row-key">
            Study visa
            <span className="progress-ring-row">
              <CaseReadinessRing size="sm" readiness={{ requiredCount: 4, satisfiedRequired: 4 }} />
            </span>
          </span>
        </a>
        <a className="row row-link" href="/app/mission/three">
          <span className="row-key">
            Family visit
            <span className="progress-ring-row">
              <CaseReadinessRing size="sm" readiness={null} />
            </span>
          </span>
        </a>
      </div>
      <CaseReadinessRing readiness={null} pickHref="/app/mission/three#pack" />
    </article>
  );
}
/** The deadline clock in each state: all four tones, a date to check, a long name, and nothing yet. */
const CLOCK_LINES: readonly DeadlineLine[] = [
  {
    key: 'a',
    label: 'Bank statement',
    phrase: 'Was due 3 days ago',
    dateText: '23 Oct 2026',
    isoDate: '2026-10-23',
    person: null,
    urgency: 'overdue',
    toneWord: 'Overdue',
    href: '/app/applicant/synthetic/evidence',
    check: null,
  },
  {
    key: 'b',
    label: 'Passport',
    phrase: 'Expires tomorrow',
    dateText: '27 Oct 2026',
    isoDate: '2026-10-27',
    person: 'Synthetic Traveller',
    urgency: 'soon',
    toneWord: 'Within a Week',
    href: '/app/applicant/synthetic/expiry',
    check: null,
  },
  {
    key: 'c',
    label: 'Pay the visa fee and send the receipt to the agency before the long weekend begins',
    phrase: 'Due in 21 days',
    dateText: '16 Nov 2026',
    isoDate: '2026-11-16',
    person: null,
    urgency: 'month',
    toneWord: 'Within a Month',
    href: '/app/mission/synthetic',
    check: null,
  },
  {
    key: 'd',
    label: 'Document',
    phrase: 'Expires in about 8 months, if the date is right',
    dateText: '30 Jun 2027',
    isoDate: '2027-06-30',
    person: null,
    urgency: 'later',
    toneWord: 'Later',
    href: '/app/applicant/synthetic/expiry',
    check: 'Read from a document whose type you have not confirmed yet. Check the date.',
  },
];
function Clock() {
  return (
    <div data-fixture="deadline-clock" className="grid">
      <DeadlineClock
        heading="Coming Up"
        headingId="fixture-clock-heading"
        lines={CLOCK_LINES}
        addAction={{ href: '/app/applicant/synthetic/documents', label: 'Add a Document' }}
        more={{ href: '/app/applicant/synthetic/expiry', label: 'See All Dates' }}
      />
      <DeadlineClock
        heading="Deadline Clock"
        headingId="fixture-clock-empty-heading"
        lines={[]}
        addAction={{ href: '/app/applicant/synthetic/documents', label: 'Add a Document' }}
      />
    </div>
  );
}
function Records() {
  return (
    <article className="card">
      <h2 className="card-title">Evidence checklist</h2>
      <div className="rows">
        {rows.map((row) => (
          <div className="row" key={row.id}>
            <span className="row-key">{row.name}</span>
            <StatusBadge tone={row.previewAllowed ? 'success' : 'neutral'}>
              {row.processingLabel}
            </StatusBadge>
          </div>
        ))}
      </div>
    </article>
  );
}
/** The real signed-in shell (sidebar, toolbar, account menu) with made-up people and no server. */
function ShellFixture({ staff = false }: { readonly staff?: boolean }) {
  return (
    <WorkspaceShell
      access={{
        travellers: [
          { id: 'synthetic', name: 'Synthetic Self', relationship: 'SELF' },
          // A second traveller on the staff screen, so a check can see that no name shows there.
          ...(staff
            ? [{ id: 'synthetic-child', name: 'Synthetic Child', relationship: 'CHILD' }]
            : []),
        ],
        agencies: [],
        // Staff mode: the same shell on a platform page, for a made-up member of staff.
        platform: staff
          ? { owner: true, ai: true, complaints: true, audit: true, privacy: true }
          : null,
      }}
      accountName="Synthetic Self"
      accountEmail="synthetic.self@example.test"
      sidebarState={window.__uiFixtureSidebar ?? 'expanded'}
      toolbarState={{
        unread: 2,
        personalPlan: { key: 'traveller_free', name: 'Traveller Free' },
        agencyPlans: [],
      }}
      signOut={
        <form>
          <button type="submit" className="btn btn-secondary nav-cta">
            Sign Out
          </button>
        </form>
      }
    >
      <section className="section container" id="main">
        <PageHeader
          eyebrow="Synthetic test fixture"
          title={staff ? titles.staff : titles.shell}
          description="Visual and interaction test only. No real records or authenticated session."
        />
        <article className="card">
          <h2 className="card-title">Page content</h2>
          <p>
            A wide table and a long line of text show that the page uses the width the sidebar frees
            and never scrolls sideways.
          </p>
        </article>
      </section>
    </WorkspaceShell>
  );
}
function Fixture({ mode }: { mode: Mode }) {
  if (mode === 'shell' || mode === 'staff') return <ShellFixture staff={mode === 'staff'} />;
  const tabs =
    mode === 'agency'
      ? agencyTabs('synthetic', { admin: true })
      : mode === 'admin'
        ? platformTabs({ ai: true, complaints: true, audit: true, privacy: true })
        : applicantTabs('synthetic');
  return (
    <div className="app-frame">
      <AppNav links={PRIMARY_NAV}>
        <div className="app-shell-switch">
          <p className="app-shell-switch-label">Switch area</p>
          <a className="btn btn-secondary nav-cta" href="/app/agency">
            Agency
          </a>
          <a className="btn btn-secondary nav-cta" href="/app/account">
            Account
          </a>
        </div>
      </AppNav>
      <div className="app-main">
        <WorkspaceToolbar isAdmin={mode === 'admin'} />
        <section className="section container">
          <PageHeader
            eyebrow="Synthetic test fixture"
            title={titles[mode]}
            description="Visual and interaction test only. No real records or authenticated session."
          />
          <SubNav links={tabs} label="Fixture sections" />
          {mode === 'profile' ? (
            <ProfileEditor
              applicantId="synthetic"
              values={{}}
              repeatingValues={{}}
              assurance={new Map()}
              view={fixtureView()}
            />
          ) : null}
          {mode === 'documents' ? (
            <div className="document-wallet-layout">
              <Records />
              <DocumentReviewPanel
                applicantId="synthetic"
                documents={rows}
                previewAction={preview}
              />
            </div>
          ) : null}
          {mode === 'sharing' ? (
            <div className="sharing-workspace">
              <article className="card">
                <h2 className="card-title">Who has access</h2>
                <EmptyState title="Nobody has access yet">
                  Your records are private until you grant access.
                </EmptyState>
              </article>
              <article className="card">
                <h2 className="card-title">Grant access</h2>
                <GrantForm
                  applicantId="synthetic"
                  documents={rows.map((row) => ({ id: row.id, displayName: row.name }))}
                />
              </article>
            </div>
          ) : null}
          {mode === 'overview' || mode === 'case' ? (
            <>
              <NextStepCard
                title="Review your evidence"
                why="Check the details before confirming your case."
                href="/app/applicant/synthetic/documents"
                action="Review documents"
              />
              <Rings />
              <Clock />
              <div className="split">
                <Records />
                <Checklist
                  title="Prepare your case"
                  items={[
                    {
                      key: 'profile',
                      label: 'Review your profile',
                      done: true,
                      href: '/app/applicant/synthetic/profile',
                    },
                    {
                      key: 'evidence',
                      label: 'Review your evidence',
                      done: false,
                      href: '/app/applicant/synthetic/documents',
                    },
                  ]}
                />
              </div>
            </>
          ) : null}
          {mode === 'agency' || mode === 'admin' ? (
            <>
              <AttentionList
                items={[
                  {
                    key: 'pending',
                    href: '#exceptions',
                    label: 'A synthetic case needs review',
                    detail: 'A document is still being checked',
                    tone: 'warning',
                  },
                ]}
              />
              <article className="card">
                <h2 className="card-title">
                  {mode === 'admin' ? 'Operational exceptions' : 'Cases requiring attention'}
                </h2>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Case</th>
                        <th scope="col">Status</th>
                        <th scope="col">Next action</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td data-label="Case">
                          Synthetic visitor case with a long title that must wrap
                        </td>
                        <td data-label="Status">
                          <StatusBadge tone="warning">Awaiting review</StatusBadge>
                        </td>
                        <td data-label="Next action">
                          <a href="#exceptions">Review evidence</a>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </article>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
window.__mountUiFixture = (mode) => {
  window.__uiFixturePath = paths[mode];
  window.__uiFixtureActions = [];
  const main = document.querySelector('main');
  if (!main) throw new Error('Fixture carrier missing');
  main.replaceChildren();
  // A signed-in person never sees the pilot banner (the root layout shows it to visitors only), so
  // the shell fixture mirrors that and measures from the real top of the screen.
  if (mode === 'shell' || mode === 'staff') document.querySelector('.pilot-banner')?.remove();
  createRoot(main).render(<Fixture mode={mode} />);
};
