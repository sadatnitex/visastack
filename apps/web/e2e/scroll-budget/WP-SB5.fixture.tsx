import { ActivityLog, type ActivityLogEntry } from '../../src/components/activity-log';
import { CaseReadinessRing } from '../../src/components/case-readiness-ring';
import { CollapsibleGroup } from '../../src/components/collapsible-group';
import { ReferenceCode } from '../../src/components/reference-code';
import { ShowMore } from '../../src/components/show-more';
import { StatusBadge } from '../../src/components/ui';

/**
 * WP-SB5 scroll budget fixture: the capped parts of the agency Cases, Activity, Clients and
 * Dashboard pages, with the same classes and the same row caps the pages use, filled with made-up
 * worst-case data (200 cases, 300 notes, 400 invitations, 300 requests). The page tests prove the
 * real pages apply these caps and read only the open case; this measures their height.
 */
export interface Sb5FixtureProps {
  readonly view: 'cases' | 'activity' | 'clients' | 'dashboard';
  /** Rows the page holds in all. */
  readonly total: number;
  /** Rows the page shows at once (the cap). */
  readonly shown: number;
  /** Clients only: the pending invitations group starts open (WP-SB11). */
  readonly invitationsOpen?: boolean;
}

const STAGES = ['Intake', 'In Review', 'Draft', 'Submission Ready'];
const DESTINATIONS = ['United Kingdom', 'Schengen Area', 'Canada', 'Australia'];

function rows(count: number): number[] {
  return Array.from({ length: count }, (_, n) => n);
}

function caseId(n: number): string {
  return `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

function Cases({ total, shown }: { total: number; shown: number }) {
  return (
    <>
      <article className="card">
        <p className="card-kicker">Collaborate</p>
        <h2 className="card-title">Cases</h2>
        <p className="card-body u-mb-125">
          Assign a team member and leave case notes on any case this organization has a grant for.
        </p>
        <ul className="agency-case-list" id="agency-case-list" aria-label="Cases">
          {rows(shown).map((n) => (
            <li key={n} className="agency-case-list-row">
              <a
                href={`/app/agency/o1/cases?case=${caseId(n)}#mission-${caseId(n)}`}
                className="agency-case-list-link"
              >
                <span className="agency-case-list-title">
                  Traveller Number {n} · Visitor Visa Application {n}
                </span>
                <span className="agency-case-list-meta muted">
                  {STAGES[n % STAGES.length]} · {DESTINATIONS[n % DESTINATIONS.length]} · deadline
                  20 Dec 2026 · <span translate="no">C-7K2Q{String(n).padStart(2, '0')}</span>
                </span>
                <span className="agency-case-list-action">Open Case</span>
              </a>
            </li>
          ))}
        </ul>
        <ShowMore
          id="agency-case-list-more"
          landOn="agency-case-list"
          pathname="/app/agency/o1/cases"
          next={shown < total ? { before: 'next-page' } : null}
          shown={shown}
          total={total}
          noun={{ one: 'case', other: 'cases' }}
        />
      </article>
      <p className="card-body u-mt-100 muted">
        Choose a case to open its workspace: its team, notes, tasks and appointments.
      </p>
    </>
  );
}

function activityEntries(count: number): ActivityLogEntry[] {
  const start = Date.UTC(2026, 9, 31, 12, 0, 0);
  return rows(count).map((n) => {
    const at = new Date(start - n * 37 * 60 * 1000);
    return {
      id: `note-${n}`,
      what: `Visitor Visa Application ${n % 10}`,
      detail: `Called the traveller about the bank letter and the second passport page (${n}).`,
      ...(n % 3 === 0 ? {} : { who: n % 2 === 0 ? 'owner@agency.test' : 'case@agency.test' }),
      at: at.toISOString(),
      when: at.toISOString().slice(0, 16).replace('T', ' '),
    };
  });
}

