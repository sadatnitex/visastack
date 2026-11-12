import Link from 'next/link';
import { atLevel } from '../../../components/depth';
import { Icon } from '../../../components/icons';
import { appHomeCatalog } from '../../../i18n/app-home';
import { getServerT } from '../../../lib/i18n-server';
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

/**
 * The same counts in few words, for the slim line on Home: "1 expired document to tidy". Another
 * record with something too adds "and more elsewhere"; the full sentence stays for a screen reader.
 */
export function tidyUpShortLine(totals: TidyUpTotals, otherRecords = 0): string {
  const parts = [
    totals.duplicates > 0 ? plural(totals.duplicates, 'exact copy', 'exact copies') : null,
    totals.expired > 0 ? plural(totals.expired, 'expired document') : null,
    totals.replaced > 0 ? plural(totals.replaced, 'replaced document') : null,
  ].filter((part): part is string => part !== null);
  const listed =
    parts.length <= 1
      ? (parts[0] ?? '')
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${listed.charAt(0).toUpperCase()}${listed.slice(1)} to tidy${otherRecords > 0 ? ', and more elsewhere' : ''}`;
}

export function TidyUpCard({
  line,
  short,
  href,
}: {
  readonly line: string;
  readonly short?: string;
  readonly href: string;
}) {
  const t = getServerT(appHomeCatalog);
  return (
    <section
      className="home-tidy u-mb-150"
      aria-labelledby="home-tidy-up-heading"
      {...atLevel('glance')}
    >
      <span className="home-tidy-icon" aria-hidden="true">
        <Icon name="folder" size={20} />
      </span>
      <h2 className="sr-only" id="home-tidy-up-heading">
        {t.node('appHome.appTidyUp.tidyUp')}
      </h2>
      <p className="home-tidy-line">{short ?? line}</p>
      {/* The whole sentence, with its promise that nothing changes until the person chooses, for a screen reader. */}
      {short ? <p className="sr-only">{line}</p> : null}
      <Link
        className="btn home-tidy-button plain-link"
        href={href}
        aria-label={t('appHome.appTidyUp.tidyUpDocuments')}
      >
        {t.node('appHome.appTidyUp.tidyUp')}
      </Link>
    </section>
  );
}
