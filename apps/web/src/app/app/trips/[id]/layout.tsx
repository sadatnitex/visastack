import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { isRecordId } from '../../../../lib/record-id';
import { withSession } from '../../../../lib/session';
import { tripExists } from '../trip-data';

/**
 * UMPE P5: a trip of another account, or an unknown id, answers 404 here, before the trip's
 * loading screen, exactly like a missing one.
 */
export default async function GroupTripLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isRecordId(id)) notFound();
  if (!(await withSession(({ db, accountId }) => tripExists(db, accountId, id)))) notFound();
  return children;
}
