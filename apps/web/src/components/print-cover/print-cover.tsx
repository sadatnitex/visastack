import { resolveCaseCountry } from '../../lib/case-choices';
import { flagSrc } from '../../lib/flag-policy';

/**
 * The first printed page of a case pack (WP-PIC13). It is drawn on every case output but shown
 * only when the page is printed: on screen it is hidden, so nothing new appears. Black and white
 * only, so it prints well on a home printer. It repeats values the page already shows (name,
 * place, reference code, date, readiness counts) and adds no new field.
 *
 * Readiness here is completeness, never approval: counts only, with the plain line below.
 */
export interface PrintCoverProps {
  /** The traveller's name as the page shows it. */
  readonly name: string;
  /** The place the case goes to, as the case holds it. */
  readonly destination: string | null;
  readonly referenceCode: string | null;
  /** The date the page shows as the day it was prepared, already formatted. */
  readonly preparedOn: string;
  /** Null when the case has no checklist: then no counts line is printed, never a zero. */
  readonly readiness: { readonly required: number; readonly satisfied: number } | null;
}

export const PRINT_COVER_NOTE = 'This shows what is gathered, not whether a visa will be approved.';

function itemsLine(satisfied: number, required: number): string {
  return `${satisfied} of ${required} ${required === 1 ? 'item' : 'items'} ready`;
}

export function PrintCover({
  name,
  destination,
  referenceCode,
  preparedOn,
  readiness,
}: PrintCoverProps) {
  const country = destination ? resolveCaseCountry(destination) : null;
  const flag = country ? flagSrc(country.iso2) : null;
  const place = country?.name ?? destination;
  const counts =
    readiness && readiness.required > 0
      ? itemsLine(Math.min(readiness.satisfied, readiness.required), readiness.required)
      : null;
  return (
    <section className="print-cover" data-print-cover="true">
      <p className="print-cover-kicker">VisaStack Case Pack</p>
      <p className="print-cover-name">{name}</p>
      {place ? (
        <div className="print-cover-place">
          {flag ? (
            <img className="print-cover-flag" src={flag} alt="" width={96} height={64} />
          ) : null}
          <p className="print-cover-country">{place}</p>
        </div>
      ) : null}
      <dl className="print-cover-facts">
        {referenceCode ? (
          <div>
            <dt>Case Reference</dt>
            <dd>{referenceCode}</dd>
          </div>
        ) : null}
        <div>
          <dt>Prepared On</dt>
          <dd>{preparedOn}</dd>
        </div>
        {counts ? (
          <div>
            <dt>Gathered</dt>
            <dd>{counts}</dd>
          </div>
        ) : null}
      </dl>
      <p className="print-cover-note">{PRINT_COVER_NOTE}</p>
    </section>
  );
}
