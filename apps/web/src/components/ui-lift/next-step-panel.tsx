import type { ReactNode } from 'react';
import { AboutDisclosure } from './about-disclosure';
import { LiftHeading, LiftLink } from './lift-parts';
import type { LiftAction, LiftHeadingLevel } from './types';

export interface NextStepPanelProps {
  /** The small heading above the title ("Next Step"). It is the panel's real heading. */
  readonly kicker: string;
  /** The heading's id, so the page can point `aria-labelledby` or a link at it. */
  readonly kickerId: string;
  readonly level?: LiftHeadingLevel;
  /** What to do, in one line. */
  readonly title: string;
  /** Why, in one or two plain sentences. */
  readonly body?: string | undefined;
  /** The one filled button of the region. */
  readonly action: LiftAction;
  /** The colour of the left edge: brand by default, danger for what blocks, success for done. */
  readonly edge?: 'brand' | 'danger' | 'success';
  /** `ink` is the dark panel; at most one per screen. */
  readonly variant?: 'default' | 'ink';
  /** Anything extra under the body, before the button. */
  readonly children?: ReactNode;
  /** The longer reason, folded under "Why This Step" after the button (read only when asked). */
  readonly why?: ReactNode;
}

/** The one thing to do next: a tinted panel with a coloured edge, a title and one primary button. */
export function NextStepPanel({
  kicker,
  kickerId,
  level = 2,
  title,
  body,
  action,
  edge = 'brand',
  variant = 'default',
  children,
  why,
}: NextStepPanelProps) {
  return (
    <section
      className={`lift-next lift-next-${edge}${variant === 'ink' ? ' lift-next-ink' : ''}`}
      aria-labelledby={kickerId}
    >
      <LiftHeading level={level} className="lift-next-kicker" id={kickerId}>
        {kicker}
      </LiftHeading>
      <p className="lift-next-title">{title}</p>
      {body ? <p className="lift-next-body">{body}</p> : null}
      {children}
      <LiftLink className="btn btn-primary" href={action.href} openGroup={action.openGroup}>
        {action.label}
      </LiftLink>
      {why ? <AboutDisclosure summary="Why This Step">{why}</AboutDisclosure> : null}
    </section>
  );
}
