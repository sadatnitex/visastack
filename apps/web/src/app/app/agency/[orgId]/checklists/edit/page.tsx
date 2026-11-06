import { NECESSITY_LABELS, requirementNecessity } from '@visastack/core';
import { agencyChecklistPrincipal, getAgencyListDetail } from '@visastack/services';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocumentTypeDatalist } from '../../../../../../components/catalogue-datalists';
import { PageHeader, StatusBadge } from '../../../../../../components/ui';
import { documentTypeLabel } from '../../../../../../lib/labels';
import { type SearchParamsRecord, firstParam } from '../../../../../../lib/paging';
import { withSession } from '../../../../../../lib/session';
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
  return (
    <div className="stack">
      <PageHeader
        back={{ href: `/app/agency/${orgId}/checklists`, label: 'Checklists' }}
        eyebrow="Our List"
        title={detail.name}
        description={
          editing
            ? 'You are changing a draft. Cases keep the published version until you publish.'
            : 'Cases on your agency offer this version. Open a draft to change it.'
        }
        meta={
          <StatusBadge tone={editing ? 'warning' : 'success'}>
            {editing
              ? `Draft, Version ${detail.version.version}`
              : `Published, Version ${detail.version.version}`}
          </StatusBadge>
        }
      />
      <DocumentTypeDatalist />
      <section className="stack" aria-labelledby="items">
        <h2 id="items" className="section-title">
          Items
        </h2>
        {detail.items.length === 0 ? <p>This list has no items yet.</p> : null}
        <ul className="field-list">
          {detail.items.map((item) => {
            const necessity = requirementNecessity(item);
            const label = item.notes ?? documentTypeLabel(item.docType ?? '');
            return (
              <li key={item.id}>
                {editing ? (
                  <ItemEditor
                    organizationId={orgId}
                    packId={packId}
                    requirementId={item.id}
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
                    {item.interpretation ? <p>For: {item.interpretation}</p> : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {editing ? (
        <>
          <section className="stack" aria-labelledby="add-item">
            <h2 id="add-item" className="section-title">
              Add an Item
            </h2>
            <AddItemForm organizationId={orgId} packId={packId} packVersionId={detail.version.id} />
          </section>
          <section className="stack" aria-labelledby="finish">
            <h2 id="finish" className="section-title">
              Finish
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
      ) : (
        <StartChangesButton organizationId={orgId} packId={packId} />
      )}
    </div>
  );
}
