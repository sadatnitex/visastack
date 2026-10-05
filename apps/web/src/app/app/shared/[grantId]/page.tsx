import { getRecipientWorkspace } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
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
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/app/shared" className="muted" style={{ fontSize: '0.9rem' }}>
          ← Shared with you
        </Link>
      </div>
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Shared workspace</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {workspace.applicantDisplayName}
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            {workspace.grant.purpose}
            {workspace.grant.expiryAt
              ? ` · expires ${new Date(workspace.grant.expiryAt).toLocaleDateString()}`
              : ''}
          </p>
        </div>
      </div>

      <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '1.5rem' }}>
        Every item below is re-checked against your grant's permissions on every visit — it never
        shows more than what was shared with you, and never less than you're entitled to.
      </p>

      {workspace.missionScopeUnavailable ? (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
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
            <p className="card-body">No profile fields are shared with you.</p>
          ) : (
            <div className="rows" style={{ marginTop: '0.5rem' }}>
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
            <p className="card-body">No documents are shared with you.</p>
          ) : (
            <>
              <div className="rows" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
                {workspace.documents.map((doc) => (
                  <div className="row" key={doc.id}>
                    <span className="row-key">{doc.displayName}</span>
                    {doc.docType ? (
                      <span className="badge badge-neutral">{doc.docType}</span>
                    ) : null}
                  </div>
                ))}
              </div>
              <p className="muted" style={{ fontSize: '0.8rem' }}>
                Document preview isn't available yet — real redacted renditions for third-party
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
