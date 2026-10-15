import type { DestinationSource } from '@visastack/core/destinations';
import { checkedOnLabel, trustNotes } from '../lib/country-view';

/**
 * Where a country fact came from: the page, who published it, when it was checked, and any warning about
 * how far to rely on it. Every fact on the country screens carries one, so nobody has to guess.
 */
export function SourceNote({ source }: { readonly source: DestinationSource | null }) {
  const notes = trustNotes(source);
  return (
    <div className="source-note">
      {source ? (
        <span>
          Source:{' '}
          <a href={source.url} target="_blank" rel="noopener noreferrer">
            {source.title ?? source.publisher ?? source.url}
          </a>
          {source.publisher && source.title ? ` (${source.publisher})` : ''}
        </span>
      ) : null}
      <span className="muted">{checkedOnLabel(source)}</span>
      {notes.map((note) => (
        <span className="badge badge-warning" key={note}>
          {note}
        </span>
      ))}
      {source?.exactWords ? (
        <details className="source-note-words">
          <summary>Words copied from the source</summary>
          <p>{source.exactWords}</p>
        </details>
      ) : null}
    </div>
  );
}
