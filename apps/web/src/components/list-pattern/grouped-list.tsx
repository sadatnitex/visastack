import type { ReactNode } from 'react';
import type { DepthLevel } from '../../lib/ccd/depth';
import { atLevel } from '../depth';
import type { LiftTone } from '../ui-lift/types';

export interface ListGroupProps {
  /** Stable id of the fold, from its heading ("case-checklist-needs-you"); links point at it. */
  readonly id: string;
  /** The folder name, Title Case. */
  readonly heading: string;
  /** How many rows the group holds. */
  readonly count: number;
  readonly tone: LiftTone;
  /** Whether the fold starts open. */
  readonly open: boolean;
  /** The rows shown at once. */
  readonly children: ReactNode;
  /** The heading level, one below the heading of the card or section the group sits in. Four unless the screen says otherwise. */
  readonly headingLevel?: GroupHeadingLevel | undefined;
  /** The rest of the rows, folded under "n More Items". */
  readonly rest?: ReactNode;
  /** The label of the fold of the rest ("4 More Items"). */
  readonly restLabel?: string | undefined;
  /** The fold of the rest starts open (the chosen item is in it). */
  readonly restOpen?: boolean | undefined;
  /** The depth at which the whole folder shows; always when left out. */
  readonly level?: DepthLevel | undefined;
}

/** The heading level of the folder names: 4 under a card, 2 on a screen whose title is the h1. */
export type GroupHeadingLevel = 2 | 3 | 4;

/** The folder's heading, a real heading inside the opener so heading navigation finds every group. */
function GroupHeading({
  level,
  count,
  children,
}: {
  readonly level: GroupHeadingLevel;
  readonly count: number;
  readonly children: ReactNode;
}) {
  const Heading = `h${level}` as const;
  return (
    <Heading className="case-group-heading collapsible-group-title" data-pattern="group-heading">
      {children} <span className="muted lift-state-count">{count}</span>
    </Heading>
  );
}

/**
 * A folder of rows: a Title Case header with a count, the first rows shown, the rest folded.
 * Every list screen groups the same way. The header stays a real heading inside the fold's opener,
 * so heading navigation still finds every group. Groups that hold no rows are not drawn by the
 * caller (an empty group is hidden, not shown as zero).
 */
export function GroupedList({
  groups,
  level = 4,
}: {
  readonly groups: readonly ListGroupProps[];
  /** The heading level of every folder name unless the group sets its own. */
  readonly level?: GroupHeadingLevel;
}) {
  return (
    <div className="collapsible-groups lift-groups" data-pattern="grouped-list">
      {groups.map((group) => (
        <details
          className={`collapsible-group lift-group lift-group-${group.tone}`}
          id={group.id}
          key={group.id}
          open={group.open}
          {...(group.level ? atLevel(group.level) : {})}
        >
          <summary className="collapsible-group-summary">
            <GroupHeading level={group.headingLevel ?? level} count={group.count}>
              {group.heading}
            </GroupHeading>
          </summary>
          <div className="collapsible-group-body">
            <div className="rows">{group.children}</div>
            {group.rest ? (
              <details className="case-checklist-rest" open={group.restOpen === true}>
                <summary>{group.restLabel ?? 'More Items'}</summary>
                <div className="rows">{group.rest}</div>
              </details>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}
