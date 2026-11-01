import type { ReactNode } from 'react';
import type { RowNoun } from './show-more';

/**
 * A section of a long page that opens and closes, with how many items it holds in its title, so a
 * page can show its headings first and only the part the person needs. Built on details and
 * summary: it works without script, opens from the keyboard, and the browser opens it on its own
 * when a link or find-in-page points inside it.
 */
export function CollapsibleGroup({
  id,
  title,
  count,
  noun,
  open = false,
  children,
}: {
  readonly id?: string;
  readonly title: string;
  /** How many items the group holds; left out when a count would mean nothing. */
  readonly count?: number;
  /** How a screen reader names the items, for example `{ one: 'document', other: 'documents' }`. */
  readonly noun?: RowNoun;
  readonly open?: boolean;
  readonly children: ReactNode;
}) {
  const words = noun ?? { one: 'item', other: 'items' };
  return (
    <details className="collapsible-group" id={id} open={open || undefined}>
      <summary className="collapsible-group-summary">
        <span className="collapsible-group-title">{title}</span>
        {count === undefined ? null : (
          <>
            <span className="collapsible-group-count" aria-hidden="true">
              {count}
            </span>
            <span className="sr-only">{`, ${count} ${count === 1 ? words.one : words.other}`}</span>
          </>
        )}
      </summary>
      <div className="collapsible-group-body">{children}</div>
    </details>
  );
}

export interface CollapsibleGroupItem {
  readonly key: string;
  readonly title: string;
  readonly count?: number;
  readonly content: ReactNode;
}

/**
 * Several groups in a row, with the first one open (or the one named by `openKey`, for example
 * the group a link points at), so the page starts with something useful showing.
 */
export function CollapsibleGroups({
  groups,
  noun,
  openKey,
  idPrefix,
}: {
  readonly groups: readonly CollapsibleGroupItem[];
  readonly noun?: RowNoun;
  readonly openKey?: string;
  /** When set, each group gets the id `<idPrefix>-<key>`, so a link can point at it. */
  readonly idPrefix?: string;
}) {
  const opened = groups.some((group) => group.key === openKey) ? openKey : groups[0]?.key;
  return (
    <div className="collapsible-groups">
      {groups.map((group) => (
        <CollapsibleGroup
          key={group.key}
          {...(idPrefix ? { id: `${idPrefix}-${group.key}` } : {})}
          title={group.title}
          {...(group.count === undefined ? {} : { count: group.count })}
          {...(noun ? { noun } : {})}
          open={group.key === opened}
        >
          {group.content}
        </CollapsibleGroup>
      ))}
    </div>
  );
}
