import { QueuePaging } from '../../src/app/app/admin/email/queue-paging';
import { QueuePanel } from '../../src/app/app/admin/email/queue-panel';
import { ActivityLog, type ActivityLogEntry } from '../../src/components/activity-log';

/**
 * WP-SB6 scroll budget fixture: the staff operations pages (overview, audit, email delivery,
 * complaints, access) with the same classes, panels and per-load caps the pages use, filled with
 * made-up worst-case data (1,000 rows behind every list, of which one load shows). The page tests
 * prove the real pages apply these caps and read the next load from the server; this measures
 * their height.
 */
export interface Sb6FixtureProps {
  readonly view: 'overview' | 'audit' | 'email' | 'complaints' | 'access';
  /** Rows behind every list (1,000 in the acceptance check). */
  readonly total: number;
  /** Rows one load shows; the pages use 50 for queues and logs, 20 complaints, 25 invitations. */
  readonly shown?: number;
  /** Render the lists without their fixed boxes, to prove the budget fails without them. */
  readonly unboxed?: boolean;
}

function rows(count: number): number[] {
  return Array.from({ length: count }, (_, n) => n);
}

function Header({ title, description }: { readonly title: string; readonly description: string }) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <span className="eyebrow">Platform</span>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
    </header>
  );
}

/**
 * A staff queue, drawn with the pages' own QueuePanel (search, kind filter and the fixed box) and
 * QueuePaging. `unboxed` draws the same rows as a plain list, to prove the budget fails without it.
 */
function Panel({
  id,
  label,
  unboxed,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly unboxed: boolean | undefined;
  readonly children: React.ReactElement[];
}) {
  if (unboxed) return <ul className="rows">{children}</ul>;
  return (
    <QueuePanel
      id={id}
      label={label}
      pageKey="first"
      items={children.map((child, n) => {
        const props = child.props as { className?: string; children?: React.ReactNode };
        return {
          id: `${id}-${n}`,
          find: `row ${n}`,
          kind: n % 2 === 0 ? 'First Kind' : 'Second Kind',
          ...(props.className ? { className: props.className.replace(/^row\s*/, '') } : {}),
          node: props.children,
        };
      })}
    />
  );
}

