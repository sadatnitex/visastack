import { AI_CONNECTION_COUNT_WINDOW_MS, type AiConnectionCounts } from '@visastack/services';

export interface AiConnectionsCardProps {
  /**
   * The counts; `{ available: false }` before the connection tables exist; `unreadable` when the
   * read failed or was refused this time.
   */
  readonly counts: AiConnectionCounts | 'unreadable';
  /** Whether AI apps can connect on this site at all (the AI_CONNECTOR_ENABLED switch). */
  readonly enabled: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The window the call counts cover, as the service defines it. */
const WINDOW_DAYS = Math.round(AI_CONNECTION_COUNT_WINDOW_MS / DAY_MS);

/**
 * The staff count of AI app connections (S16): totals for the whole platform, never anything
 * about one person, app or case. Zero is shown as zero; counts that cannot be read say why.
 */
export function AiConnectionsCard({ counts, enabled }: AiConnectionsCardProps) {
  const rows =
    counts !== 'unreadable' && counts.available
      ? [
          { key: 'Active Connections', value: counts.active },
          { key: 'Connections Turned Off', value: counts.turnedOff },
          { key: `Requests Answered in the Last ${WINDOW_DAYS} Days`, value: counts.served },
          { key: `Requests Refused in the Last ${WINDOW_DAYS} Days`, value: counts.denied },
        ]
      : null;
  return (
    <article className="card u-mb-150" aria-labelledby="ai-app-connections-title">
      <p className="card-kicker">People’s AI Apps</p>
      <h2 className="card-title" id="ai-app-connections-title">
        AI App Connections
      </h2>
      <p className="card-body u-mb-100">
        {enabled
          ? 'AI apps can connect on this site. These are totals for everyone; no one’s own details are shown.'
          : 'Switched off on this site: no AI app can connect. These are totals for everyone; no one’s own details are shown.'}
      </p>
      {rows ? (
        <div className="rows">
          {rows.map((row) => (
            <div className="row" key={row.key}>
              <span className="row-key">{row.key}</span>
              <span className="row-val">{row.value.toLocaleString('en-GB')}</span>
            </div>
          ))}
        </div>
      ) : counts === 'unreadable' ? (
        <p className="muted">
          The counts could not be read right now. Reload the page to try again.
        </p>
      ) : (
        <p className="muted">
          Not available yet. The counts appear once AI app connections are set up on this site.
        </p>
      )}
    </article>
  );
}
