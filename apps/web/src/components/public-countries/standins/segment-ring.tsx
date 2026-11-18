/**
 * R4 STAND-IN for the shared kit's SegmentRing (R1-kit-contract.md). Same props for the part this
 * page uses. Deleted at the R4 turn, when the page imports `../../kit` instead.
 */
export interface SegmentRingProps {
  readonly filled: number;
  readonly total?: number;
  readonly label?: string;
  readonly size?: number;
}

const CENTRE = 50;
const RADIUS = 40;

/** The path of arc `index` of `total`, clockwise from the top, with a small gap between arcs. */
function arc(index: number, total: number): string {
  const gap = 0.16;
  const slice = (Math.PI * 2) / total;
  const from = -Math.PI / 2 + index * slice + gap / 2;
  const to = -Math.PI / 2 + (index + 1) * slice - gap / 2;
  const point = (angle: number) =>
    `${(CENTRE + RADIUS * Math.cos(angle)).toFixed(2)} ${(CENTRE + RADIUS * Math.sin(angle)).toFixed(2)}`;
  return `M${point(from)}A${RADIUS} ${RADIUS} 0 0 1 ${point(to)}`;
}

export function SegmentRing({ filled, total = 8, label, size = 96 }: SegmentRingProps) {
  const arcs = Array.from({ length: total }, (_, index) => index);
  return (
    <span className="r4s-ring">
      <svg
        className="r4s-ring-svg"
        viewBox="0 0 100 100"
        width={size}
        height={size}
        aria-hidden="true"
        focusable="false"
      >
        {arcs.map((index) => (
          <path
            key={index}
            d={arc(index, total)}
            className={index < filled ? 'r4s-arc r4s-arc-on' : 'r4s-arc'}
          />
        ))}
        <text x="50" y="58" textAnchor="middle" className="r4s-ring-text">
          {`${filled}/${total}`}
        </text>
      </svg>
      {label ? <span className="r4s-ring-label">{label}</span> : null}
    </span>
  );
}
