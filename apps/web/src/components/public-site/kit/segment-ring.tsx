import './kit-steps.css';
import './kit.css';

export type RingTone = 'light' | 'dark';

export interface SegmentRingProps {
  /** Segments filled (0 to total). Ignored while `steps` is given. */
  readonly filled: number;
  /** How many segments the ring has. Default 8. */
  readonly total?: number;
  /** The words beside the ring, for example "5 of 8 Ready". Leave out where the words sit elsewhere. */
  readonly label?: string;
  /** The chapter the ring sits on: a dark chapter gets white numerals on navy. Default light. */
  readonly tone?: RingTone;
  /** Width and height in CSS pixels. Default 96. */
  readonly size?: number;
  /**
   * Follows a scene: one entry per scene step (the engine writes data-step). Needs a Scene
   * around it. Each entry fills its own count and may carry its own words.
   */
  readonly steps?: readonly { readonly filled: number; readonly label?: string }[];
}

const RADIUS = 30;
const GAP_DEGREES = 7;
const CENTRE = 36;

function point(angle: number): string {
  return `${(CENTRE + RADIUS * Math.cos(angle)).toFixed(2)} ${(CENTRE + RADIUS * Math.sin(angle)).toFixed(2)}`;
}

/** The path of one arc, clockwise from the top, with a gap before and after it. */
export function segmentPath(index: number, total: number): string {
  const start = ((index * 360) / total + GAP_DEGREES / 2 - 90) * (Math.PI / 180);
  const end = (((index + 1) * 360) / total - GAP_DEGREES / 2 - 90) * (Math.PI / 180);
  return `M${point(start)} A${RADIUS} ${RADIUS} 0 0 1 ${point(end)}`;
}

function clampCount(value: number, total: number): number {
  return Number.isFinite(value) ? Math.min(total, Math.max(0, Math.floor(value))) : 0;
}

function Group({
  filled,
  total,
  stepIndex,
}: { filled: number; total: number; stepIndex?: number }) {
  const count = clampCount(filled, total);
  return (
    <g
      className={stepIndex === undefined ? undefined : 'kit-sw'}
      {...(stepIndex === undefined ? {} : { 'data-at': stepIndex })}
    >
      {Array.from({ length: total }, (_, index) => (
        <path
          key={`${stepIndex ?? 'f'}-${index}`}
          className={index < count ? 'kit-seg is-on' : 'kit-seg'}
          d={segmentPath(index, total)}
        />
      ))}
      <text className="kit-ring-num" x={CENTRE} y={43} textAnchor="middle">
        {count}/{total}
      </text>
    </g>
  );
}

/**
 * Eight arcs with gaps, filled clockwise from the top, the count in the middle. On a dark chapter
 * the numerals are white and the ring sits straight on the navy; on a light one they are navy.
 * The drawing is hidden from assistive technology: the words go beside it (`label`).
 */
export function SegmentRing({
  filled,
  total = 8,
  label,
  tone = 'light',
  size = 96,
  steps,
}: SegmentRingProps) {
  const labels = steps ? steps.map((step) => step.label) : [label];
  const hasLabel = labels.some(Boolean);
  return (
    <span className="kit-ring" data-tone={tone}>
      <svg
        className="kit-ring-svg"
        width={size}
        height={size}
        viewBox="0 0 72 72"
        aria-hidden="true"
        focusable="false"
      >
        {steps ? (
          steps.map((step, index) => (
            // The steps never reorder: the position is the scene step.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <Group key={index} filled={step.filled} total={total} stepIndex={index} />
          ))
        ) : (
          <Group filled={filled} total={total} />
        )}
      </svg>
      {hasLabel ? (
        <span className="kit-ring-label">
          {steps
            ? labels.map((text, index) =>
                text ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the position is the scene step
                  <span className="kit-sw" data-at={index} key={index}>
                    {text}
                  </span>
                ) : null,
              )
            : label}
        </span>
      ) : null}
    </span>
  );
}
