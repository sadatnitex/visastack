import { getMissionForOwner, listMissionSnapshots } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../../../components/ui';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { type SearchParamsRecord, pagingHref, parseCursor } from '../../../../../lib/paging';
import { withSession } from '../../../../../lib/session';
import { isPacketSnapshot } from '../snapshot-packet';

export const metadata: Metadata = { title: 'Case Snapshots' };

export const dynamic = 'force-dynamic';

/** How many snapshots one load lists; Show More asks the server for the next, older ones. */
const SNAPSHOTS_PER_LOAD = 25;

/**
 * Every snapshot of one case, newest first (WP-SB2). The case page lists the five newest and links
 * here. The list is read in pages behind the same owner check as the case page: a cursor only says
 * where the last page stopped, and one made for another case gives the first page.
 */
export default async function MissionSnapshotsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Promise<SearchParamsRecord>;
}) {
  const { id } = await params;
  const query: SearchParamsRecord = (await searchParams) ?? {};
  const { before: cursor } = query;
  const before = parseCursor(cursor);

  const data = await withSession(async ({ db, accountId }) => {
    const owned = await getMissionForOwner(db, accountId, id);
    if (!owned.ok) return null;
    const page = await listMissionSnapshots(db, accountId, id, {
      limit: SNAPSHOTS_PER_LOAD,
      ...(before ? { before } : {}),
    });
    if (!page.ok) return null;
    return {
      mission: owned.value,
      snapshots: page.value.items.map((snap) => ({
        id: snap.id,
        version: snap.version,
        checksum: snap.checksum,
        createdAt: snap.createdAt.toISOString(),
        isPacket: isPacketSnapshot(snap.content),
      })),
      nextCursor: page.value.nextCursor,
    };
  });

  if (!data) notFound();
  const { mission, snapshots, nextCursor } = data;
  const pathname = `/app/mission/${mission.id}/snapshots`;

  return (
    <section className="section container">
      <PageHeader
        back={{ href: `/app/mission/${mission.id}`, label: mission.title }}
        eyebrow="Case"
        title="All Snapshots"
        description="Each snapshot keeps exactly what this case held when it was taken, newest first."
      />
      <article className="card">
        {snapshots.length === 0 ? (
          <p className="card-body">
            No snapshots yet. Take one from the case page to keep a copy of this case as it is.
          </p>
        ) : (
          <div className="rows" id="snapshots-list">
            {snapshots.map((snap, index) => (
              <Link
                href={`/app/mission/${mission.id}/snapshots/${snap.id}`}
                className="row row-link"
                key={snap.id}
                id={`snapshot-row-${index}`}
              >
                <span className="row-key">
                  Version {snap.version}
                  {snap.isPacket ? (
                    <span className="badge badge-success case-snapshot-packet">
                      Application Packet
                    </span>
                  ) : null}
                </span>
                <span className="muted u-fs-075" title={snap.checksum}>
                  {formatTimestampDate(snap.createdAt)} · {snap.checksum.slice(0, 12)}…
                </span>
              </Link>
            ))}
          </div>
        )}
        {nextCursor || before ? (
          <nav className="show-more" aria-label="More snapshots">
            {nextCursor ? (
              <Link
                className="btn btn-secondary u-btn-sm show-more-link"
                href={pagingHref(pathname, query, { before: nextCursor }, 'snapshots-list')}
              >
                Show Older Snapshots
              </Link>
            ) : (
              <p className="muted u-fs-085 u-m-0">These are the oldest snapshots of this case.</p>
            )}
            {before ? <Link href={pathname}>Back to the Newest Snapshots</Link> : null}
          </nav>
        ) : null}
      </article>
    </section>
  );
}
