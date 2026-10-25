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

  const usable = rows.filter((row) => row.tone !== 'neutral');
  const notYet = rows.filter((row) => row.tone === 'neutral');
  const featureList = (list: typeof rows) => (
    <div className="rows u-mt-050">
      {list.map((row) => (
        <div className="row" key={row.key}>
          <span className="row-key">{row.name}</span>
          <span className={badgeClass(row.tone)}>{row.label}</span>
        </div>
      ))}
    </div>
  );

  return (
    <section className="section container">
      <div className="section-head status-head">
        <span className="eyebrow">Live</span>
        <h1 className="section-title u-m-0">What Works Today</h1>
        {/* The answer comes first. <output> is what a screen reader announces when it changes. */}
        <output className={`${badgeClass(verdict.tone)} status-verdict`}>{verdict.label}</output>
        <p className="section-sub u-m-0">
          Features that are not switched on yet are listed too, so you always know what to expect.
        </p>
      </div>

      {rows.length === 0 ? (
        <article className="card">
          <h2 className="card-title">Features</h2>
          <p className="muted u-m-0">
            {ready === null
              ? 'Checking which features are working…'
              : 'The list of features is not available right now.'}
          </p>
        </article>
      ) : (
        <>
          {usable.length > 0 ? (
            <article className="card u-mb-125">
              <h2 className="card-title">You can use now</h2>
              {featureList(usable)}
            </article>
          ) : null}
          {notYet.length > 0 ? (
            <article className="card u-mb-125">
              <h2 className="card-title">Not switched on yet</h2>
              {featureList(notYet)}
            </article>
          ) : null}
        </>
      )}

      <div className="toolbar">
        <span className="muted u-fs-085">
          {updatedAt ? `Updated ${updatedAt}. This page checks again by itself.` : 'Loading…'}
        </span>
        {/* Not `disabled`: this page re-checks by itself every 15 seconds, and a button that
            disables itself drops keyboard focus whenever that happens. */}
        <button
          type="button"
          className="btn btn-secondary"
          aria-disabled={loading || undefined}
          onClick={() => {
            if (!loading) onRefresh();
          }}
        >
          {loading ? 'Checking…' : 'Check Now'}
        </button>
      </div>
    </section>
  );
}
