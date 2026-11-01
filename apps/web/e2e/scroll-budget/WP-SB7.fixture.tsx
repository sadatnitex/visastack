import { ApplicantPicker } from '../../src/app/app/admin/privacy/applicant-picker';
import { SectionTabs } from '../../src/app/app/admin/privacy/section-tabs';
import { ShowMore } from '../../src/components/show-more';
import { StickyDetails } from '../../src/components/sticky-details';

/**
 * WP-SB7 scroll budget fixture: the staff data and settings pages at their caps, with the same
 * classes, components and row caps the pages use, filled with made-up worst-case data. The page
 * tests prove the real pages apply these caps (and read only what they show); this measures the
 * height. Server forms are drawn as their fields, since their actions cannot run here.
 */
export interface Sb7FixtureProps {
  readonly view: 'organizations' | 'members' | 'holds' | 'protection' | 'ai' | 'pack';
  /** Rows the page shows at once (the cap under test). */
  readonly shown: number;
  /** Rows that exist in all. */
  readonly total: number;
}

function rows(count: number): number[] {
  return Array.from({ length: count }, (_, n) => n);
}

function Header({ title, description }: { readonly title: string; readonly description: string }) {
  return (
    <header className="page-header">
      <h1 className="page-title">{title}</h1>
      <p className="page-description">{description}</p>
    </header>
  );
}

