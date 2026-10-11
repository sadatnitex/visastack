import { listNotes } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { withSession } from '../../../../../lib/session';
import { loadOrgAccess, loadVisibleCaseList } from '../console-data';

export const metadata: Metadata = { title: 'Agency activity' };

export const dynamic = 'force-dynamic';

/** A bounded view of actual case notes, not a new organization-wide audit authority. */
export default async function AgencyActivityPage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const data = await withSession(async ({ db, accountId }) => {
    const access = await loadOrgAccess(db, accountId, orgId);
    if (!access?.member) return null;
    const visible = await loadVisibleCaseList(db, accountId, orgId);
    const selected = [...visible]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 10);
    const notes = (
      await Promise.all(
        selected.map(async (mission) =>
          (
            await listNotes(db, orgId, mission.applicantId, mission.missionId, { limit: 50 })
          ).map((note) => ({
            id: note.id,
            createdAt: note.createdAt,
            body: note.body,
            caseTitle: mission.title,
            missionId: mission.missionId,
          })),
        ),
      )
    )
      .flat()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50);
    return { notes, caseLimitReached: visible.length > 10 };
  });
  if (!data) return null;
  return (
    <>
      <PageHeader
        as="h2"
        title="Activity log"
        description="Recent notes on cases you can access. This is case activity, not a complete organization audit log."
      />
      <article className="card">
        {data.caseLimitReached ? (
          <p className="card-body">
            Showing notes from the ten most recently updated accessible cases. Open a case for its
            full history.
          </p>
        ) : null}
        {data.notes.length ? (
          <div className="rows">
            {data.notes.map((note) => (
              <article key={note.id} className="workspace-activity-item">
                <Link href={`/app/agency/${orgId}/cases#mission-${note.missionId}`}>
                  {note.caseTitle}
                </Link>
                <p>{note.body}</p>
                <time dateTime={note.createdAt.toISOString()}>
                  {formatTimestampDate(note.createdAt)}
                </time>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No case activity recorded">
            New case notes appear here when your team records them on an accessible case.
          </EmptyState>
        )}
      </article>
    </>
  );
}
