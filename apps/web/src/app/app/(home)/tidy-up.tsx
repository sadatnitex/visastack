import Link from 'next/link';
import { atLevel } from '../../../components/depth';
import { plural } from '../../../lib/plural';

/*
 * Tidy Up on Home (LC-C): a calm card, shown only when there is something to tidy, with one
 * action that opens the documents where it can be done. Counts only, never a document's name.
 */

export interface TidyUpTotals {
  readonly duplicates: number;
  readonly expired: number;
  readonly replaced: number;
}

/**
 * "2 exact copies, 1 expired document and 1 replaced document could be tidied away." Counts for
 * one record; `otherRecords` says how many more records have something too.
 */
export function tidyUpLine(totals: TidyUpTotals, otherRecords = 0): string {
  const parts = [
    totals.duplicates > 0 ? plural(totals.duplicates, 'exact copy', 'exact copies') : null,
    totals.expired > 0 ? plural(totals.expired, 'expired document') : null,
    totals.replaced > 0 ? plural(totals.replaced, 'replaced document') : null,
  ].filter((part): part is string => part !== null);
  const listed =
    parts.length <= 1
      ? (parts[0] ?? '')
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const others =
    otherRecords > 0
      ? ` ${otherRecords === 1 ? 'One other traveller has' : `${otherRecords} other travellers have`} some too.`
      : '';
  return `${listed.charAt(0).toUpperCase()}${listed.slice(1)} could be tidied away in one record.${others} Nothing changes until you choose.`;
}

export function TidyUpCard({ line, href }: { readonly line: string; readonly href: string }) {
  return (
    <section
      className="card u-mb-150 lc-tidy-up"
      aria-labelledby="home-tidy-up-heading"
      {...atLevel('glance')}
    >
      <h2 className="card-title" id="home-tidy-up-heading">
        Tidy Up
      </h2>
      <p className="lc-tidy-up-line">{line}</p>
      <Link className="btn btn-secondary" href={href}>
        Tidy Up Documents
      </Link>
    </section>
  );
}