function Organizations({ shown }: { shown: number }) {
  return (
    <section className="section container">
      <Header
        title="Organizations"
        description="Verify, suspend or close the organizations that use the platform."
      />
      <article className="card u-mt-150" id="admin-organizations">
        <p className="card-kicker">Verification</p>
        <h2 className="card-title">Organizations</h2>
        <form className="sb7-filter-bar u-mt-050" aria-label="Find organizations">
          <div className="field-row">
            <label className="field-label" htmlFor="org-search">
              Name
            </label>
            <input id="org-search" name="q" type="search" className="input" />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="org-status">
              Status
            </label>
            <select id="org-status" name="status" className="input" defaultValue="">
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
            </select>
          </div>
          <button type="submit" className="btn btn-secondary">
            Find
          </button>
        </form>
        <table className="data-table u-mt-050" id="organizations-list">
          <caption className="sr-only">Organizations on the Platform</caption>
          <thead>
            <tr>
              <th scope="col">Organization</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows(shown).map((n) => (
              <tr key={n}>
                <th scope="row" className="cell-main">
                  Made-up Visa Agency {n + 1}
                </th>
                <td data-label="Status">
                  <span className="badge badge-success">Active</span>
                </td>
                <td data-label="Actions">
                  <span className="case-row-badges">
                    <StickyDetails
                      initiallyOpen={false}
                      className="sb7-row-menu"
                      summary={
                        <>
                          More Actions
                          <span className="sr-only"> for Made-up Visa Agency {n + 1}</span>
                        </>
                      }
                    >
                      <span className="sb7-row-menu-items">
                        <button type="button" className="btn btn-secondary u-btn-sm">
                          Suspend
                        </button>
                        <button type="button" className="btn btn-danger u-btn-sm">
                          Terminate
                        </button>
                      </span>
                    </StickyDetails>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <nav className="show-more" aria-label="Organization pages">
          <a className="btn btn-secondary u-btn-sm show-more-link" href="#admin-organizations">
            Next Page
          </a>
        </nav>
      </article>
    </section>
  );
}

function Members({ shown }: { shown: number }) {
  return (
    <section className="section container">
      <Header
        title="Members"
        description="Registered accounts, separate from platform staff roles. Verification does not grant administrator access."
      />
      <article className="card" id="members-list">
        <form className="sb7-filter-bar" aria-label="Find members">
          <div className="field-row">
            <label className="field-label" htmlFor="member-search">
              Email Contains
            </label>
            <input id="member-search" name="q" type="search" className="input" />
          </div>
          <button type="submit" className="btn btn-secondary">
            Find
          </button>
        </form>
        <div className="rows">
          {rows(shown).map((n) => (
            <article className="workspace-member-row" key={n}>
              <h2>member-{n + 1}@example.test</h2>
              <p>Email confirmed</p>
              <p>Joined 1 Oct 2026</p>
            </article>
          ))}
        </div>
      </article>
      <nav aria-label="Member pages" className="workspace-pagination">
        <a href="#members-list">Next Page</a>
      </nav>
    </section>
  );
}

const PRIVACY_TABS = [
  { key: 'retention', label: 'Retention', href: '/app/admin/privacy' },
  { key: 'holds', label: 'Legal Holds', href: '/app/admin/privacy?tab=holds' },
  { key: 'erasure', label: 'Erasure', href: '/app/admin/privacy?tab=erasure', count: 40 },
  { key: 'purge', label: 'Purge', href: '/app/admin/privacy?tab=purge', count: 300 },
] as const;

function Holds({ shown, total }: { shown: number; total: number }) {
  return (
    <section className="section container">
      <Header title="Privacy" description="Retention policies, legal holds, erasure and purge." />
      <SectionTabs
        label="Privacy sections"
        active="holds"
        tabs={PRIVACY_TABS.map((tab) =>
          tab.key === 'holds' ? { ...tab, count: shown, more: total > shown } : tab,
        )}
      />
      <article className="card" id="admin-holds">
        <p className="card-kicker">Legal Holds</p>
        <h2 className="card-title">Active Holds</h2>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take keyboard focus to scroll. */}
        <section className="activity-log-scroll u-mb-125" aria-label="Active holds" tabIndex={0}>
          <div className="rows">
            {rows(shown).map((n) => (
              <div className="row sb7-stack-row" key={n}>
                <div className="sb7-stack-head">
                  <span className="row-key sb7-break">Made-up Traveller {n + 1}</span>
                  <button type="button" className="btn btn-secondary u-btn-sm">
                    Release
                  </button>
                </div>
                <span className="muted u-fs-085">Made-up court order {n + 1}</span>
                <span className="u-fs-085">
                  <span className="badge badge-neutral">review by 1 Jan 2027</span>
                </span>
              </div>
            ))}
          </div>
        </section>
        <nav className="show-more u-mb-125" aria-label="More holds">
          <a className="btn btn-secondary u-btn-sm show-more-link" href="#admin-holds">
            Show Older Holds
          </a>
        </nav>
        <h3 className="card-title">Place a Legal Hold</h3>
        <form className="field-list form-narrow">
          <div className="form-grid">
            <div className="field-row field-wide">
              <ApplicantPicker search={async () => ({ ok: true, matches: [] })} />
            </div>
            <div className="field-row">
              <label className="field-label" htmlFor="reason">
                Reason
              </label>
              <input id="reason" name="reason" type="text" className="input" />
            </div>
            <div className="field-row">
              <label className="field-label" htmlFor="reviewAt">
                Review By
              </label>
              <input id="reviewAt" name="reviewAt" type="date" className="input" />
            </div>
            <div className="field-row">
              <label className="field-label" htmlFor="scope">
                Scope
              </label>
              <select id="scope" name="scope" className="input" defaultValue="applicant">
                <option value="applicant">Whole Applicant (Default)</option>
              </select>
            </div>
          </div>
          <button type="submit" className="btn btn-danger">
            Place Legal Hold
          </button>
        </form>
      </article>
    </section>
  );
}

function Protection({ shown, total }: { shown: number; total: number }) {
  return (
    <section className="section container">
      <Header
        title="Document Protection"
        description="Choose which documents need a fresh sign-in check before anyone, including the traveller, previews or downloads them."
      />
      <article className="card u-mb-150" id="unsorted-documents">
        <p className="card-kicker">Not Sorted Yet</p>
        <h2 className="card-title">Documents Not Sorted Yet</h2>
        <p className="card-body">Documents whose type is not known yet, or not recognised.</p>
        <p>
          <span className="badge badge-success">Sign-in check On</span> Ask for a fresh sign-in
          check before anyone previews or downloads these documents.
        </p>
        <p className="muted u-fs-085">Standard setting, never changed.</p>
        <button type="button" className="btn btn-secondary">
          Turn Off
        </button>
      </article>
      <h2 className="card-title" id="document-categories">
        Document Categories
      </h2>
      <p className="muted u-mb-125">
        A category switch covers every document in it, including ones added later.
      </p>
      <SectionTabs
        label="Document categories"
        active="c0"
        tabs={rows(total).map((n) => ({
          key: `c${n}`,
          label: `Made-up Category ${n + 1}`,
          href: `/app/admin/document-protection?category=c${n}#document-categories`,
          count: shown,
        }))}
      />
      <article className="card" id="category-c0">
        <h3 className="card-title">Made-up Category 1</h3>
        <p className="card-body">Made-up documents of one kind.</p>
        <p>
          <span className="badge badge-success">Sign-in check On</span> Ask for a fresh sign-in
          check before anyone previews or downloads these documents.
        </p>
        <button type="button" className="btn btn-secondary">
          Turn Off
        </button>
        <details className="disclosure">
          <summary>Documents in Made-up Category 1 ({shown})</summary>
          <ul className="field-list">
            {rows(shown).map((n) => (
              <li key={n}>Made-up Document {n + 1}</li>
            ))}
          </ul>
        </details>
      </article>
    </section>
  );
}

function Ai({ shown }: { shown: number }) {
  const feature = (n: number) => (
    <article className="card u-mb-100" key={n} aria-labelledby={`ai-feature-${n}`}>
      <div className="card-head">
        <h4 className="card-title" id={`ai-feature-${n}`}>
          Made-up AI Feature {n + 1}
        </h4>
        <span className="badge badge-neutral">Off</span>
      </div>
      <div className="rows rows-grid">
        <div className="row">
          <span className="row-key">Daily Limit per Person</span>
          <span className="row-val">15 a day (the plan’s limit)</span>
        </div>
      </div>
      <StickyDetails
        initiallyOpen={false}
        className="sb7-fold"
        summary={`Change Made-up AI Feature ${n + 1}`}
      >
        <p className="card-body">What the made-up feature does.</p>
      </StickyDetails>
    </article>
  );
  return (
    <section className="section container">
      <Header
        title="AI Settings"
        description="Turn each AI feature on or off, set how much each person may use it a day, and manage AI providers."
      />
      <section aria-labelledby="ai-features-title">
        <h2 className="section-title" id="ai-features-title">
          AI Features
        </h2>
        <section aria-labelledby="ai-audience-traveller">
          <h3 className="card-title u-mb-100" id="ai-audience-traveller">
            For Travellers
          </h3>
          {rows(shown - 1).map(feature)}
        </section>
        <section aria-labelledby="ai-audience-agency">
          <h3 className="card-title u-mb-100" id="ai-audience-agency">
            For Agencies
          </h3>
          {feature(shown - 1)}
        </section>
      </section>
    </section>
  );
}

function Pack({ shown, total }: { shown: number; total: number }) {
  return (
    <section className="section container">
      <Header title="Made-up Visit Route" description="A made-up requirement pack." />
      <div className="sb7-pack-versions">
        <article className="card" id="pack-open-version">
          <div className="card-head">
            <h2 className="card-title">Version 14</h2>
            <span className="badge badge-neutral">Draft</span>
          </div>
          <div className="rows sb7-requirements" id="pack-requirements">
            {rows(shown).map((n) => (
              <div className="row sb7-stack-row" key={n} id={`pack-requirement-${n}`}>
                <div className="sb7-stack-head">
                  <span className="row-key sb7-break">Document: MADE_UP_DOCUMENT_{n + 1}</span>
                  <span className="row-end">
                    <span className="badge badge-neutral">Required</span>
                  </span>
                </div>
                <span className="muted u-fs-085 sb7-break">Cite: Made-up rule {n + 1}</span>
                <details className="sb7-fold">
                  <summary>Source and Checks</summary>
                  <p className="muted u-fs-085">No source recorded yet.</p>
                </details>
              </div>
            ))}
          </div>
          <ShowMore
            id="pack-requirements-more"
            pathname="/app/admin/packs/p1"
            next={shown < total ? { show: shown + 25 } : null}
            shown={shown}
            total={total}
            noun={{ one: 'requirement', other: 'requirements' }}
            landOn={`pack-requirement-${shown}`}
          />
        </article>
        <article className="card" id="pack-other-versions">
          <h2 className="card-title">Other Versions</h2>
          <div className="rows u-mt-050">
            {rows(10).map((n) => (
              <a className="row row-link" key={n} href={`/app/admin/packs/p1?version=v${n}`}>
                <span className="row-key">Version {13 - n}</span>
                <span className="badge badge-success">Published</span>
              </a>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

export default function Sb7Fixture({ view, shown, total }: Sb7FixtureProps) {
  if (view === 'organizations') return <Organizations shown={shown} />;
  if (view === 'members') return <Members shown={shown} />;
  if (view === 'holds') return <Holds shown={shown} total={total} />;
  if (view === 'protection') return <Protection shown={shown} total={total} />;
  if (view === 'ai') return <Ai shown={shown} />;
  return <Pack shown={shown} total={total} />;
}
