import { createTranslator } from '@visastack/i18n';
import { getApplicant } from '@visastack/services';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '../../../../components/ui';
import { getLocale } from '../../../../lib/locale';
import { relationshipLabel } from '../../../../lib/relationship-labels';
import { withSession } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

/** Existing owner guard and selected-person heading; primary navigation is in the shared shell. */
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
  const t = createTranslator(await getLocale());

  return (
    <section className="section container">
      <div className="applicant-context-heading">
        <PageHeader
          eyebrow="Applicant"
          title={applicant.displayName}
          description={relationshipLabel(applicant.relationship, t)}
        />
      </div>
      {children}
    </section>
  );
}
