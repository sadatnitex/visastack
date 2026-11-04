import type { ReactNode } from 'react';

export interface ProgressMeterProps {
  /** How many are done. */
  readonly value: number;
  /** How many there are. */
  readonly max: number;
  /** What is being counted, for the picture's name: "6 of 12 required items on file". */
  readonly label: string;
  /** Bar thickness in pixels. */
  readonly size?: 6 | 10;
  /** The visible words beside the bar; defaults to "6 of 12". Pass `null` for no words. */
  readonly valueText?: ReactNode | null;
}

/** The share of the bar that is filled, from 0 to 100, to two decimals. */
export function meterPercent(value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(value)) return 0;
  const share = Math.min(Math.max(value, 0), max) / max;
  return Math.round(share * 10000) / 100;
}

/**
 * A progress bar drawn as a small picture with a name, plus the same numbers as words beside it.
 * The fill width is an attribute of the drawing, so it needs no inline style.
 */
export function ProgressMeter({ value, max, label, size = 10, valueText }: ProgressMeterProps) {
  const percent = meterPercent(value, max);
  const words = valueText === undefined ? `${value} of ${max}` : valueText;
  return (
    <div className={`lift-meter lift-meter-${size}`}>
      <svg
        className="lift-meter-svg"
        role="img"
        aria-label={`${value} of ${max} ${label}`}
        width="100%"
        height={size}
        viewBox="0 0 100 10"
        preserveAspectRatio="none"
      >
        <rect className="lift-meter-track" x="0" y="0" width="100" height="10" />
        <rect className="lift-meter-fill" x="0" y="0" width={percent} height="10" />
      </svg>
      {words === null ? null : (
        // The drawing's name already says the numbers in full, so this copy is for the eyes only.
        <span className="lift-meter-text" aria-hidden="true">
          {words}
        </span>
      )}
    </div>
  );
}
