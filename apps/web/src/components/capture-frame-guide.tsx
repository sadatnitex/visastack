/**
 * The passport outline drawn over the photo check (picture-first upgrade, unit U7). A thin outline
 * in the passport cover's shape (the same 640 x 910 proportion as the cover pictures) with four
 * corner marks, so a person can judge the fit of a passport page or cover at a glance.
 *
 * It is a picture overlay only: it ignores taps, is hidden from screen readers (the sentence above
 * the photo already explains the check) and uses no `data:` or `blob:` image. It never says the
 * photo will be accepted.
 */

/** The one-line hint under the photo. */
export const CAPTURE_GUIDE_HINT = 'Fit the passport inside the lines';

/** True when the chosen kind of document is the passport. */
export function isPassportKind(kind: string | undefined): boolean {
  return kind === 'passport';
}

export function CaptureFrameGuide() {
  return (
    <span className="capture-guide" data-capture-guide="passport" aria-hidden="true">
      <span className="capture-guide-corner" data-corner="top-left" />
      <span className="capture-guide-corner" data-corner="top-right" />
      <span className="capture-guide-corner" data-corner="bottom-left" />
      <span className="capture-guide-corner" data-corner="bottom-right" />
    </span>
  );
}
