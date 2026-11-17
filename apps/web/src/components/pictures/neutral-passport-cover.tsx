import { pictureNaming } from './picture-naming';
import './pictures-depth.css';

/** The passport cover shape every cover shares: 640 x 910, the size of the real cover file. */
export const PASSPORT_COVER_RATIO = { width: 640, height: 910 } as const;

/** The height that keeps a cover's shape at a given width, so nothing moves while it loads. */
export function passportCoverHeight(width: number): number {
  return Math.round((width * PASSPORT_COVER_RATIO.height) / PASSPORT_COVER_RATIO.width);
}

/**
 * A neutral passport cover, drawn inline: a plain booklet in the identity tone with a globe
 * emblem and the chip mark, and no country's name, seal or words. It is what a traveller of any
 * nationality other than Bangladesh sees, and what everyone sees if the real cover file cannot be
 * shown.
 */
export function NeutralPassportCover({
  width = 160,
  label,
  className,
}: {
  readonly width?: number | undefined;
  /** Accessible name; omit when the word is beside the picture. */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}) {
  const w = Math.max(24, Math.round(width));
  return (
    <span
      className={className ? `pic pic-cover ${className}` : 'pic pic-cover'}
      data-picture="passport-neutral"
      data-tone="blue"
      {...pictureNaming(label)}
    >
      <svg
        width={w}
        height={passportCoverHeight(w)}
        viewBox="0 0 64 91"
        aria-hidden="true"
        focusable="false"
      >
        <path
          className="pic-ink"
          d="M0 4a4 4 0 0 1 4-4h56a4 4 0 0 1 4 4v83a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4z"
        />
        <rect className="pic-line pic-on-ink" x={4} y={4} width={56} height={83} rx={2.5} />
        <rect className="pic-paper" x={20} y={14} width={24} height={3} rx={1.5} />
        <circle className="pic-line pic-on-ink" cx={32} cy={42} r={12} />
        <path
          className="pic-line pic-on-ink"
          d="M20 42h24M32 30c-6 7-6 17 0 24M32 30c6 7 6 17 0 24M23 35h18M23 49h18"
        />
        <rect className="pic-paper" x={16} y={64} width={32} height={3} rx={1.5} />
        <rect className="pic-line pic-on-ink" x={27} y={74} width={10} height={6} rx={2} />
        <circle className="pic-paper" cx={32} cy={77} r={1.5} />
      </svg>
    </span>
  );
}
