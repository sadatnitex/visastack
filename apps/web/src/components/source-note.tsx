import type { DestinationSource } from '@visastack/core/destinations';
import { componentsMoreCatalog } from '../i18n/components-more';
import { checkedOnLabel, trustNotes } from '../lib/country-view';
import { getT } from '../lib/i18n-server';

/**
 * Where a country fact came from: the page, who published it, when it was checked, and any warning about
 * how far to rely on it. Every fact on the country screens carries one, so nobody has to guess.
 */
export async function SourceNote({ source }: { readonly source: DestinationSource | null }) {
  const t = await getT(componentsMoreCatalog);
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
          <summary>{t.node('componentsMore.sourceNote.wordsCopiedFromTheSource')}</summary>
          <p>{source.exactWords}</p>
        </details>
      ) : null}
    </div>
  );
}
