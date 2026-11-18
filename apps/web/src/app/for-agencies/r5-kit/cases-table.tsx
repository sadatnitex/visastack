import type { ReactElement } from 'react';
import { publicText } from '../../../components/public-site/public-text';
import { ExampleTag } from '../../../components/public-site/story';
import { ReadinessNote } from './readiness-note';
import { RiseIn } from './rise-in';
import { SegmentRing } from './segment-ring';
import './kit.css';

/** R5 local stand-in for the shared CasesTable (same props). Swapped for the real kit at the TURN. */
export interface CasesTableRow {
  readonly name: string;
  readonly code: string;
  readonly country: string;
  readonly filled: number;
  readonly missing: number | 'Complete';
  readonly status: string;
}

export function CasesTable({
  rows,
  pageLang = 'en',
  title,
}: {
  readonly rows: readonly CasesTableRow[];
  readonly pageLang?: string;
  readonly title: string;
}): ReactElement {
  return (
    <div className="r5-cases pub-chapter-light" {...(pageLang !== 'en' ? { lang: 'en' } : {})}>
      <div className="r5-cases-head">
        <p className="r5-cases-title">{publicText(title, pageLang)}</p>
        <ExampleTag pageLang={pageLang} />
      </div>
      <ul className="r5-cases-list">
        {rows.map((row, i) => (
          <RiseIn as="li" key={row.name} delay={i * 0.1}>
            <img
              className="r5-flag"
              src={`/flags/${row.code}.svg`}
              alt=""
              width={28}
              height={28}
              loading="eager"
              decoding="async"
            />
            <span className="r5-cases-who">
              <strong>{row.name}</strong>
              <span>{row.country}</span>
            </span>
            <SegmentRing filled={row.filled} size={46} pageLang={pageLang} />
            <span className="r5-cases-state">
              <strong>{row.missing === 'Complete' ? 'Complete' : `${row.missing} Missing`}</strong>
              <span>{publicText(row.status, pageLang)}</span>
            </span>
          </RiseIn>
        ))}
      </ul>
      <ReadinessNote pageLang={pageLang} />
    </div>
  );
}
