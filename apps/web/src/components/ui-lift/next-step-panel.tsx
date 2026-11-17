import type { ReactNode } from 'react';
import { documentPicture } from '../../lib/document-picture';
import { DocumentPicture } from '../pictures/document-picture';
import { ProgressRing } from '../progress-ring';
import { AboutDisclosure } from './about-disclosure';
import { LiftHeading, LiftLink } from './lift-parts';
import type { LiftAction, LiftHeadingLevel } from './types';

/** Captions of the two rings in the opt-in before and after hero. */
export const NOW_LABEL = 'Now';
export const AFTER_STEP_LABEL = 'After This Step';

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
   * the hero. `done` and `total` are the counts already computed. The "after" ring is one more item
   * ready unless the page passes `afterDone`, the count it knows the step will reach (a step that
   * adds several items, or none). Nothing is drawn when there is no checklist or nothing is left to
   * do. Only a document TYPE is passed. The hero is the screen's one moving picture, so use at most
   * one panel with this option per page.
   */
  readonly beforeAfter?: NextStepBeforeAfter | undefined;
}

export interface NextStepBeforeAfter {
  readonly done: number;
  readonly total: number;
  readonly documentType?: string | null | undefined;
  /** The ready count after the step, when the page knows it. Default: one more than `done`. */
  readonly afterDone?: number | undefined;
}

/**
 * The hero: this step's document picture, then the ring now and the ring after the step. Exported
 * so the traveller page's Next Step card can show the same hero (WP-PIC13).
 */
export function BeforeAfterHero({ done, total, documentType, afterDone }: NextStepBeforeAfter) {
  if (!Number.isFinite(total) || !Number.isFinite(done) || total < 1) return null;
  const all = Math.floor(total);
  const now = Math.max(0, Math.floor(done));
  if (now >= all) return null;
  const after =
    afterDone !== undefined && Number.isFinite(afterDone) ? Math.floor(afterDone) : now + 1;
  // The glow reads its colour from the tone on its own element, so it matches the document's.
  const tone = documentPicture(documentType).mark.tone;
  return (
    <div className="lift-next-hero pic-depth">
      <span
        className="lift-next-hero-picture pic-glow"
        {...(tone === 'neutral' ? {} : { 'data-tone': tone })}
      >
        <DocumentPicture type={documentType} size={72} className="pic-float" />
      </span>
      <div className="lift-next-rings">
        <span className="lift-next-ring">
          <ProgressRing done={now} total={all} size="sm" />
          <span className="lift-next-ring-caption">{NOW_LABEL}</span>
        </span>
        <span className="lift-next-ring-arrow" aria-hidden="true">
          {'\u2192'}
        </span>
        <span className="lift-next-ring">
          <ProgressRing done={Math.max(now, after)} total={all} size="sm" />
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
