import type { ReactNode } from 'react';
import { atLevel } from '../../../../components/depth';
import type { IconName } from '../../../../components/icons';
import { ActionRow } from '../../../../components/ui-lift';
import type { DepthLevel } from '../../../../lib/ccd/depth';

/**
 * One card of the case rail that folds into a single 56px row on a phone and is simply the card on
 * a wide screen. It is a native `<details>`: the row is its `<summary>` (an ActionRow with the
 * card's name, one quiet line and a status) and the card is its body. A wide screen shows the body
 * without the row (globals.css, WP-LIFT-B block); a browser that cannot do that keeps the row, so
 * the card is still one tap away. Nothing needs script, and every id, link and heading stays in
 * the markup whatever the screen.
 */
export function RailFold({
  id,
  level,
  open,
  icon,
  title,
  meta,
  pill,
  children,
}: {
  /** The anchor the page's links point at; it sits on the card inside the row. */
  readonly id?: string;
  readonly level: DepthLevel;
  /** Starts open on a phone, for a card whose content is the next thing to do. */
  readonly open?: boolean | undefined;
  readonly icon: IconName;
  /** The card's name, in Title Case; the card inside names itself the same way. */
  readonly title: string;
  /** One plain line under the name on a phone. */
  readonly meta?: string | undefined;
  /** A status at the right of the row on a phone. */
  readonly pill?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <details className="lift-fold lift-rail-slot" {...atLevel(level)} open={open}>
      <ActionRow asSummary icon={icon} title={title} meta={meta} pill={pill} />
      {/* The id is on the body, inside the closed row, so a link to it opens the row. */}
      <div className="lift-fold-body" {...(id ? { id } : {})}>
        {children}
      </div>
    </details>
  );
}
