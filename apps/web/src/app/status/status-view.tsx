import { VERDICT_WORDS, capabilityRows, verdictOf } from './capability-names';

/** What one health check answered: whether it succeeded, the status word it gave, and its body. */
export interface ProbeResult {
  readonly ok: boolean;
  readonly status: string;
  readonly data: {
    readonly status?: unknown;
    readonly platform?: unknown;
    readonly [key: string]: unknown;
  };
}

function badgeClass(tone: string): string {
  switch (tone) {
    case 'success':
      return 'badge badge-success';
    case 'warning':
      return 'badge badge-warning';
    case 'danger':
      return 'badge badge-danger';
    default:
      return 'badge badge-neutral';
  }
}

/**
 * The status page, in everyday words: one headline and a list of what works and what
 * is not switched on yet. It shows nothing a visitor could not already read from the
 * public health response, only worded for a person rather than an engineer, and it
 * never prints a raw key, code or path.
 */
export function StatusView({
  live,
  ready,
  updatedAt,
  loading,
  onRefresh,
}: {
  readonly live: ProbeResult | null;
  readonly ready: ProbeResult | null;
  readonly updatedAt: string;
  readonly loading: boolean;
  readonly onRefresh: () => void;
}) {
  const verdict = VERDICT_WORDS[verdictOf(live, ready)];
  const rows = capabilityRows(ready?.data.platform);

  return (
    <section className="section container">
      <div className="section-head" style={{ textAlign: 'left', marginBottom: '2rem' }}>
        <span className="eyebrow">Live</span>
        <h1 className="section-title" style={{ margin: '0 0 0.5rem' }}>
          What works today
        </h1>
        <p className="section-sub" style={{ margin: 0 }}>
          This page checks the service every 15 seconds. Features that are not switched on yet are
          listed too, so you always know what to expect.
        </p>
      </div>

      <div className="toolbar">
        <span className="muted" style={{ fontSize: '0.9rem' }}>
          {updatedAt ? `Updated ${updatedAt}. Checks again every 15 seconds.` : 'Loading…'}
        </span>
        <button type="button" className="btn btn-secondary" onClick={onRefresh} disabled={loading}>
          {loading ? 'Checking…' : 'Check now'}
        </button>
      </div>

      <article className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="toolbar" style={{ margin: 0 }}>
          <h2 className="card-title" style={{ margin: 0 }}>
            Overall
          </h2>
          <output className={badgeClass(verdict.tone)}>{verdict.label}</output>
        </div>
      </article>

      <article className="card">
        <h2 className="card-title">Features</h2>
        {rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            The list of features is not available right now.
          </p>
        ) : (
          <div className="rows" style={{ marginTop: '0.5rem' }}>
            {rows.map((row) => (
              <div className="row" key={row.key}>
                <span className="row-key">{row.name}</span>
                <span className={badgeClass(row.tone)}>{row.label}</span>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
