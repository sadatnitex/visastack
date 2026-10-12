import { getApplicant } from '@visastack/services';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { withSession } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

/** Existing owner guard; selected-person identity is shown in the workspace selector; primary navigation is in the shared shell. */
export default async function ApplicantWorkspaceLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const applicant = await withSession(async ({ db, accountId }) => {
    const a = await getApplicant(db, id);
    if (!a || a.ownerAccountId !== accountId) return null;
    return a;
  });
  if (!applicant) notFound();

  return <section className="section container">{children}</section>;
}
