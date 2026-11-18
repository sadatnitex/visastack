import type { ReactNode } from 'react';
import { StickyDetails } from '../sticky-details';
import type { LiftHeadingLevel } from './types';

/** The kit's heading levels (2 to 5), as for every other ui-lift piece. */
export type ExpandableHeadingLevel = LiftHeadingLevel;

export interface ExpandableSectionProps {
  /** The section's name, in Title Case. It is the heading inside the row. */
  readonly title: ReactNode;
  /** One line under the name that says what is inside while the section is closed. */
  readonly summary?: ReactNode;
  /** A small picture at the start of the row (a document drawing, an area mark). Decorative. */
  readonly picture?: ReactNode;
  /**
   * A status picture at the end of the row, for example `<StatusPicture kind="backed" />`. It is
   * drawn beside the toggle, never inside it, so its Explain button is a control of its own and
   * pressing it never opens or closes the section. In reading and focus order it comes just
   * before the row, so it is never separated from the row by the open content.
   */
  readonly status?: ReactNode;
  /** What the section holds. Drawn with the same padding in every section. */
  readonly children: ReactNode;
  /** The heading level of the name inside the row, to fit the page's outline. Default 3. */
  readonly headingLevel?: ExpandableHeadingLevel;
  /** Open when first drawn. Default closed. */
  readonly defaultOpen?: boolean;
  /**
   * Keep the section as the person left it (the StickyDetails behaviour). Without it the section
   * follows `defaultOpen` whenever the page draws it again; with it a server refresh after a save
   * never closes a section over the message the person still needs, nor opens one they closed.
   */
  readonly remember?: boolean;
  /**
   * For links that point at the section (`#id`, on the outer card). A link scrolls to the card;
   * it does not open it, so set `defaultOpen` when the page was reached by such a link.
   */
  readonly id?: string;
  /** An extra class for the page's own spacing. */
  readonly className?: string;
}

/**
 * Expandable Section (WAL1, ADR 0030): the one open-and-close section for every screen.
 *
 * Closed, the row shows a picture, the name, a one-line summary, a status picture and a chevron;
 * open, the content sits below with the same padding everywhere. It is built on the browser's own
 * details and summary, so it works before any script loads and with script switched off; Enter
 * and Space toggle it from the keyboard; find-in-page opens it. The row is at
 * least 44 px tall. Picture, status and chevron are pinned to the top of the row, so a summary
 * that wraps onto a second line moves nothing. Under reduced motion the chevron does not turn
 * gradually, it shows its finished position.
 *
 * Server and browser draw the same first state (`defaultOpen`), so nothing flashes on load. It is
 * a server component (the kit carries no client code); with `remember` the open-and-close state
 * is held by the shared StickyDetails island, so a toggle made before the script arrived is kept.
 */
export function ExpandableSection({
  title,
  summary,
  picture,
  status,
  children,
  headingLevel = 3,
  defaultOpen = false,
  remember = false,
  id,
  className,
}: ExpandableSectionProps) {
  const Heading = `h${headingLevel}` as const;
  const row = (
    <>
      {picture ? (
        <span className="expandable-section-picture" aria-hidden="true">
          {picture}
        </span>
      ) : null}
      <Heading className="expandable-section-title">{title}</Heading>
      {summary ? <span className="expandable-section-summary">{summary}</span> : null}
      <svg
        className="expandable-section-chevron"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </>
  );
  const body = <div className="expandable-section-body">{children}</div>;
  return (
    <div
      id={id}
      className={`expandable-section${className ? ` ${className}` : ''}`}
      data-has-picture={picture ? 'true' : undefined}
      data-has-status={status ? 'true' : undefined}
    >
      {status ? (
        <span className="expandable-section-status" data-row-companion="">
          {status}
        </span>
      ) : null}
      {remember ? (
        <StickyDetails
          className="expandable-section-details"
          initiallyOpen={defaultOpen}
          summary={row}
        >
          {body}
        </StickyDetails>
      ) : (
        <details className="expandable-section-details" open={defaultOpen || undefined}>
          <summary>{row}</summary>
          {body}
        </details>
      )}
    </div>
  );
}
