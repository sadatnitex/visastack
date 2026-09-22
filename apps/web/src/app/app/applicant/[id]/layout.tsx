import { createTranslator } from '@visastack/i18n';
import { getApplicant } from '@visastack/services';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getLocale } from '../../../../lib/locale';
import { relationshipLabel } from '../../../../lib/relationship-labels';
import { withSession } from '../../../../lib/session';
import { SubNav } from '../../subnav';

export const dynamic = 'force-dynamic';

/**
 * Applicant workspace shell (master directive §7 "PR 7" - Overview, Profile,
 * Documents, Missions, Sharing, Evidence, History as real, distinct
 * destinations rather than one overloaded page). "Evidence" isn't in the
 * directive's own 6-item list but is real, shipped functionality (responding
 * to an agency's evidence requests) - kept as a 7th tab rather than deleted
 * or silently hidden. "Expiry" (NTF-01, Part 5 §1) is an 8th tab for the
 * same reason.
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

  const base = `/app/applicant/${id}`;

  return (
    <section className="section container">
      <div className="toolbar" style={{ marginBottom: '1.5rem' }}>
        <div>
          <span className="eyebrow">Applicant</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {applicant.displayName}
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            {relationshipLabel(applicant.relationship, t)}
          </p>
        </div>
      </div>
      <SubNav
        links={[
          { href: base, label: 'Overview' },
          { href: `${base}/profile`, label: 'Profile' },
          { href: `${base}/documents`, label: 'Documents' },
          { href: `${base}/missions`, label: 'Missions' },
          { href: `${base}/sharing`, label: 'Sharing' },
          { href: `${base}/evidence`, label: 'Evidence' },
          { href: `${base}/expiry`, label: 'Expiry' },
          { href: `${base}/history`, label: 'History' },
        ]}
      />
      {children}
    </section>
  );
}
