import type { ReactNode } from 'react';
import { DocumentPicture } from '../pictures/document-picture';
import { ProgressRing } from '../progress-ring';
import { AFTER_STEP_LABEL, NOW_LABEL } from '../readiness-segments';
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
  /**
   * Opt-in: the ring now and the ring after this step is done, with the step's document picture as
   * the hero. `done` and `total` are the counts already computed; the "after" count is one more, and
   * nothing is drawn when there is no checklist or nothing left to do. Only a document TYPE is passed.
   */
  readonly beforeAfter?: NextStepBeforeAfter | undefined;
}

export interface NextStepBeforeAfter {
  readonly done: number;
  readonly total: number;
  readonly documentType?: string | null | undefined;
}

/** The hero: this step's document picture, then the ring now and the ring after the step. */
function BeforeAfterHero({ done, total, documentType }: NextStepBeforeAfter) {
  if (!(total > 0) || done >= total) return null;
  const now = Math.max(0, Math.floor(done));
  return (
    <div className="lift-next-hero pic-depth">
      <span className="lift-next-hero-picture pic-glow">
        <DocumentPicture type={documentType} size={72} className="pic-float" />
      </span>
      <div className="lift-next-rings">
        <span className="lift-next-ring">
          <ProgressRing done={now} total={total} size="sm" />
          <span className="lift-next-ring-caption">{NOW_LABEL}</span>
        </span>
        <span className="lift-next-ring-arrow" aria-hidden="true">
          {'\u2192'}
        </span>
        <span className="lift-next-ring">
          <ProgressRing done={now + 1} total={total} size="sm" />
          <span className="lift-next-ring-caption">{AFTER_STEP_LABEL}</span>
        </span>
      </div>
    </div>
  );
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
  beforeAfter,
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
      {beforeAfter ? <BeforeAfterHero {...beforeAfter} /> : null}
      {children}
      <LiftLink className="btn btn-primary" href={action.href} openGroup={action.openGroup}>
        {action.label}
      </LiftLink>
      {why ? <AboutDisclosure summary="Why This Step">{why}</AboutDisclosure> : null}
    </section>
  );
}
