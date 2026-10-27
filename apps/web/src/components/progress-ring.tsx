import Link from 'next/link';
import type { ReactNode } from 'react';
import { progressRingPercent, progressRingWords } from '../lib/readiness-words';

/**
 * The progress ring: how many items of a file's checklist are ready, drawn as a ring and said in
 * words. It is a count of what is on file, never a decision: the words are always "N of M items
 * ready", and nothing here says approved, cleared, accepted or guaranteed (readiness is not
 * approval).
 *
 * The count comes only from `computeReadiness` (a case with a requirement pack attached). Where a
 * file has no checklist yet the ring is shown empty, with one teaching line and a way to get one;
 * a number is never invented. Flat: shared tokens, no shadow, no gradient, no animation, so there is
 * nothing to switch off for reduced motion. The ring is an image with a text alternative, and the
 * same words are visible next to it for everyone else.
 */

/** What the person is told when there is no checklist to count against yet. */
export const NO_CHECKLIST_LINE = 'Pick a checklist to see what is ready';
export const NO_CHECKLIST_LABEL = 'No checklist yet';
/** A checklist exists but has nothing required to count. */
export const NO_REQUIRED_LABEL = 'No required items';
export const NO_REQUIRED_LINE = 'This checklist has no required items to count.';
/** A checklist exists but its count could not be read just now. */
export const PROGRESS_IN_CASE_LINE = 'Open the case to see its progress.';

export interface ProgressRingProps {
  /** Items ready. Ignored when `total` is 0. */
  readonly done: number;
  /** Items on the checklist. 0 (or less) means there is nothing to count: the ring is shown empty. */
  readonly total: number;
  /** `sm` for a row in a list, `md` for a card, `lg` for the case page. */
  readonly size?: 'sm' | 'md' | 'lg';
  /** A short figure in the middle of a large ring (for example "25%"). */
  readonly centre?: string;
  /** Replaces the teaching line when the ring is empty. */
  readonly emptyLine?: string;
  /** Replaces the text alternative when the ring is empty (for a checklist that exists but has nothing to count). */
  readonly emptyLabel?: string;
  /** A way to get a checklist, shown with the teaching line when the ring is empty. Leave it out inside a link. */
  readonly emptyAction?: { readonly href: string; readonly label: string };
}

function RingArc({ percent }: { readonly percent: number }) {
  return (
    <>
      <circle className="progress-ring-track" cx="50" cy="50" r="42" fill="none" />
      {percent > 0 ? (
        <circle
          className="progress-ring-fill"
          cx="50"
          cy="50"
          r="42"
          fill="none"
          pathLength={100}
          strokeDasharray={`${percent} ${100 - percent}`}
          transform="rotate(-90 50 50)"
        />
      ) : null}
    </>
  );
}

export function ProgressRing({
  done,
  total,
  size = 'md',
  centre,
  emptyLine = NO_CHECKLIST_LINE,
  emptyLabel = NO_CHECKLIST_LABEL,
  emptyAction,
}: ProgressRingProps): ReactNode {
  const empty = total <= 0;
  const percent = empty ? 0 : progressRingPercent(done, total);
  const words = empty ? emptyLabel : progressRingWords(Math.min(done, total), total);
  const full = !empty && done >= total;
  const className = [
    'progress-ring',
    `progress-ring-${size}`,
    empty ? 'progress-ring-empty' : '',
    full ? 'progress-ring-full' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={className}>
      <span className="progress-ring-graphic">
        <svg viewBox="0 0 100 100" role="img" aria-label={words}>
          <RingArc percent={percent} />
        </svg>
        {centre !== undefined ? (
          <span className="progress-ring-centre" aria-hidden="true">
            {centre}
          </span>
        ) : null}
      </span>
      {empty ? (
        <span className="progress-ring-text">
          <span className="progress-ring-line">{emptyLine}</span>
          {emptyAction ? (
            <Link className="progress-ring-action" href={emptyAction.href}>
              {emptyAction.label}
            </Link>
          ) : null}
        </span>
      ) : (
        <span className="progress-ring-text">
          {/* The ring already reads these words aloud; showing them again to a screen reader would say the count twice. */}
          <span className="progress-ring-words" aria-hidden="true">
            {words}
          </span>
        </span>
      )}
    </span>
  );
}
