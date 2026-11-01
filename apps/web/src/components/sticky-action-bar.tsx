import type { ReactNode } from 'react';

/**
 * The main buttons of a long form or task (Save, Next, Approve All), kept in reach at the bottom of
 * the screen while the person scrolls, on every screen size. It is the shared form of the pinned
 * invitation buttons: the same surface, hairline and safe-area padding, without the copy-and-hide
 * logic the invitation page needs.
 *
 * It sticks inside its own container (normally the form), so it sits in the flow after the last
 * field and can never cover it, and it never leaves that container. The page also keeps room at the
 * bottom of the scroll area (globals.css, WP-SB0 block), so a field the keyboard moves to is never
 * hidden behind the bar. There is no motion, so reduced-motion settings have nothing to change.
 *
 * Server-rendered; the buttons inside keep their own form and action wiring.
 */
export function StickyActionBar({
  label,
  note,
  children,
}: {
  /** The name of the group of buttons, for example "Save Your Profile". */
  readonly label: string;
  /** A short state line beside the buttons, for example "3 changes not saved yet". */
  readonly note?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <fieldset className="sticky-action-bar">
      <legend className="sr-only">{label}</legend>
      {note ? <output className="sticky-action-bar-note muted u-fs-085">{note}</output> : null}
      <div className="sticky-action-bar-actions">{children}</div>
    </fieldset>
  );
}
