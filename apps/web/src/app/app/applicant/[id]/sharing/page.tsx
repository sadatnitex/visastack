import { createTranslator } from '@visastack/i18n';
import {
  getApplicant,
  listAccessForApplicantDetailed,
  listDocumentsDetailed,
} from '@visastack/services';
import { notFound } from 'next/navigation';
import { grantStatusBadge } from '../../../../../lib/grant-status';
import { getLocale } from '../../../../../lib/locale';
import { withSession } from '../../../../../lib/session';
import { GrantForm } from './grant-form';
import { GrantOpButtons } from './grant-op-buttons';

export const dynamic = 'force-dynamic';

export default async function SharingPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = createTranslator(await getLocale());

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const [access, documents] = await Promise.all([
      listAccessForApplicantDetailed(db, accountId, id),
      listDocumentsDetailed(db, accountId, id),
    ]);
    return {
      applicant,
      grants: access.ok ? access.value : [],
      documents: documents.ok ? documents.value : [],
    };
  });

  if (!data) notFound();

  return (
    <>
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Sharing</span>
          <h2 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Access &amp; transparency
          </h2>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            You control every grant. Access is purpose-bound, takes effect only once accepted, and
            can be paused or revoked at any time.
          </p>
        </div>
      </div>

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Share</p>
          <h2 className="card-title">Grant access</h2>
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            Share with an existing VisaStack user by email. They must accept before any access
            begins.
          </p>
          <GrantForm
            applicantId={id}
            documents={data.documents.map((d) => ({
              id: d.id,
              displayName: d.approvedName ?? d.originalName,
            }))}
          />
        </article>

        <article className="card">
          <p className="card-kicker">Transparency</p>
          <h2 className="card-title">Who has access</h2>
          {data.grants.length > 0 ? (
            <p className="notice" style={{ marginBottom: '1rem' }}>
              Pausing or revoking stops all <em>future</em> access immediately. It cannot remotely
              erase copies the recipient already downloaded before that point.
            </p>
          ) : null}
          {data.grants.length === 0 ? (
            <p className="card-body">No access has been granted yet.</p>
          ) : (
            <div className="rows" style={{ marginTop: '0.5rem' }}>
              {data.grants.map((grant) => {
                const badge = grantStatusBadge(grant.status, t);
                const canPause = grant.status === 'ACTIVE';
                const canResume = grant.status === 'PAUSED';
                const canRevoke =
                  grant.status === 'ACTIVE' ||
                  grant.status === 'PAUSED' ||
                  grant.status === 'PENDING_ACCEPTANCE';
                return (
                  <div
                    className="row"
                    key={grant.id}
                    style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.75rem',
                      }}
                    >
                      <span className="row-key">
                        {grant.recipient.label}
                        {grant.recipient.kind === 'organization' ? ' (organization)' : ''}
                      </span>
                      <span className={`badge ${badge.tone}`}>{badge.label}</span>
                    </div>
                    <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                      {grant.purpose} · {grant.actions.length} permission
                      {grant.actions.length === 1 ? '' : 's'}
                      {grant.expiryAt
                        ? ` · expires ${new Date(grant.expiryAt).toLocaleDateString()}`
                        : ''}
                      {grant.acceptedAt
                        ? ` · accepted ${new Date(grant.acceptedAt).toLocaleDateString()}`
                        : ''}
                    </p>
                    {canPause || canResume || canRevoke ? (
                      <GrantOpButtons
                        applicantId={id}
                        grantId={grant.id}
                        ops={[
                          ...(canPause
                            ? [{ op: 'pause' as const, label: 'Pause', variant: 'btn-secondary' }]
                            : []),
                          ...(canResume
                            ? [{ op: 'resume' as const, label: 'Resume', variant: 'btn-secondary' }]
                            : []),
                          ...(canRevoke
                            ? [{ op: 'revoke' as const, label: 'Revoke', variant: 'btn-danger' }]
                            : []),
                        ]}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </article>
      </div>
    </>
  );
}
