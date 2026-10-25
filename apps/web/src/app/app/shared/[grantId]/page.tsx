import { getRecipientWorkspace, isPassportPhotoType } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader } from '../../../../components/ui';
import { VisaPhotoSizes } from '../../../../components/visa-photo-sizes';
import { formatTimestampDate } from '../../../../lib/format-date';
import { documentTypeLabel } from '../../../../lib/labels';
import { fieldLabel } from '../../../../lib/master-profile';
import { mayUseVisaPhotoSizes } from '../../../../lib/photo-sizes';
import { withSession } from '../../../../lib/session';

export const metadata: Metadata = { title: 'Shared Record' };

export const dynamic = 'force-dynamic';

export default async function SharedWorkspacePage({
  params,
}: {
  readonly params: Promise<{ grantId: string }>;
}) {
  const { grantId } = await params;

  const loaded = await withSession(async ({ db, accountId }) => {
    const result = await getRecipientWorkspace(db, { actorAccountId: accountId, grantId });
    if (!result.ok) return null;
    // Visa Photo Sizes only for a photo this viewer may take safe copies of, decided by the same
    // gate question the photo routes ask (across every grant they hold for it), never by this one
    // grant's list of actions, so the section and the server always agree.
    const organizationId = result.value.grant.recipientOrganizationId;
    const photoIds: string[] = [];
    for (const doc of result.value.documents) {
      if (!isPassportPhotoType(doc.docType)) continue;
      const allowed = await mayUseVisaPhotoSizes(
        db,
        accountId,
        doc.id,
        organizationId ? { organizationId } : 'individual',
      );
      if (allowed) photoIds.push(doc.id);
    }
    return { workspace: result.value, photoIds };
  });

  if (!loaded) notFound();
  const { workspace, photoIds } = loaded;

  return (
    <section className="section container">
      <div className="u-mb-150">
        <Link href="/app/shared" className="muted u-fs-085">
          ← Shared with you
        </Link>
      </div>
      <PageHeader
        eyebrow="Shared Workspace"
        title={workspace.applicantDisplayName}
        description={
          <>
            {workspace.grant.purpose}
            {workspace.grant.expiryAt
              ? ` · expires ${formatTimestampDate(workspace.grant.expiryAt)}`
              : ''}
          </>
        }
      />

      <p className="muted" style={{ fontSize: 'var(--text-small)', marginBottom: '1.5rem' }}>
        Every item below is re-checked against your grant's permissions on every visit. It never
        shows more than what was shared with you, and never less than you're entitled to.
      </p>

      {workspace.missionScopeUnavailable ? (
        <div className="card u-mb-150">
          <p className="card-body">
            This access is limited to a specific case. Case-scoped sharing isn't available yet -
            nothing is shown below until that support ships.
          </p>
        </div>
      ) : null}

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Profile</p>
          <h2 className="card-title">Shared Fields</h2>
          {workspace.fields.length === 0 ? (
            <EmptyState icon="user" title="No Profile Details Shared">
              This person has not shared any profile details with you for this purpose.
            </EmptyState>
          ) : (
            <div className="rows u-mt-050">
              {workspace.fields.map((field) => (
                <div className="row" key={field.fieldKey}>
                  <span className="row-key">{fieldLabel(field.fieldKey) ?? field.fieldKey}</span>
                  <span>{field.value}</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">Document Vault</p>
          <h2 className="card-title">Shared Documents</h2>
          {workspace.documents.length === 0 ? (
            <EmptyState icon="file" title="No Documents Shared">
              This person has not shared any documents with you for this purpose.
            </EmptyState>
          ) : (
            <>
              <div className="rows" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
                {workspace.documents.map((doc) => (
                  <div className="row" key={doc.id}>
                    <span className="row-key">{doc.displayName}</span>
                    {doc.docType ? (
                      <span className="badge badge-neutral">{documentTypeLabel(doc.docType)}</span>
                    ) : null}
                  </div>
                ))}
              </div>
              {photoIds.map((documentId) => (
                <VisaPhotoSizes
                  key={`photo-${documentId}`}
                  documentId={documentId}
                  returnTo={`/app/shared/${grantId}`}
                  actingFor={workspace.grant.recipientOrganizationId ?? 'individual'}
                />
              ))}
              <p className="muted u-fs-085">
                Other documents cannot be previewed here yet. This list shows which documents your
                grant covers. A passport photo shared with safe copies can be sized for a visa
                application above.
              </p>
            </>
          )}
        </article>
      </div>
    </section>
  );
}
