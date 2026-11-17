import { DestinationLabel } from '../../../../components/destination-label';
import { ProgressRing } from '../../../../components/progress-ring';
import { plural } from '../../../../lib/plural';
import type { DeskPicture } from './do-next';

/**
 * WP-PIC14 (picture-first upgrade, unit Q2): the compact picture strip on an agency desk row, so a
 * member scans the desk at a glance: the destination flag, a small readiness ring in counts only,
 * and, on a case row, how many required documents were never provided.
 *
 * Presentation only. Everything comes from the row's own case data (see `deskPictureOf`), which is
 * already limited to what the traveller shared with this agency; no part is read for the picture.
 * A row with nothing to draw, and a row about a case that is not in view, draw no strip at all, so
 * the two look the same. Not a link and not a control: the row keeps its one action.
 *
 * Wording is completeness only: "in place" and "missing" count what is on file, never what was
 * reviewed, approved or accepted.
 */
export function DeskPictureStrip({
  picture,
  as: Root = 'div',
  countLabel,
}: {
  readonly picture: DeskPicture | undefined;
  /**
   * WP-PIC18: `span` where the strip sits inside a link (the agency Cases list row), so the link
   * holds phrasing content only. The desk keeps its `div`.
   */
  readonly as?: 'div' | 'span';
  /** WP-PIC18: what the ring counts, in Title Case ("3 of 5 Ready"); left out, the desk words. */
  readonly countLabel?: string;
}) {
  if (!picture) return null;
  return (
    <Root className="desk-strip">
      {picture.destination ? (
        <span className="desk-strip-place">
          <DestinationLabel destination={picture.destination} />
        </span>
      ) : null}
      {picture.readiness ? (
        <ProgressRing
          size="sm"
          done={picture.readiness.done}
          total={picture.readiness.total}
          countLabel={countLabel}
        />
      ) : null}
      {picture.documentsMissing !== null ? (
        <DocumentsMissing count={picture.documentsMissing} />
      ) : null}
    </Root>
  );
}

/** "No Documents Missing", "1 Document Missing", "3 Documents Missing": a count of what is on file. */
export function documentsMissingWords(count: number): string {
  if (count <= 0) return 'No Documents Missing';
  return `${plural(count, 'Document')} Missing`;
}

/** The documents count with a small document drawing; the words carry the meaning, the drawing is decoration. */
export function DocumentsMissing({ count }: { readonly count: number }) {
  return (
    <span className={`desk-docs${count > 0 ? ' desk-docs-open' : ''}`}>
      <svg
        className="desk-docs-glyph"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      >
        <path d="M4 1.5h5.5L12.5 4.5v10h-8.5z" />
        <path d="M9.5 1.5v3h3" />
        <path d="M6 8h4.5M6 10.5h4.5" strokeLinecap="round" />
      </svg>
      {documentsMissingWords(count)}
    </span>
  );
}
