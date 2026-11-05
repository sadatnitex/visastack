'use client';

import { type ReactNode, useState } from 'react';
import type { IconName } from '../../../../../components/icons';
import type { RowNoun } from '../../../../../components/show-more';
import { ActionRow } from '../../../../../components/ui-lift';

/**
 * A form, or a list (WP-SB11: the pending invitations, with their count), behind its own heading
 * (WP-SB5), drawn as one action row that opens in place. It opens on its own only on the first
 * visit that needs it (nothing listed yet), and then keeps whatever state the person left it in:
 * when the form's own success refreshes the page and the list stops being empty, it stays open, so
 * the confirmation and anything to copy stay in view.
 */
export function FormGroup({
  id,
  title,
  openAtFirst,
  count,
  noun,
  icon,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly openAtFirst: boolean;
  readonly count?: number;
  readonly noun?: RowNoun;
  readonly icon?: IconName;
  readonly children: ReactNode;
}) {
  const [initiallyOpen] = useState(openAtFirst);
  const words = noun ?? { one: 'item', other: 'items' };
  return (
    <details className="collapsible-group" id={id} open={initiallyOpen || undefined}>
      <ActionRow
        asSummary
        title={title}
        {...(icon ? { icon } : {})}
        {...(count === undefined
          ? {}
          : {
              pill: (
                <>
                  <span className="collapsible-group-count" aria-hidden="true">
                    {count}
                  </span>
                  <span className="sr-only">{`, ${count} ${count === 1 ? words.one : words.other}`}</span>
                </>
              ),
            })}
      />
      <div className="collapsible-group-body">{children}</div>
    </details>
  );
}
