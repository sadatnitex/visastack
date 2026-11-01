'use client';

import { type ReactNode, useState } from 'react';
import { CollapsibleGroup } from '../../../../../components/collapsible-group';
import type { RowNoun } from '../../../../../components/show-more';

/**
 * A form, or a list (WP-SB11: the pending invitations, with their count), behind its own heading
 * (WP-SB5). It opens on its own only on the first visit that needs
 * it (nothing listed yet), and then keeps whatever state the person left it in: when the form's
 * own success refreshes the page and the list stops being empty, it stays open, so the
 * confirmation and anything to copy stay in view.
 */
export function FormGroup({
  id,
  title,
  openAtFirst,
  count,
  noun,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly openAtFirst: boolean;
  readonly count?: number;
  readonly noun?: RowNoun;
  readonly children: ReactNode;
}) {
  const [initiallyOpen] = useState(openAtFirst);
  return (
    <CollapsibleGroup
      id={id}
      title={title}
      open={initiallyOpen}
      {...(count === undefined ? {} : { count })}
      {...(noun ? { noun } : {})}
    >
      {children}
    </CollapsibleGroup>
  );
}
