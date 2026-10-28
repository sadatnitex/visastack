import type { AiConnectionCounts } from '@visastack/services';

export interface AiConnectionsCardProps {
  /** `null` when the counts could not be read for this person (no staff scope). */
  readonly counts: AiConnectionCounts | null;
  /** Whether AI apps can connect on this site at all (the AI_CONNECTOR_ENABLED switch). */
  readonly enabled: boolean;
}

/**
 * The staff count of AI app connections (S16): totals for the whole platform, never anything
 * about one person, app or case. Zero is shown as zero; counts that cannot be read yet say so.
 */
export function AiConnectionsCard({ counts, enabled }: AiConnectionsCardProps) {
  const rows =
    counts?.available === true
      ? [
          { key: 'Active Connections', value: counts.active },
          { key: 'Connections Turned Off', value: counts.turnedOff },
          { key: 'Requests Answered in the Last 7 Days', value: counts.served },
          { key: 'Requests Refused in the Last 7 Days', value: counts.denied },
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
      ) : (
        <p className="muted">
          Not available yet. The counts appear once AI app connections are set up on this site.
        </p>
      )}
    </article>
  );
}