function Activity({ total, shown }: { total: number; shown: number }) {
  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Case Activity</h1>
        <p className="page-description">
          Recent notes on cases you can access. This is case activity, not a complete organization
          audit log.
        </p>
      </header>
      <article className="card">
        <p className="card-body">
          Showing notes from the ten most recently updated accessible cases. Open a case for its
          full history.
        </p>
        <nav className="agency-activity-cases" aria-label="Cases in this activity">
          <span className="muted u-fs-085">Open a case:</span>
          <ul>
            {rows(10).map((n) => (
              <li key={n}>
                <a href={`/app/agency/o1/cases?case=${caseId(n)}#mission-${caseId(n)}`}>
                  Visitor Visa Application {n}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <ActivityLog
          id="case-activity"
          label="Case Activity Entries"
          entries={activityEntries(shown)}
          {...(shown < total
            ? { olderHref: '/app/agency/o1/activity?before=x#case-activity' }
            : {})}
        />
      </article>
    </>
  );
}

function Clients({
  total,
  shown,
  invitationsOpen,
}: { total: number; shown: number; invitationsOpen: boolean }) {
  // WP-SB11: the Clients page lists requests 10 at a time (invitations stay at 15, folded).
  const requestsShown = Math.min(shown, 10);
  return (
    <>
      <article className="card u-mb-150">
        <p className="card-kicker">Intake</p>
        <h2 className="card-title">Clients</h2>
        <p className="card-body u-mb-125">
          Invite a traveller as a new client. They alone choose which of their own traveller
          profiles the resulting case attaches to, and their acceptance is what actually grants this
          organization access, never the invitation itself.
        </p>
        {/* WP-SB11: the pending invitations fold into their own group, closed while there are
            requests to follow, as on the real page. */}
        <CollapsibleGroup
          id="client-invitations"
          title="Pending Invitations"
          count={total}
          noun={{ one: 'pending invitation', other: 'pending invitations' }}
          open={invitationsOpen}
        >
          <div className="rows u-mb-100" id="client-invitation-list">
            {rows(shown).map((n) => (
              <div className="row" key={n}>
                <span className="row-key">
                  Client Number {n}
                  <span
                    className="muted"
                    style={{ fontSize: 'var(--text-small)', marginLeft: '0.5rem' }}
                  >
                    client-{n}@example.test
                  </span>
                </span>
                <span className="row-end">
                  <span className="badge badge-warning">Invited &middot; expires 20 Dec 2026</span>
                  <button type="button" className="btn btn-secondary u-btn-sm">
                    Revoke
                  </button>
                </span>
              </div>
            ))}
          </div>
          <ShowMore
            id="client-invitation-more"
            landOn="client-invitation-list"
            pathname="/app/agency/o1/clients"
            next={shown < total ? { invitesBefore: 'next' } : null}
            shown={shown}
            total={total}
            noun={{ one: 'pending invitation', other: 'pending invitations' }}
          />
        </CollapsibleGroup>
        <CollapsibleGroup id="invite-client" title="Invite a Client">
          <p>The invitation form.</p>
        </CollapsibleGroup>
      </article>
      <article className="card u-mb-150">
        <p className="card-kicker">Collect</p>
        <h2 className="card-title">Request Evidence</h2>
        <p className="card-body u-mb-125">
          Ask a traveller for a specific field or document. They decide whether to fulfil it.
        </p>
        <CollapsibleGroup id="ask-for-evidence" title="Ask for a Field or Document">
          <p>The request form.</p>
        </CollapsibleGroup>
      </article>
      <article className="card">
        <p className="card-kicker">Activity</p>
        <h2 className="card-title" id="agency-evidence-requests">
          Evidence Requests
        </h2>
        <nav className="quick-views u-mt-050" aria-label="Evidence requests by status">
          {['All 320', 'Open 300', 'Waiting on You 12', 'Needs Replacement 3', 'Closed 5'].map(
            (label, n) => (
              <a
                key={label}
                href="/app/agency/o1/clients?status=open#agency-evidence-requests"
                className={`quick-view${n === 1 ? ' quick-view-on' : ''}`}
                aria-current={n === 1 ? 'true' : undefined}
              >
                {label}
              </a>
            ),
          )}
        </nav>
        <div className="rows u-mt-050" id="agency-evidence-request-list">
          {rows(requestsShown).map((n) => (
            <div
              className="row"
              key={n}
              id={`request-r${n}`}
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.2rem' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                <span className="row-key">Document: Bank Statement</span>
                <span className="badge badge-warning">Open</span>
              </div>
              <span className="muted u-fs-085">Traveller Number {n} · due 20 Dec 2026</span>
              <ReferenceCode
                code={`R-${String(n).padStart(4, '0')}-7K2Q`}
                label="Request Reference"
              />
            </div>
          ))}
        </div>
        <ShowMore
          id="agency-evidence-request-more"
          landOn="agency-evidence-request-list"
          pathname="/app/agency/o1/clients"
          next={requestsShown < total ? { requests: requestsShown + 10 } : null}
          shown={requestsShown}
          total={total}
          noun={{ one: 'request', other: 'requests' }}
        />
      </article>
    </>
  );
}

/**
 * The dashboard's case table with the same seven columns, badges and readiness ring as the real
 * page, worst case for height: every row has a ring, two attention badges and an assignee
 * (WP-SB11 brought this in line with the page, which the earlier five-column copy understated).
 */
function Dashboard({ total, shown }: { total: number; shown: number }) {
  return (
    <section className="card" aria-labelledby="inbox-heading">
      <h2 className="card-title" id="inbox-heading">
        Cases and Attention
      </h2>
      <p className="card-body u-mb-100">Cases that need action come first.</p>
      <nav className="quick-views u-mt-100" aria-label="Quick views of the case list">
        {['All 200', 'Mine 40', 'Needs Assignment 12', 'Overdue 9', 'Waiting on Traveller 30'].map(
          (label, n) => (
            <a
              key={label}
              href="/app/agency/o1?quick=mine"
              className={`quick-view${n === 0 ? ' quick-view-on' : ''}`}
              aria-current={n === 0 ? 'true' : undefined}
            >
              {label}
            </a>
          ),
        )}
      </nav>
      <table className="data-table agency-case-table u-mt-100">
        <caption className="sr-only">Cases, Most Urgent First</caption>
        <thead>
          <tr>
            <th scope="col">Case</th>
            <th scope="col">Stage</th>
            <th scope="col">Readiness</th>
            <th scope="col">Deadline</th>
            <th scope="col">Needs Attention</th>
            <th scope="col">Assigned</th>
            <th scope="col">Traveller Confirmed</th>
          </tr>
        </thead>
        <tbody id="agency-case-table-rows">
          {rows(shown).map((n) => (
            <tr key={n}>
              <th scope="row" className="cell-main">
                <a href={`/app/agency/o1/cases#mission-${caseId(n)}`}>
                  Traveller Number {n} · Visitor Visa Application {n}
                </a>
                <span className="cell-sub">{DESTINATIONS[n % DESTINATIONS.length]}</span>
              </th>
              <td data-label="Stage">{STAGES[n % STAGES.length]}</td>
              <td data-label="Readiness">
                <StatusBadge tone="neutral">3 missing</StatusBadge>
                <span className="progress-ring-row">
                  <CaseReadinessRing
                    size="sm"
                    readiness={{ requiredCount: 12, satisfiedRequired: 9 }}
                  />
                </span>
              </td>
              <td data-label="Deadline">20 Dec 2026</td>
              <td data-label="Needs Attention">
                <span className="case-row-badges">
                  <StatusBadge tone="warning">1 open request</StatusBadge>
                  <StatusBadge tone="danger">2 overdue tasks</StatusBadge>
                </span>
              </td>
              <td data-label="Assigned">
                <span className="cell-sub">case@agency.test</span>
              </td>
              <td data-label="Traveller Confirmed">Not yet acknowledged</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="agency-case-table-end">
        <ShowMore
          id="agency-case-table-more"
          landOn="agency-case-table-rows"
          pathname="/app/agency/o1"
          next={shown < total ? { show: shown + 5 } : null}
          shown={shown}
          total={total}
          noun={{ one: 'case', other: 'cases' }}
        />
        <a href="/app/agency/o1/cases" className="btn btn-secondary u-btn-sm">
          View All Cases
        </a>
      </div>
    </section>
  );
}

export default function Sb5Fixture({ view, total, shown, invitationsOpen }: Sb5FixtureProps) {
  if (view === 'cases') return <Cases total={total} shown={shown} />;
  if (view === 'activity') return <Activity total={total} shown={shown} />;
  if (view === 'clients') {
    return <Clients total={total} shown={shown} invitationsOpen={invitationsOpen ?? false} />;
  }
  return <Dashboard total={total} shown={shown} />;
}
