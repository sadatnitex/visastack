import { createRoot } from 'react-dom/client';
import { AppNav, WorkspaceToolbar } from '../../src/app/app/app-nav';
import { ProfileEditor } from '../../src/app/app/applicant/[id]/profile-editor';
import { GrantForm } from '../../src/app/app/applicant/[id]/sharing/grant-form';
import { SubNav } from '../../src/app/app/subnav';
import {
  type DocumentReviewEntry,
  DocumentReviewPanel,
} from '../../src/components/document-review-panel';
import {
  AttentionList,
  Checklist,
  EmptyState,
  NextStepCard,
  PageHeader,
  StatusBadge,
} from '../../src/components/ui';
import { PRIMARY_NAV, agencyTabs, applicantTabs, platformTabs } from '../../src/lib/navigation';

type Mode = 'overview' | 'profile' | 'documents' | 'case' | 'sharing' | 'agency' | 'admin';
declare global {
  interface Window {
    __uiFixturePath?: string;
    __uiFixtureActions?: string[];
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
};
const paths: Record<Mode, string> = {
  overview: '/app',
  profile: '/app/applicant/synthetic/profile',
  documents: '/app/applicant/synthetic/documents',
  case: '/app/mission/synthetic',
  sharing: '/app/applicant/synthetic/sharing',
  agency: '/app/agency/synthetic',
  admin: '/app/admin',
};
const preview = async (form: FormData) => {
  window.__uiFixtureActions?.push(String(form.get('documentId')));
};
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
function Fixture({ mode }: { mode: Mode }) {
  const tabs =
    mode === 'agency'
      ? agencyTabs('synthetic', { admin: true })
      : mode === 'admin'
        ? platformTabs({ ai: true, complaints: true })
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
  createRoot(main).render(<Fixture mode={mode} />);
};
