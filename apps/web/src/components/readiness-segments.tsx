import type { ReactNode } from 'react';
import { progressRingWords } from '../lib/readiness-words';
import { ExplainTip } from './explain-tip';
import { Icon } from './icons';
import { DocumentPicture } from './pictures/document-picture';
import { NO_CHECKLIST_LABEL, NO_CHECKLIST_LINE, ProgressRing } from './progress-ring';

/**
 * The segment ring: the readiness ring cut into one segment per required item, with a legend that
 * draws each item as a small picture of its document type. It is an opt-in variant beside
 * `ProgressRing`; nothing existing changes.
 *
 * The count is the one already computed (`done` of `total`, from `computeReadiness`): the number of
 * segments is `total`, the number filled is `done`. No number is invented and nothing is queried
 * here. It is a count of what is ready, never a decision: the words say "N of M items ready" and
 * the tip beside the ring says it is not a visa decision.
 *
 * Not by colour alone: a filled segment is thick and a missing one thin, and every legend row says
 * "Ready" or "Still Needed" in words. Flat: depth and motion belong to the picture layer only.
 */

export const RING_TIP_LABEL = 'What This Ring Counts';
export const RING_TIP_TEXT = 'The ring counts what is ready, not whether a visa will be approved.';
export const ITEM_READY_WORD = 'Ready';
export const ITEM_NEEDED_WORD = 'Still Needed';
export const NOW_LABEL = 'Now';
export const AFTER_STEP_LABEL = 'After This Step';
/** Past this many items the segments turn into slivers, so the plain ring is drawn instead. */
export const MAX_SEGMENTS = 24;

export interface ReadinessSegmentItem {
  readonly key: string;
  /** The item's name, in Title Case. */
  readonly label: string;
  /** A document type the page already has; never document content or personal data. */
  readonly type?: string | null | undefined;
  readonly ready: boolean;
}

export interface ReadinessSegmentRingProps {
  /** Items ready (from the computed readiness). */
  readonly done: number;
  /** Items required. 0 (or less) means there is nothing to count: the empty ring teaches instead. */
  readonly total: number;
  readonly size?: 'sm' | 'md' | 'lg';
  /** One entry per required item, for the legend. Leave out for the ring alone. */
  readonly items?: ReadonlyArray<ReadinessSegmentItem>;
  readonly emptyLine?: string;
  readonly emptyLabel?: string;
  readonly emptyAction?: { readonly href: string; readonly label: string };
  /** Show the explain tip beside the ring (default on). */
  readonly tip?: boolean;
}

/** The counts the segments show: whole numbers, never more done than total. */
export function segmentRingCounts(done: number, total: number): { done: number; total: number } {
  if (!(total > 0)) return { done: 0, total: 0 };
  const whole = Math.floor(total);
  return { done: Math.max(0, Math.min(Math.floor(done), whole)), total: whole };
}

function Segments({ done, total }: { readonly done: number; readonly total: number }) {
  const slot = 100 / total;
  const gap = total === 1 ? 0 : Math.min(2.5, slot * 0.25);
  const length = slot - gap;
  return (
    <>
      {Array.from({ length: total }, (_, index) => (
        <circle
          // Segments are positional and never reorder.
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed positions on a ring
          key={index}
          className={`readiness-seg ${index < done ? 'readiness-seg-on' : 'readiness-seg-off'}`}
          cx="50"
          cy="50"
          r="42"
          fill="none"
          pathLength={100}
          strokeDasharray={`${length} ${100 - length}`}
          strokeDashoffset={-(index * slot) - gap / 2}
          transform="rotate(-90 50 50)"
        />
      ))}
    </>
  );
}

function RingTip(): ReactNode {
  return (
    <ExplainTip label={RING_TIP_LABEL} text={RING_TIP_TEXT} className="readiness-segring-tip">
      <Icon name="ask" size={18} />
    </ExplainTip>
  );
}

export function ReadinessSegmentRing({
  done,
  total,
  size = 'md',
  items,
  emptyLine = NO_CHECKLIST_LINE,
  emptyLabel = NO_CHECKLIST_LABEL,
  emptyAction,
  tip = true,
}: ReadinessSegmentRingProps): ReactNode {
  const counts = segmentRingCounts(done, total);
  if (counts.total === 0) {
    // Nothing to count: the same teaching ring as today, with the same way to get a checklist.
    return (
      <span className="readiness-segring">
        <ProgressRing
          done={0}
          total={0}
          size={size}
          emptyLine={emptyLine}
          emptyLabel={emptyLabel}
          {...(emptyAction ? { emptyAction } : {})}
        />
      </span>
    );
  }
  if (counts.total > MAX_SEGMENTS) {
    return (
      <span className="readiness-segring">
        <ProgressRing done={counts.done} total={counts.total} size={size} />
        {tip ? <RingTip /> : null}
      </span>
    );
  }
  const words = progressRingWords(counts.done, counts.total);
  const full = counts.done >= counts.total;
  return (
    <span className="readiness-segring">
      <span
        className={`progress-ring progress-ring-${size}${full ? ' progress-ring-full' : ''} readiness-segring-ring`}
      >
        <span className="progress-ring-graphic">
          <svg viewBox="0 0 100 100" role="img" aria-label={words}>
            <Segments done={counts.done} total={counts.total} />
          </svg>
        </span>
        <span className="progress-ring-text">
          <span className="progress-ring-words" aria-hidden="true">
            {words}
          </span>
        </span>
      </span>
      {tip ? <RingTip /> : null}
      {items && items.length > 0 ? (
        <ul className="readiness-legend">
          {items.map((item) => (
            <li
              key={item.key}
              className="readiness-legend-row"
              data-ready={item.ready ? 'yes' : 'no'}
            >
              <DocumentPicture type={item.type} size={28} />
              <span className="readiness-legend-name">{item.label}</span>
              <span className="readiness-legend-state">
                {item.ready ? ITEM_READY_WORD : ITEM_NEEDED_WORD}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
