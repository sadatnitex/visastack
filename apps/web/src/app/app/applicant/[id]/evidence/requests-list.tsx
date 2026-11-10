import { GroupedList, ListRow } from '../../../../../components/list-pattern';
import { formatDateOnly } from '../../../../../lib/format-date';
import { type RequestBucket, requestBucket, requestChip, requestName } from './request-model';
import type { RequestEntry } from './request-panes';

const GROUPS: readonly {
  readonly bucket: RequestBucket;
  readonly heading: string;
  readonly tone: 'warning' | 'neutral';
}[] = [
  { bucket: 'waiting', heading: 'Waiting for You', tone: 'warning' },
  { bucket: 'checking', heading: 'Being Checked', tone: 'neutral' },
  { bucket: 'finished', heading: 'Finished', tone: 'neutral' },
];

/**
 * The requests as rows in folders: the ones that need the person first, then the ones being
 * checked, then the finished ones. A row is a mark, the name of what is asked, one chip and, when
 * there is one, the date it is needed by; opening it shows the conversation and the reply in the
 * request's panel. Only the folder of requests that need the person shows at Glance.
 */
export function RequestsList({
  entries,
  itemHref,
  openItem,
  positions,
  landPosition,
}: {
  readonly entries: readonly RequestEntry[];
  /** The address that opens one request's panel without script. */
  readonly itemHref: (id: string) => string;
  readonly openItem?: string | null | undefined;
  /** Each request's place in the full order, for the anchor Show More lands on. */
  readonly positions: ReadonlyMap<string, number>;
  /** The place of the first request Show More just added, whose folder opens so the landing is seen. */
  readonly landPosition?: number | undefined;
}) {
  const row = ({ req, item }: RequestEntry) => {
    const chip = requestChip(item);
    return (
      <ListRow
        key={req.id}
        id={req.id}
        name={requestName(req)}
        tone={chip.tone}
        status={chip.word}
        meta={req.dueDate ? `Needed by ${formatDateOnly(req.dueDate)}` : undefined}
        icon={req.kind === 'FIELD' ? 'clipboard' : 'file'}
        openHref={itemHref(req.id)}
        domId={`request-${req.id}`}
        nameId={`evidence-row-${positions.get(req.id) ?? 0}`}
      />
    );
  };
  const groups = GROUPS.map((group) => ({
    ...group,
    rows: entries.filter((entry) => requestBucket(entry.req, entry.item) === group.bucket),
  })).filter((group) => group.rows.length > 0);
  return (
    <div className="req-groups" data-pattern="request-list">
      <GroupedList
        level={2}
        groups={groups.map((group) => ({
          id: `evidence-requests-${group.bucket}`,
          heading: group.heading,
          count: group.rows.length,
          tone: group.tone,
          // The folder that needs the person, the chosen request's folder and the folder holding
          // the row Show More lands on start open, so the row is on screen.
          open:
            group.bucket === 'waiting' ||
            group.rows.some(
              (entry) =>
                entry.req.id === openItem ||
                (landPosition !== undefined && positions.get(entry.req.id) === landPosition),
            ),
          ...(group.bucket === 'waiting' ? {} : { level: 'browse' as const }),
          children: group.rows.map(row),
        }))}
      />
    </div>
  );
}
