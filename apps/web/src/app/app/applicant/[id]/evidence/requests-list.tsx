import { atLevel } from '../../../../../components/depth';
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
 * request's panel. Only the requests that need the person show at Glance.
 */
export function RequestsList({
  entries,
  itemHref,
  openItem,
  positions,
}: {
  readonly entries: readonly RequestEntry[];
  /** The address that opens one request's panel without script. */
  readonly itemHref: (id: string) => string;
  readonly openItem?: string | null | undefined;
  /** Each request's place in the full order, for the anchor Show More lands on. */
  readonly positions: ReadonlyMap<string, number>;
}) {
  const row = ({ req, item }: RequestEntry) => {
    const chip = requestChip(req, item);
    return (
      <div key={req.id} id={`evidence-row-${positions.get(req.id) ?? 0}`} className="rt-row-anchor">
        <ListRow
          id={req.id}
          name={requestName(req)}
          tone={chip.tone}
          status={chip.word}
          meta={req.dueDate ? `Needed by ${formatDateOnly(req.dueDate)}` : undefined}
          metaIsData
          icon={req.kind === 'FIELD' ? 'clipboard' : 'file'}
          openHref={itemHref(req.id)}
          domId={`request-${req.id}`}
        />
      </div>
    );
  };
  const groups = GROUPS.map((group) => ({
    ...group,
    rows: entries.filter((entry) => requestBucket(entry.req, entry.item) === group.bucket),
  })).filter((group) => group.rows.length > 0);
  const draw = (bucket: RequestBucket) => {
    const group = groups.find((g) => g.bucket === bucket);
    if (!group) return null;
    return (
      <GroupedList
        level={2}
        groups={[
          {
            id: `evidence-requests-${group.bucket}`,
            heading: group.heading,
            count: group.rows.length,
            tone: group.tone,
            // The folder of the chosen request, and the one that needs the person, start open.
            open:
              group.bucket === 'waiting' || group.rows.some((entry) => entry.req.id === openItem),
            children: group.rows.map(row),
          },
        ]}
      />
    );
  };
  return (
    <div className="rt-list" data-pattern="request-list">
      {draw('waiting')}
      <div {...atLevel('browse')}>
        {draw('checking')}
        {draw('finished')}
      </div>
    </div>
  );
}
