import { getMissionForOwner } from '@visastack/services';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { withSession } from '../../../../lib/session';
import { WorkspaceCaseSubject } from '../../workspace-shell';

export default async function MissionLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const mission = await withSession(({ db, accountId }) => getMissionForOwner(db, accountId, id));
  if (!mission.ok) notFound();
  return (
    <>
      <WorkspaceCaseSubject route={`/app/mission/${id}`} applicantId={mission.value.applicantId} />
      {children}
    </>
  );
}
