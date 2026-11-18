import type { ReactElement } from 'react';
import './kit.css';

/**
 * R5 local stand-in for the shared SegmentRing (kit contract, docs/upgrades/programme/pub/R1-kit-contract.md).
 * Same props; swapped for the real kit at the R5 TURN. Eight arcs with gaps from the top, clockwise.
 * The centre is real text in the chapter's own ink (white on navy), never an SVG paint on a tint.
 */
export interface SegmentRingProps {
  readonly filled: number;
  readonly total?: number;
  readonly label?: string;
  readonly tone?: 'light' | 'dark';
  /** Below 80 a small ring (46 px), from 80 the large one (96 px); the sizes themselves live in kit.css. */
  readonly size?: number;
  readonly pageLang?: string;
}

const CX = 50;
const R = 40;
const GAP_DEG = 9;

function arc(index: number, total: number): string {
  const span = 360 / total;
  const start = ((index * span + GAP_DEG / 2 - 90) * Math.PI) / 180;
  const end = (((index + 1) * span - GAP_DEG / 2 - 90) * Math.PI) / 180;
  const point = (angle: number) =>
    `${(CX + R * Math.cos(angle)).toFixed(2)} ${(CX + R * Math.sin(angle)).toFixed(2)}`;
  return `M ${point(start)} A ${R} ${R} 0 0 1 ${point(end)}`;
}

export function SegmentRing({
  filled,
  total = 8,
  label,
  tone = 'light',
  size = 96,
  pageLang = 'en',
}: SegmentRingProps): ReactElement {
  const done = Math.max(0, Math.min(total, Math.round(filled)));
  const arcs = Array.from({ length: total }, (_, i) => ({
    id: `arc-${i}`,
    d: arc(i, total),
    on: i < done,
  }));
  return (
    <span className={`r5-ring r5-ring-${tone}`} {...(pageLang !== 'en' ? { lang: 'en' } : {})}>
      <span className="r5-ring-art" data-size={size >= 80 ? 'lg' : 'sm'}>
        <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          {arcs.map((segment) => (
            <path
              key={segment.id}
              d={segment.d}
              className={segment.on ? 'r5-seg r5-seg-on' : 'r5-seg'}
              fill="none"
              strokeWidth="9"
              strokeLinecap="round"
            />
          ))}
        </svg>
        <span className="r5-ring-centre">{`${done}/${total}`}</span>
      </span>
      {label ? <span className="r5-ring-label">{label}</span> : null}
    </span>
  );
}
