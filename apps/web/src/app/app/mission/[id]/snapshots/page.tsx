import { getMissionForOwner, listMissionSnapshots } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../../../components/ui';
import { appMissionCatalog } from '../../../../../i18n/app-mission';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
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
  await primeLocale();
  const t = getServerT(appMissionCatalog);
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
        eyebrow={t('appMission.appMissionIdSnapshotsPage.case')}
        title={t('appMission.appMissionIdSnapshotsPage.allSnapshots')}
        description={t('appMission.appMissionIdSnapshotsPage.eachSnapshotKeepsExactlyWhatThis')}
      />
      <article className="card">
        {snapshots.length === 0 ? (
          <p className="card-body">
            {t.node('appMission.appMissionIdSnapshotsPage.noSnapshotsYetTakeOneFrom')}
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
                      {t.node('appMission.appMissionIdSnapshotsSnapshotidPage.applicationPacket')}
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
          <nav
            className="show-more"
            aria-label={t('appMission.appMissionIdSnapshotsPage.moreSnapshots')}
          >
            {nextCursor ? (
              <Link
                className="btn btn-secondary u-btn-sm show-more-link"
                href={pagingHref(pathname, query, { before: nextCursor }, 'snapshots-list')}
              >
                {t.node('appMission.appMissionIdSnapshotsPage.showOlderSnapshots')}
              </Link>
            ) : (
              <p className="muted u-fs-085 u-m-0">
                {t.node('appMission.appMissionIdSnapshotsPage.theseAreTheOldestSnapshotsOf')}
              </p>
            )}
            {before ? (
              <Link href={pathname}>
                {t.node('appMission.appMissionIdSnapshotsPage.backToTheNewestSnapshots')}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </article>
    </section>
  );
}
