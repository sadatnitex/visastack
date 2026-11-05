import { type ReactNode, useId } from 'react';
import { LiftHeading } from './lift-parts';
import type { LiftHeadingLevel } from './types';

export interface SectionCardProps {
  /** The card's name; a real heading of `level`. */
  readonly heading: string;
  readonly level?: LiftHeadingLevel;
  /** A small line above the heading ("Dates", "Case"); stays a paragraph. */
  readonly kicker?: string | undefined;
  /** Something at the right of the heading row: a caption, a link. */
  readonly action?: ReactNode;
  /** What kind of card it is, by colour: only the small rule and the line above the heading take it. */
  readonly tone?: 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'teal';
  /** `brand` gives the body the light blue band. */
  readonly tint?: 'none' | 'brand';
  readonly children: ReactNode;
}

/** The one card of the signed-in screens: a heading row, then the body. */
export function SectionCard({
  heading,
  level = 2,
  kicker,
  action,
  tint = 'none',
  tone,
  children,
}: SectionCardProps) {
  const headingId = useId();
  return (
    <section
      className={`lift-card${tint === 'brand' ? ' lift-card-tint' : ''}`}
      aria-labelledby={headingId}
      data-tone={tone}
    >
      <div className="lift-card-head">
        <div className="lift-card-titles">
          {kicker ? <p className="card-kicker">{kicker}</p> : null}
          <LiftHeading level={level} className="lift-card-title" id={headingId}>
            {heading}
          </LiftHeading>
        </div>
        {action ? <div className="lift-card-action">{action}</div> : null}
      </div>
      <div className="lift-card-body">{children}</div>
    </section>
  );
}
