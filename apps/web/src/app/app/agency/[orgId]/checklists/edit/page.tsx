import { NECESSITY_LABELS, requirementNecessity } from '@visastack/core';
import { agencyChecklistPrincipal, getAgencyListDetail } from '@visastack/services';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocumentTypeDatalist } from '../../../../../../components/catalogue-datalists';
import { PageHeader, StatusBadge } from '../../../../../../components/ui';
import { appAgencyCatalog } from '../../../../../../i18n/app-agency';
import { getServerT, primeLocale } from '../../../../../../lib/i18n-server';
import { type SearchParamsRecord, firstParam } from '../../../../../../lib/paging';
import { withSession } from '../../../../../../lib/session';
import { requirementLabel } from '../../../../mission/[id]/case-model';
import {
  AddItemForm,
  DiscardButton,
  ItemEditor,
  PublishButton,
  StartChangesButton,
} from '../checklist-forms';

export const metadata: Metadata = { title: 'Checklist' };
export const dynamic = 'force-dynamic';

/** One of the agency's own lists: read it, or change it as a draft and publish the next version. */
export default async function AgencyChecklistPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ orgId: string }>;
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  await primeLocale();
  const t = getServerT(appAgencyCatalog);
  const { orgId } = await params;
  // The list's id rides in the query, never in a folder name (a folder name would stream a 200 page before a refusal).
  const { pack } = await searchParams;
  const packId = (firstParam(pack) ?? '').trim();
  const detail = await withSession(async ({ db, accountId }) => {
    const scope = await agencyChecklistPrincipal(db, accountId, orgId);
    if (!scope.ok) return null;
    const found = await getAgencyListDetail(db, scope.value, { packId });
    return found.ok ? found.value : null;
  });
  if (!detail) notFound();
  const editing = detail.version.status === 'DRAFT';
  // A version approved but not yet published (a publish that stopped halfway) only needs finishing.
  const waiting = detail.version.status === 'APPROVED';
  return (
    <div className="stack">
      <PageHeader
        back={{ href: `/app/agency/${orgId}/checklists`, label: 'Checklists' }}
        eyebrow={t('appAgency.appAgencyOrgidChecklistsEditPage.ourList')}
        title={detail.name}
        description={
          editing
            ? t('appAgency.appAgencyOrgidChecklistsEditPage.youAreChangingADraftCases')
            : waiting
              ? t('appAgency.appAgencyOrgidChecklistsEditPage.aChangeIsReadyButNot')
              : t('appAgency.appAgencyOrgidChecklistsEditPage.casesOnYourAgencyOfferThis')
        }
        meta={
          <StatusBadge tone={editing || waiting ? 'warning' : 'success'}>
            {editing
              ? t('appAgency.appAgencyOrgidChecklistsEditPage.draftVersionVersion', {
                  version: detail.version.version,
                })
              : waiting
                ? t('appAgency.appAgencyOrgidChecklistsEditPage.readyToPublishVersionVersion', {
                    version: detail.version.version,
                  })
                : t('appAgency.appAgencyOrgidChecklistsEditPage.publishedVersionVersion', {
                    version: detail.version.version,
                  })}
          </StatusBadge>
        }
      />
      <DocumentTypeDatalist />
      <section className="stack" aria-labelledby="items">
        <h2 id="items" className="section-title">
          {t('appAgency.appAgencyOrgidChecklistsEditPage.items')}
        </h2>
        {detail.items.length === 0 ? (
          <p>{t('appAgency.appAgencyOrgidChecklistsEditPage.thisListHasNoItemsYet')}</p>
        ) : null}
        <ul className="field-list">
          {detail.items.map((item) => {
            const necessity = requirementNecessity(item);
            const label = requirementLabel({
              kind: item.kind,
              key: item.fieldKey ?? item.docType ?? '',
              wording: item.notes ?? undefined,
            });
            return (
              <li key={item.id}>
                {editing ? (
                  <ItemEditor
                    organizationId={orgId}
                    packId={packId}
                    requirementId={item.id}
                    kind={item.kind}
                    label={label}
                    docType={item.docType}
                    necessity={necessity}
                    wording={item.notes}
                    appliesWhen={item.interpretation}
                  />
                ) : (
                  <>
                    <strong>{label}</strong>{' '}
                    <StatusBadge tone={necessity === 'MANDATORY' ? 'success' : 'neutral'}>
                      {NECESSITY_LABELS[necessity]}
                    </StatusBadge>
                    {item.interpretation ? (
                      <p>
                        {t('appAgency.appAgencyOrgidChecklistsEditPage.forInterpretation', {
                          interpretation: item.interpretation,
                        })}
                      </p>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {waiting ? (
        <PublishButton organizationId={orgId} packId={packId} packVersionId={detail.version.id} />
      ) : null}
      {editing ? (
        <>
          <section className="stack" aria-labelledby="add-item">
            <h2 id="add-item" className="section-title">
              {t('appAgency.appAgencyOrgidChecklistsEditPage.addAnItem')}
            </h2>
            <AddItemForm organizationId={orgId} packId={packId} packVersionId={detail.version.id} />
          </section>
          <section className="stack" aria-labelledby="finish">
            <h2 id="finish" className="section-title">
              {t('appAgency.appAgencyOrgidChecklistsEditPage.finish')}
            </h2>
            <PublishButton
              organizationId={orgId}
              packId={packId}
              packVersionId={detail.version.id}
            />
            <DiscardButton
              organizationId={orgId}
              packId={packId}
              packVersionId={detail.version.id}
            />
          </section>
        </>
      ) : waiting ? null : (
        <StartChangesButton organizationId={orgId} packId={packId} />
      )}
    </div>
  );
}
