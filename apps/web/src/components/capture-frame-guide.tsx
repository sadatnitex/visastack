/**
 * The passport outline drawn over the photo check (picture-first upgrade, unit U7). A thin outline
 * in the passport cover's shape (the same 64 x 91 proportion as the cover pictures) with four
 * corner marks, so a person can judge the fit of a passport at a glance. Each line is drawn twice,
 * dark under white, so it shows on a light page and on a dark table alike.
 *
 * It is a picture overlay only: it ignores taps, is hidden from screen readers (the sentence above
 * the photo and the hint under it explain the check in words), and uses no `data:` or `blob:`
 * image. It never says the photo will be accepted.
 */

/** The one-line hint under the photo. */
export const CAPTURE_GUIDE_HINT = 'Fit the passport inside the lines';

/** True when the chosen kind of document is the passport (catalogue ids are upper case). */
export function isPassportKind(kind: string | undefined): boolean {
  return kind?.toLowerCase() === 'passport';
}

const CORNERS = [
  { name: 'top-left', d: 'M2 12V4a2 2 0 0 1 2-2h8' },
  { name: 'top-right', d: 'M52 2h8a2 2 0 0 1 2 2v8' },
  { name: 'bottom-left', d: 'M2 79v8a2 2 0 0 0 2 2h8' },
  { name: 'bottom-right', d: 'M62 79v8a2 2 0 0 1-2 2h-8' },
] as const;

export function CaptureFrameGuide() {
  return (
    <svg
      className="capture-guide"
      data-capture-guide="passport"
      viewBox="0 0 64 91"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      {(['under', 'over'] as const).map((layer) => (
        <g key={layer} data-layer={layer}>
          <rect className="capture-guide-line" x={2} y={2} width={60} height={87} rx={2} />
          {CORNERS.map((corner) => (
            <path
              key={corner.name}
              className="capture-guide-corner"
              data-corner={corner.name}
              d={corner.d}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}