function Paging({
  landOn,
  shown,
  total,
  noun,
}: {
  readonly id?: string;
  readonly landOn: string;
  readonly shown: number;
  readonly total: number;
  readonly noun: { one: string; other: string };
}) {
  return (
    <QueuePaging
      pathname="/app/admin"
      search={{}}
      param="before"
      cursor={shown < total ? 'CURSOR' : null}
      later={false}
      landOn={landOn}
      shown={shown}
      total={total}
      noun={noun}
    />
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="card admin-summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function Overview({
  total,
  shown,
  unboxed,
}: { total: number; shown: number; unboxed?: boolean | undefined }) {
  return (
    <section className="section container platform-operations">
      <Header
        title="Platform Overview"
        description="Platform health, readiness, capacity and pilot measurement."
      />
      <output className="notice notice-warn u-mb-150">
        Authenticator codes are not required for staff yet. <a href="#x">Set up your app</a>.
      </output>
      <div className="admin-reference-metrics">
        <Metric label="Registered Accounts" value="1000" hint="Current account records" />
        <Metric label="Traveller Records" value="1000" hint="Saved records, not active users" />
        <Metric label="Agencies" value="1000" hint="Current organization records" />
        <Metric label="Approved File Versions" value="92%" hint="Approved among outcomes" />
      </div>
      <div className="admin-operational-summary">
        <Metric label="Signals Needing Attention" value="3" hint="Warnings and critical signals" />
        <Metric label="Failed Intake Jobs" value={String(total)} hint="Recorded failures" />
        <Metric label="Platform Readiness" value="Needs Attention" hint="Deployment checks" />
      </div>
      <article className="card admin-failed-jobs" id="admin-processing">
        <p className="card-kicker">Processing</p>
        <h2 className="card-title">Failed Intake Jobs</h2>
        <p className="card-body">
          Emails that did not arrive have their own page. <a href="#x">Open Email Delivery</a>
        </p>
        <Panel id="admin-failed-jobs-panel" label="Failed Intake Jobs" unboxed={unboxed}>
          {rows(shown).map((n) => (
            <li className="row failed-job-row" key={n}>
              <div className="failed-job-head">
                <span className="row-key failed-job-name">{`made-up-document-${n}.pdf`}</span>
                <span className="row-end">
                  <span className="badge badge-neutral">ocr_timeout</span>
                  <span className="badge badge-danger">5/5 attempts</span>
                  <button className="btn btn-secondary" type="button">
                    Retry
                  </button>
                </span>
              </div>
              <span className="muted failed-job-error">Reading timed out after 30 seconds</span>
            </li>
          ))}
        </Panel>
        <Paging
          id="failed-jobs-more"
          landOn="admin-failed-jobs-panel"
          shown={shown}
          total={total}
          noun={{ one: 'failed job', other: 'failed jobs' }}
        />
      </article>
      <div className="admin-overview-groups">
        <h2 className="sr-only">More Operational Details and Tools</h2>
        {[
          'Activity and Adoption',
          'Product Scorecard',
          'Providers and Capacity',
          'All Operational Signals',
          'Readiness',
          'Learning Areas',
          'Storage Integrity',
          'Jump to a Section',
        ].map((title) => (
          <details className="admin-overview-controls admin-overview-group" key={title}>
            <summary>{title}</summary>
            <div className="admin-overview-group-body">
              <article className="card">
                <h2 className="card-title">{title}</h2>
                {rows(49).map((n) => (
                  <p className="card-body" key={n}>{`${title} line ${n}`}</p>
                ))}
              </article>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

const PEOPLE = ['agent@example.test', 'System', 'security@example.test', 'Removed Account'];

function auditEntries(count: number): ActivityLogEntry[] {
  const start = Date.UTC(2026, 9, 31, 12, 0, 0);
  return rows(count).map((n) => {
    const at = new Date(start - n * 17 * 60 * 1000);
    return {
      id: String(100_000 - n),
      what: n % 2 === 0 ? 'Document Viewed' : 'Access Denied',
      detail: 'Code DOCUMENT_VIEWED · Resource document',
      who: PEOPLE[n % PEOPLE.length] ?? 'System',
      outcome:
        n % 2 === 0
          ? { label: 'Allowed', tone: 'neutral' as const }
          : { label: 'Denied', tone: 'danger' as const },
      at: at.toISOString(),
      when: at.toISOString().slice(0, 16).replace('T', ' '),
    };
  });
}

function Audit({ shown }: { shown: number }) {
  return (
    <section className="section container">
      <Header title="Audit" description="The platform's append-only, hash-chained audit trail." />
      <article className="card u-mt-150" id="admin-audit">
        <p className="card-kicker">Transparency</p>
        <h2 className="card-title">Recent Audit Events</h2>
        <p className="card-body u-mb-100">
          The platform's append-only, hash-chained audit trail: every sensitive action across every
          tenant.
        </p>
        <form method="get" action="/app/admin/audit" className="audit-who-search u-mb-100">
          <label className="field-label" htmlFor="audit-who">
            Find by Email
          </label>
          <input
            id="audit-who"
            className="input"
            type="email"
            name="who"
            placeholder="person@example.com"
            aria-describedby="audit-who-help"
          />
          <button type="submit" className="btn btn-secondary">
            Find Entries
          </button>
          <p id="audit-who-help" className="muted u-fs-085 audit-who-help">
            Find everything one person did, across the whole trail, by the email they sign in with.
          </p>
        </form>
        <ActivityLog
          label="Audit Events"
          id="admin-audit-log"
          olderHref="/app/admin/audit?before=CURSOR#admin-audit-log"
          entries={auditEntries(shown)}
        />
      </article>
    </section>
  );
}

function EmailRows({ shown, failed }: { shown: number; failed: boolean }) {
  return rows(shown).map((n) => (
    <li className="row" key={n}>
      <div>
        <p className="row-key">Client Invitation</p>
        <p className="muted u-fs-085">
          To an address at example.org. Made 1 Oct 2026, 09:00. 5 tries.
        </p>
        <p className="card-body">
          {failed ? 'The mail service could not send it. It can be sent again.' : 'Not tried yet.'}
        </p>
      </div>
      {failed ? (
        <div className="row-end">
          <button className="btn btn-secondary" type="button">
            Send Again
          </button>
        </div>
      ) : null}
    </li>
  ));
}

function Email({
  total,
  shown,
  unboxed,
}: { total: number; shown: number; unboxed?: boolean | undefined }) {
  return (
    <section className="section container">
      <Header
        title="Email Delivery"
        description="Emails VisaStack sends for people, such as invitations and reminders, that did not arrive or are still waiting to go out."
      />
      <div className="admin-operational-summary">
        <Metric label="Sent Today" value="1000" hint="In the last 24 hours" />
        <Metric label="Arrived Today" value="900" hint="Confirmed as received" />
        <Metric label="Did Not Arrive Today" value="100" hint="Failed or refused" />
        <Metric label="Waiting Now" value={String(total)} hint="Not sent yet" />
      </div>
      <article className="card u-mt-150">
        <h2 className="card-title">Emails That Did Not Arrive</h2>
        <Panel id="email-failed-panel" label="Emails That Did Not Arrive" unboxed={unboxed}>
          {EmailRows({ shown, failed: true })}
        </Panel>
        <Paging
          id="email-failed-more"
          landOn="email-failed-panel"
          shown={shown}
          total={total}
          noun={{ one: 'email', other: 'emails' }}
        />
      </article>
      <article className="card u-mt-150">
        <h2 className="card-title">Emails Still Waiting</h2>
        <p className="card-body">
          Emails not sent more than 10 minutes after they were made. They are tried again on their
          own.
        </p>
        <Panel id="email-waiting-panel" label="Emails Still Waiting" unboxed={unboxed}>
          {EmailRows({ shown, failed: false })}
        </Panel>
        <Paging
          id="email-waiting-more"
          landOn="email-waiting-panel"
          shown={shown}
          total={total}
          noun={{ one: 'email', other: 'emails' }}
        />
      </article>
    </section>
  );
}

function Complaints({
  total,
  shown,
  unboxed,
}: { total: number; shown: number; unboxed?: boolean | undefined }) {
  return (
    <section className="section container">
      <Header title="Complaint & Feedback Triage" description="Quality oversight." />
      <article className="card u-mb-150">
        <p className="card-kicker">Oversight</p>
        <h2 className="card-title">Complaints</h2>
        <nav aria-label="Complaints by Status" className="pill-list complaint-tabs u-mb-100">
          {['Open', 'Being Handled', 'Resolved', 'Closed'].map((label, n) => (
            <a
              key={label}
              className="pill"
              href={`/app/admin/complaints?status=${n}`}
              aria-current={n === 0 ? 'page' : undefined}
            >
              {`${label} (${total})`}
            </a>
          ))}
        </nav>
        <Panel id="complaints-list" label="Complaints" unboxed={unboxed}>
          {rows(shown).map((n) => (
            <li className="row complaint-row" key={n}>
              <div className="complaint-row-head">
                <span className="row-key">{`Case 0000-${n}`}</span>
                <span className="badge badge-warning">Open</span>
              </div>
              <p className="muted complaint-row-text">
                The agency did not answer my messages for two weeks and the appointment was missed.
              </p>
              <p className="muted u-fs-075-m0">Filed 1 Oct 2026 · Unassigned</p>
              <details className="complaint-actions">
                <summary>Assign or Update</summary>
                <p>Assign and status forms.</p>
              </details>
            </li>
          ))}
        </Panel>
        <Paging
          id="complaints-more"
          landOn="complaints-list"
          shown={shown}
          total={total}
          noun={{ one: 'complaint', other: 'complaints' }}
        />
      </article>
      <article className="card">
        <p className="card-kicker">Oversight</p>
        <h2 className="card-title">Private Feedback</h2>
        <p className="card-body u-mb-100">
          Never visible to the agency being reviewed, and never a public review or ranking.
        </p>
        <Panel id="feedback-panel" label="Private Feedback Entries" unboxed={unboxed}>
          {rows(50).map((n) => (
            <li className="row feedback-row" key={n}>
              <span className="row-key">{`Case 0000-${n}`}</span>
              <span className="u-fs-085">Helpful and quick. Would use again.</span>
              <span className="muted u-fs-075">1 Oct 2026</span>
            </li>
          ))}
        </Panel>
        <Paging
          id="feedback-more"
          landOn="feedback-panel"
          shown={50}
          total={total}
          noun={{ one: 'feedback entry', other: 'feedback entries' }}
        />
      </article>
    </section>
  );
}

function InvitationRows({ shown, state }: { shown: number; state: 'Pending' | 'Accepted' }) {
  return rows(shown).map((n) => (
    <li className="row invitation-row" key={n}>
      <div className="invitation-row-head">
        <span className="row-key invitation-email">{`invitee-${n}@example.test`}</span>
        <span className="row-end">
          <span className={`badge ${state === 'Pending' ? 'badge-neutral' : 'badge-success'}`}>
            {state}
          </span>
          <button className="btn btn-danger" type="button">
            Revoke
          </button>
        </span>
      </div>
      <span className="muted u-fs-085">Pilot tester · invited 1 Oct 2026</span>
    </li>
  ));
}

function Access({
  total,
  shown,
  unboxed,
}: { total: number; shown: number; unboxed?: boolean | undefined }) {
  return (
    <section className="section container">
      <Header
        title="Access"
        description="Who holds a platform role, and who may sign in during the controlled pilot."
      />
      <div className="grid u-mb-150">
        <article className="card" id="admin-security">
          <p className="card-kicker">Identity</p>
          <h2 className="card-title">Platform Roles</h2>
          <p className="card-body u-mb-100">
            Platform roles determine who can manage the service. Role history is retained when
            access is revoked.
          </p>
          <div className="rows u-mb-125">
            {['Platform Owner', 'Security Admin', 'Quality Admin'].map((role) => (
              <div className="row" key={role}>
                <span className="row-key">{role}</span>
                <span className="muted u-fs-085">1 Sep 2026</span>
              </div>
            ))}
          </div>
          <p className="muted u-fs-085">Only a platform owner can grant or revoke roles.</p>
        </article>
        <article className="card" id="admin-pilot-access">
          <p className="card-kicker">Controlled Pilot</p>
          <h2 className="card-title">Pilot Access</h2>
          <p className="card-body u-mb-100">
            This is an invite-only controlled pilot. An invitation is never deleted, only revoked.
          </p>
          <h3 className="pilot-list-title">Waiting to Be Used</h3>
          <Panel id="pilot-pending-list" label="Invitations Waiting to Be Used" unboxed={unboxed}>
            {InvitationRows({ shown, state: 'Pending' })}
          </Panel>
          <Paging
            id="pilot-pending-more"
            landOn="pilot-pending-list"
            shown={shown}
            total={total}
            noun={{ one: 'invitation', other: 'invitations' }}
          />
          <h3 className="pilot-list-title u-mt-125">Accepted and Revoked</h3>
          <Panel
            id="pilot-history-panel"
            label="Accepted and Revoked Invitations"
            unboxed={unboxed}
          >
            {InvitationRows({ shown, state: 'Accepted' })}
          </Panel>
          <Paging
            id="pilot-history-more"
            landOn="pilot-history-panel"
            shown={shown}
            total={total}
            noun={{ one: 'invitation', other: 'invitations' }}
          />
          <p className="muted u-fs-085">Only a platform owner can invite or revoke pilot access.</p>
        </article>
      </div>
    </section>
  );
}

export default function Sb6Fixture({ view, total, shown, unboxed }: Sb6FixtureProps) {
  if (view === 'overview') return <Overview total={total} shown={shown ?? 50} unboxed={unboxed} />;
  if (view === 'audit') return <Audit shown={shown ?? 50} />;
  if (view === 'email') return <Email total={total} shown={shown ?? 50} unboxed={unboxed} />;
  if (view === 'complaints')
    return <Complaints total={total} shown={shown ?? 20} unboxed={unboxed} />;
  return <Access total={total} shown={shown ?? 25} unboxed={unboxed} />;
}
