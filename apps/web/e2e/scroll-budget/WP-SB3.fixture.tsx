import { ActivityLog, type ActivityLogEntry } from '../../src/components/activity-log';
import { ShowMore } from '../../src/components/show-more';

/**
 * WP-SB3 scroll budget fixture: the capped parts of the sharing, insights, evidence and shared
 * view pages, with the same classes and the same row caps the pages use, filled with made-up
 * worst-case data. The page tests prove the caps on the real pages; this measures their height.
 */
export interface Sb3FixtureProps {
  readonly view: 'sharing' | 'insights' | 'evidence' | 'shared';
  /** Rows the page holds in all (40 grants, 100 documents, 30 requests or items). */
  readonly total: number;
  /** Rows the page shows at once (the cap). */
  readonly shown: number;
  /** Access log entries on the sharing page. */
  readonly logEntries?: number;
}

const PEOPLE = ['agent@example.test', 'System', 'reviewer@example.test'];

function logEntries(count: number): ActivityLogEntry[] {
  const start = Date.UTC(2026, 9, 31, 12, 0, 0);
  return Array.from({ length: count }, (_, n) => {
    const at = new Date(start - n * 41 * 60 * 1000);
    return {
      id: String(count - n),
      what: n % 2 === 0 ? 'Document Viewed' : 'Grant Accepted',
      who: PEOPLE[n % PEOPLE.length] ?? 'System',
      outcome: { label: 'Allowed', tone: 'success' as const },
      at: at.toISOString(),
      when: at.toISOString().slice(0, 16).replace('T', ' '),
    };
  });
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

function Sharing({ total, shown, logCount }: { total: number; shown: number; logCount: number }) {
  return (
    <>
      <Header
        title="Sharing"
        description="You control every grant. Access is purpose-bound, takes effect only once accepted, and can be paused or revoked at any time."
      />
      <div className="sharing-workspace">
        <div className="sharing-access-column">
          <article className="card">
            <p className="card-kicker">Controlled Collaboration</p>
            <h2 className="card-title">Who Has Access</h2>
            <p className="card-body">
              {`${total} active grants. Pending, paused and ended grants are labelled separately below.`}
            </p>
            <div className="rows u-mt-050">
              {rows(shown).map((n) => (
                <div
                  className="row sharing-grant"
                  id={`sharing-grant-${n + 1}`}
                  key={n}
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <span className="row-key">{`Made-up Agency ${n + 1} (organization)`}</span>
                    <span className="badge badge-success">Active</span>
                  </div>
                  <details className="sharing-grant-details">
                    <summary className="sharing-grant-details-summary">Grant Details</summary>
                    <p>Visa review: can view the profile and three documents.</p>
                  </details>
                  <p className="muted" style={{ margin: 0, fontSize: 'var(--text-small)' }}>
                    Pause stops access straight away and you can resume it later. Revoke ends this
                    access.
                  </p>
                  <div className="row-end">
                    <button className="btn btn-secondary" type="button">
                      Pause
                    </button>
                    <button className="btn btn-danger" type="button">
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <ShowMore
              id="sharing-grants-more"
              pathname="/app/applicant/a1/sharing"
              next={shown < total ? { show: shown + 5 } : null}
              shown={shown}
              total={total}
              noun={{ one: 'grant', other: 'grants' }}
              landOn={`sharing-grant-${shown + 1}`}
            />
          </article>
          <article className="card">
            <p className="card-kicker">Transparency</p>
            <h2 className="card-title">Access Log</h2>
            <ActivityLog entries={logEntries(logCount)} label="Access Log Entries" />
          </article>
        </div>
      </div>
    </>
  );
}

function InsightsCard({
  id,
  title,
  count,
  open,
  shown,
}: {
  id: string;
  title: string;
  count: number;
  open: boolean;
  shown: number;
}) {
  return (
    <section className="card insights-card" aria-labelledby={id}>
      <p className="card-kicker">Insights</p>
      <h3 className="card-title" id={id}>
        {title}
      </h3>
      <details className="insights-card-fold" open={open || undefined}>
        <summary className="insights-card-summary">
          <span className="insights-card-list">Documents</span>
          <span className="insights-card-count" aria-hidden="true">
            {count}
          </span>
        </summary>
        <div className="insights-card-body">
          <ol className="insights-list">
            {rows(Math.min(shown, count)).map((n) => (
              <li className="insights-row" key={n}>
                <span className="insights-row-text">
                  <span className="insights-row-label">{`Passport ${n + 1}`}</span>
                  <span className="insights-row-detail">Expires in about 3 months</span>
                </span>
                <span className="badge badge-warning">Soon</span>
              </li>
            ))}
          </ol>
          {count > shown ? (
            <p className="insights-more">
              <span className="insights-note">{`Showing ${shown} of ${count} documents.`}</span>{' '}
              <a className="btn btn-secondary insights-action" href="/app/applicant/a1/documents">
                Open Documents
              </a>
            </p>
          ) : null}
        </div>
      </details>
    </section>
  );
}

function Insights({ total, shown }: { total: number; shown: number }) {
  const cards = [
    'Details to Check',
    'Expiry Timeline',
    'Readiness by Case',
    'Originals to Bring',
    'Sections Backed by a Document',
    'Documents Behind Your Details',
  ];
  return (
    <>
      <Header
        title="What Your Documents Show"
        description="A summary of your saved documents and profile. It never shows the details themselves, and nothing here changes your profile."
      />
      <ul className="insights-summary" aria-label="Summary">
        {['Documents', 'Details to Check', 'Expired or Expiring Soon', 'Sections'].map((label) => (
          <li className="insights-summary-item" key={label}>
            <span className="insights-summary-value">{total}</span>
            <span className="insights-summary-label">{label}</span>
          </li>
        ))}
      </ul>
      <div className="insights-grid">
        {cards.map((title, n) => (
          <InsightsCard
            key={title}
            id={`insights-${n}`}
            title={title}
            count={total}
            open={n === 1}
            shown={shown}
          />
        ))}
      </div>
    </>
  );
}

function Evidence({ total, shown }: { total: number; shown: number }) {
  return (
    <>
      <Header
        title="Evidence Requests"
        description="An agency request is that organisation asking you for something, never an official visa requirement on its own."
      />
      <article className="card">
        <div className="rows">
          {rows(shown).map((n) => (
            <div className="case-row request-item request-item-neutral" key={n}>
              <div className="case-row-head">
                <span className="case-row-title" id={`evidence-row-${n + 1}`}>
                  {`Document: Bank Statement ${n + 1}`}
                </span>
                <span className="case-row-badges">
                  <span className="badge badge-success">Reviewed</span>
                </span>
              </div>
              <p className="case-row-meta u-m-0">Accepted by the agency.</p>
            </div>
          ))}
        </div>
        <ShowMore
          id="evidence-requests-more"
          pathname="/app/applicant/a1/evidence"
          next={shown < total ? { show: shown + 10 } : null}
          shown={shown}
          total={total}
          noun={{ one: 'request', other: 'requests' }}
          landOn={`evidence-row-${shown + 1}`}
        />
      </article>
    </>
  );
}

function Shared({ total, shown }: { total: number; shown: number }) {
  return (
    <>
      <Header title="Made-up Traveller" description="Visa review" />
      <div className="grid">
        {(['detail', 'document'] as const).map((kind) => (
          <article className="card" key={kind}>
            <h2 className="card-title">
              {kind === 'detail' ? 'Shared Fields' : 'Shared Documents'}
            </h2>
            <div className="rows u-mt-050">
              {rows(shown).map((n) => (
                <div className="row" key={n}>
                  <span className="row-key" id={`shared-${kind}-${n + 1}`}>
                    {kind === 'detail' ? `Made-up Detail ${n + 1}` : `File ${n + 1}.pdf`}
                  </span>
                  <span>{kind === 'detail' ? 'Made-up value' : 'Bank Statement'}</span>
                </div>
              ))}
            </div>
            <ShowMore
              id={`shared-${kind}s-more`}
              pathname="/app/shared/g1"
              next={shown < total ? { [kind === 'detail' ? 'fields' : 'docs']: shown + 10 } : null}
              shown={shown}
              total={total}
              noun={{ one: kind, other: `${kind}s` }}
              landOn={`shared-${kind}-${shown + 1}`}
            />
          </article>
        ))}
      </div>
    </>
  );
}

export default function Sb3Fixture({
  view,
  total,
  shown,
  logEntries: logCount = 300,
}: Sb3FixtureProps) {
  if (view === 'sharing') return <Sharing total={total} shown={shown} logCount={logCount} />;
  if (view === 'insights') return <Insights total={total} shown={shown} />;
  if (view === 'evidence') return <Evidence total={total} shown={shown} />;
  return <Shared total={total} shown={shown} />;
}
