'use client';

import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from 'react';

export type ExpandableHeadingLevel = 2 | 3 | 4 | 5 | 6;

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
   * pressing it never opens or closes the section.
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
  /** Called with the new state after the person opens or closes the section. */
  readonly onToggle?: (open: boolean) => void;
  /** For links that point at the section (`#id`); the browser opens it when the link is used. */
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
 * and Space toggle it from the keyboard; find-in-page and `#id` links open it. The row is at
 * least 44 px tall. Picture, status and chevron are pinned to the top of the row, so a summary
 * that wraps onto a second line moves nothing. Under reduced motion the chevron does not turn
 * gradually, it shows its finished position.
 *
 * Server and browser draw the same first state (`defaultOpen`), so nothing flashes on load. If
 * the person toggled the section before the script arrived, the browser's state is kept.
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
  onToggle,
  id,
  className,
}: ExpandableSectionProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [kept, setKept] = useState(defaultOpen);
  const open = remember ? kept : defaultOpen;

  // A toggle made before the script loaded fired no event React heard: take the browser's state.
  // Only on the first draw; afterwards every toggle arrives through onToggle.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on the first draw only
  useEffect(() => {
    const element = ref.current;
    if (remember && element && element.open !== kept) setKept(element.open);
  }, []);

  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const now = event.currentTarget.open;
    if (remember) setKept(now);
    onToggle?.(now);
  };

  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={`expandable-section${className ? ` ${className}` : ''}`}
      data-has-picture={picture ? 'true' : undefined}
      data-has-status={status ? 'true' : undefined}
    >
      <details
        ref={ref}
        id={id}
        className="expandable-section-details"
        open={open}
        onToggle={handleToggle}
      >
        <summary className="expandable-section-row">
          {picture ? (
            <span className="expandable-section-picture" aria-hidden="true">
              {picture}
            </span>
          ) : null}
          <span className="expandable-section-words">
            <Heading className="expandable-section-title">{title}</Heading>
            {summary ? <span className="expandable-section-summary">{summary}</span> : null}
          </span>
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
        </summary>
        <div className="expandable-section-body">{children}</div>
      </details>
      {status ? <span className="expandable-section-status">{status}</span> : null}
    </div>
  );
}
