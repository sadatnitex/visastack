import { createTranslator } from '@visastack/i18n';
import { getApplicant } from '@visastack/services';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '../../../../components/ui';
import { getLocale } from '../../../../lib/locale';
import { applicantTabs } from '../../../../lib/navigation';
import { relationshipLabel } from '../../../../lib/relationship-labels';
import { withSession } from '../../../../lib/session';
import { SubNav } from '../../subnav';

export const dynamic = 'force-dynamic';

/**
 * Applicant workspace shell (master directive §7 "PR 7" - Overview, Profile,
 * Documents, Cases, Sharing, Evidence, History as real, distinct destinations
 * rather than one overloaded page). "Evidence" isn't in the directive's own
 * 6-item list but is real, shipped functionality (responding to an agency's
 * evidence requests) - kept as a 7th tab rather than deleted or silently
 * hidden. "Expiry" (NTF-01, Part 5 §1) is an 8th tab for the same reason. The
 * tab names live in `lib/navigation.ts`.
 */
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
      <PageHeader
        eyebrow="Applicant"
        title={applicant.displayName}
        description={relationshipLabel(applicant.relationship, t)}
      />
      <SubNav links={applicantTabs(id)} label="Applicant sections" />
      {children}
    </section>
  );
}
