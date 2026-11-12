import { agencyCollectionPrincipal } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { appAgencyCatalog } from '../../../../../../i18n/app-agency';
import { caseCountryOptions, casePurposeGroups } from '../../../../../../lib/case-choices';
import { getServerT, primeLocale } from '../../../../../../lib/i18n-server';
import { withSession } from '../../../../../../lib/session';
import { NewRequestForm } from '../collection-forms';

export const metadata: Metadata = { title: 'New Document Request' };
export const dynamic = 'force-dynamic';

/** Start a document request: where the person is going and why, and what the agency knows. */
export default async function NewCollectionRequestPage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  await primeLocale();
  const t = getServerT(appAgencyCatalog);
  const { orgId } = await params;
  const allowed = await withSession(
    async ({ db, accountId }) => (await agencyCollectionPrincipal(db, accountId, orgId)).ok,
  );
  if (!allowed) notFound();
  return (
    <div className="stack">
      <Link href={`/app/agency/${orgId}/collection`} className="page-back">
        <span aria-hidden="true">{'←'}</span>{' '}
        {t('appAgency.appAgencyOrgidCollectionNewPage.documentRequests')}
      </Link>
      <h1 className="page-title">
        {t('appAgency.appAgencyOrgidCollectionNewPage.newDocumentRequest')}
      </h1>
      <p className="page-description">
        {t('appAgency.appAgencyOrgidCollectionNewPage.noAccountOrProfileIsNeeded')}
      </p>
      <NewRequestForm
        organizationId={orgId}
        countries={caseCountryOptions()}
        purposeGroups={casePurposeGroups().map((group) => ({
          label: group.label,
          options: group.options,
        }))}
      />
    </div>
  );
}
