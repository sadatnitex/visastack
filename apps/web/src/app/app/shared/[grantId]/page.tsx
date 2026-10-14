import { getRecipientWorkspace } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader } from '../../../../components/ui';
import { formatTimestampDate } from '../../../../lib/format-date';
import { documentTypeLabel } from '../../../../lib/labels';
import { profileField } from '../../../../lib/profile-fields';
import { withSession } from '../../../../lib/session';

export const metadata: Metadata = { title: 'Shared record' };

export const dynamic = 'force-dynamic';

export default async function SharedWorkspacePage({
  params,
}: {
  readonly params: Promise<{ grantId: string }>;
}) {
  const { grantId } = await params;

  const result = await withSession(({ db, accountId }) =>
    getRecipientWorkspace(db, { actorAccountId: accountId, grantId }),
  );

  if (!result.ok) notFound();
  const { value: workspace } = result;

  return (
    <section className="section container">
      <div className="u-mb-150">
        <Link href="/app/shared" className="muted u-fs-085">
          ← Shared with you
        </Link>
      </div>
      <PageHeader
        eyebrow="Shared workspace"
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
          <h2 className="card-title">Shared fields</h2>
          {workspace.fields.length === 0 ? (
            <EmptyState icon="user" title="No profile details shared">
              This person has not shared any profile details with you for this purpose.
            </EmptyState>
          ) : (
            <div className="rows u-mt-050">
              {workspace.fields.map((field) => (
                <div className="row" key={field.fieldKey}>
                  <span className="row-key">
                    {profileField(field.fieldKey)?.label ?? field.fieldKey}
                  </span>
                  <span>{field.value}</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">Document Vault</p>
          <h2 className="card-title">Shared documents</h2>
          {workspace.documents.length === 0 ? (
            <EmptyState icon="file" title="No documents shared">
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
              <p className="muted u-fs-085">
                Document preview isn't available yet. Real redacted renditions for third-party
                viewing are a separate, upcoming milestone. This list shows only which documents
                your grant covers.
              </p>
            </>
          )}
        </article>
      </div>
    </section>
  );
}
