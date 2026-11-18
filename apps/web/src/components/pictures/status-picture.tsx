import type { ReactNode } from 'react';
import { ExplainTip } from '../explain-tip';
import { STATUS_MEANINGS, type StatusKind, type StatusRing } from './status-picture-words';

export {
  STATUS_KINDS,
  STATUS_MEANINGS,
  type StatusKind,
  type StatusMeaning,
  type StatusRing,
  type StatusTone,
} from './status-picture-words';

/** Ring geometry on a 24 by 24 canvas. Colour comes from the stylesheet (WP-WAL1 block). */
const RINGS: Readonly<Record<StatusRing, ReactNode>> = {
  thin: <circle className="status-picture-ring" cx="12" cy="12" r="10.25" strokeWidth="1.5" />,
  thick: <circle className="status-picture-ring" cx="12" cy="12" r="9.75" strokeWidth="2.5" />,
  dashed: (
    <circle
      className="status-picture-ring"
      cx="12"
      cy="12"
      r="10"
      strokeWidth="2"
      strokeDasharray="4.2 2.6"
    />
  ),
  double: (
    <>
      <circle className="status-picture-ring" cx="12" cy="12" r="10.5" strokeWidth="1.25" />
      <circle className="status-picture-ring-inner" cx="12" cy="12" r="8" strokeWidth="1.25" />
    </>
  ),
  broken: (
    <circle
      className="status-picture-ring"
      cx="12"
      cy="12"
      r="10"
      strokeWidth="2"
      strokeDasharray="1.6 1.9"
    />
  ),
  dotted: (
    <circle
      className="status-picture-ring"
      cx="12"
      cy="12"
      r="10"
      strokeWidth="2"
      strokeDasharray="0.01 3.4"
      strokeLinecap="round"
    />
  ),
};

/** The mark inside the ring, so the six differ in shape as well as in ring. */
const MARKS: Readonly<Record<StatusKind, ReactNode>> = {
  // A filled dot: something is here.
  added: <circle className="status-picture-fill" cx="12" cy="12" r="3" />,
  // A page with a folded corner: a file holds it.
  backed: <path d="M9 7.5h4l2.5 2.5v6.5H9zM13 7.5V10h2.5M10.8 13h2.9" />,
  // A four-point spark: read from a file, waiting for the person.
  suggested: <path className="status-picture-fill" d="M12 7l1.3 3.7L17 12l-3.7 1.3L12 17l-1.3-3.7L7 12l3.7-1.3z" />,
  // A closed eye: hidden until shown.
  sensitive: <path d="M8 11.5c2.2 2.4 5.8 2.4 8 0M9.4 13.2l-.9 1.3M12 13.9V15.4M14.6 13.2l.9 1.3" />,
  // An exclamation mark: something needs the person.
  needsFix: (
    <>
      <path d="M12 7.6v5" />
      <circle className="status-picture-fill" cx="12" cy="15.8" r="1.1" />
    </>
  ),
  // A clock: true before, not now.
  notCurrent: <path d="M12 8.2V12l2.6 1.6" />,
};

export interface StatusPictureProps {
  readonly kind: StatusKind;
  /** The name and sentence in the page's language (`t.node`); English from the record if left out. */
  readonly label?: ReactNode;
  readonly text?: ReactNode;
  /** An extra class for the page's own spacing. */
  readonly className?: string | undefined;
}

/** The drawing alone, hidden from screen readers. For a list or legend that names it in words. */
export function StatusGlyph({ kind }: { readonly kind: StatusKind }) {
  const meaning = STATUS_MEANINGS[kind];
  return (
    <svg
      className="status-picture"
      data-status={kind}
      data-tone={meaning.tone}
      data-ring={meaning.ring}
      viewBox="0 0 24 24"
      width="28"
      height="28"
      aria-hidden="true"
      focusable="false"
    >
      {RINGS[meaning.ring]}
      <g className="status-picture-mark">{MARKS[kind]}</g>
    </svg>
  );
}

/**
 * One of the six status pictures, wrapped in the Explain note: point at it, focus it or tap it and
 * its name and one plain sentence appear; Escape closes the note. The trigger is a 44 px button
 * named by the status, so a screen reader hears the name and the sentence without opening it.
 */
export function StatusPicture({ kind, label, text, className }: StatusPictureProps) {
  const meaning = STATUS_MEANINGS[kind];
  return (
    <ExplainTip
      label={label ?? meaning.name}
      text={text ?? meaning.sentence}
      className={`status-picture-tip${className ? ` ${className}` : ''}`}
    >
      <StatusGlyph kind={kind} />
    </ExplainTip>
  );
}
