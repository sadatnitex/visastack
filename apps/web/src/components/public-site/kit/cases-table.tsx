import { publicText } from '../public-text';
import { ExampleTag } from '../story';
import { englishOn } from './doc-kinds';
import { RiseIn } from './rise-in';
import { SegmentRing } from './segment-ring';
import './kit.css';

export interface CaseRow {
  /** A made-up name (the table carries the Example tag). */
  readonly name: string;
  /** The destination's two-letter code; its flag is read from this site. */
  readonly code: string;
  readonly country: string;
  /** Segments filled out of eight. */
  readonly filled: number;
  /** How many papers are missing, or `Complete`. */
  readonly missing: number | 'Complete';
  /** The case's status word, for example `Being Checked`. */
  readonly status: string;
}

export interface CasesTableProps {
  readonly rows: readonly CaseRow[];
  readonly pageLang?: string;
}

/**
 * An agency's cases at a glance: flag, name, completeness ring, what is missing and where the case
 * stands. Made-up rows only, tagged Example. A ring is completeness, never approval.
 */
export function CasesTable({ rows, pageLang = 'en' }: CasesTableProps) {
  const say = (text: string) => publicText(text, pageLang);
  return (
    <figure
      className="kit-cases"
      data-pub-depth=""
      aria-label="Example of an agency's cases"
      {...englishOn(pageLang)}
    >
      <div className="kit-cases-head">
        <b>Cases</b>
        <ExampleTag pageLang={pageLang} />
      </div>
      <ul className="kit-cases-list">
        {rows.map((row, index) => (
          <RiseIn as="li" delay={index * 0.12} className="kit-case" key={row.name}>
            <img
              className="kit-flag"
              src={`/flags/${row.code}.svg`}
              alt=""
              width={28}
              height={19}
              loading="lazy"
              decoding="async"
            />
            <span className="kit-case-who">
              <b>{row.name}</b>
              <span>{row.country}</span>
            </span>
            <SegmentRing filled={row.filled} size={46} />
            <span className="kit-case-state">
              <b>{row.missing === 'Complete' ? say('Complete') : say(`${row.missing} missing`)}</b>
              <span>{say(row.status)}</span>
            </span>
          </RiseIn>
        ))}
      </ul>
      <p className="kit-note">
        {say('Example names and counts. Completeness only. Not an approval.')}
      </p>
    </figure>
  );
}
