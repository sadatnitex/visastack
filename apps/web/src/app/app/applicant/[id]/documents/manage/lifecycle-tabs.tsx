import Link from 'next/link';

export type LifecycleTab = 'current' | 'archived' | 'deleted';

/** Tab names, Title Case (docs/uiux/ccd/VOCABULARY.md). */
export const LIFECYCLE_TAB_LABELS: Readonly<Record<LifecycleTab, string>> = {
  current: 'Current',
  archived: 'Archived',
  deleted: 'Recently Deleted',
};

/** Reads `?view=` from the page's search parameters; anything unknown is Current. */
export function lifecycleTabOf(value: unknown): LifecycleTab {
  return value === 'archived' || value === 'deleted' ? value : 'current';
}

/**
 * The Current, Archived and Recently Deleted lists of the Documents page, as links (each list is
 * its own address, so it can be shared and reloaded). A tab other than Current shows only while
 * its list has something in it, and the whole row stays hidden while Current would be alone, so
 * people who have never archived or deleted anything see the page exactly as before. The
 * Removal Records link shows only when records exist.
 */
export function LifecycleTabs({
  basePath,
  active,
  archivedCount,
  deletedCount,
  removalRecordsHref,
}: {
  /** The Documents page path, without a query. */
  readonly basePath: string;
  readonly active: LifecycleTab;
  readonly archivedCount: number;
  readonly deletedCount: number;
  /** The Removal Records page, or null while there are none. */
  readonly removalRecordsHref: string | null;
}) {
  const tabs: Array<{ readonly tab: LifecycleTab; readonly count: number | null }> = [
    { tab: 'current', count: null },
  ];
  if (archivedCount > 0 || active === 'archived')
    tabs.push({ tab: 'archived', count: archivedCount });
  if (deletedCount > 0 || active === 'deleted') tabs.push({ tab: 'deleted', count: deletedCount });
  if (tabs.length === 1 && removalRecordsHref === null) return null;
  return (
    <nav className="lc-tabs" aria-label="Document lists">
      <ul className="lc-tabs-list">
        {tabs.map(({ tab, count }) => (
          <li key={tab}>
            <Link
              className="lc-tab"
              href={tab === 'current' ? basePath : `${basePath}?view=${tab}`}
              aria-current={tab === active ? 'page' : undefined}
            >
              {LIFECYCLE_TAB_LABELS[tab]}
              {count !== null ? <span className="lc-tab-count"> ({count})</span> : null}
            </Link>
          </li>
        ))}
        {removalRecordsHref ? (
          <li>
            <Link className="lc-tab lc-tab-records" href={removalRecordsHref}>
              Removal Records
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
