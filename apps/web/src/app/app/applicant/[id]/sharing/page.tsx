import { getApplicant, listAccessForApplicant } from '@visastack/services';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { withSession } from '../../../../../lib/session';
import { updateGrantAction } from './actions';
import { GrantForm } from './grant-form';

export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, { label: string; tone: string }> = {
  PENDING_ACCEPTANCE: { label: 'Pending acceptance', tone: 'badge-neutral' },
  ACTIVE: { label: 'Active', tone: 'badge-success' },
  PAUSED: { label: 'Paused', tone: 'badge-warning' },
  REVOKED: { label: 'Revoked', tone: 'badge-danger' },
  EXPIRED: { label: 'Expired', tone: 'badge-neutral' },
};

function opButton(
  applicantId: string,
  grantId: string,
  op: string,
  label: string,
  variant: string,
) {
  return (
    <form action={updateGrantAction}>
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="grantId" value={grantId} />
      <input type="hidden" name="op" value={op} />
      <button
        type="submit"
        className={`btn ${variant}`}
        style={{ padding: '0.3rem 0.85rem', fontSize: '0.8rem' }}
      >
        {label}
      </button>
    </form>
  );
}

export default async function SharingPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const access = await listAccessForApplicant(db, accountId, id);
    return { applicant, grants: access.ok ? access.value : [] };
  });

  if (!data) notFound();

  return (
    <section className="section container">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href={`/app/applicant/${id}`} className="muted" style={{ fontSize: '0.9rem' }}>
          ← {data.applicant.displayName}
        </Link>
      </div>
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Sharing</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Access &amp; transparency
          </h1>
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
          <GrantForm applicantId={id} />
        </article>

        <article className="card">
          <p className="card-kicker">Transparency</p>
          <h2 className="card-title">Who has access</h2>
          {data.grants.length === 0 ? (
            <p className="card-body">No access has been granted yet.</p>
          ) : (
            <div className="rows" style={{ marginTop: '0.5rem' }}>
              {data.grants.map((grant) => {
                const badge = STATUS_BADGE[grant.status] ?? {
                  label: grant.status,
                  tone: 'badge-neutral',
                };
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
                      <span className="row-key">{grant.purpose}</span>
                      <span className={`badge ${badge.tone}`}>{badge.label}</span>
                    </div>
                    <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                      {grant.actions.length} permission{grant.actions.length === 1 ? '' : 's'}
                      {grant.expiryAt
                        ? ` · expires ${new Date(grant.expiryAt).toLocaleDateString()}`
                        : ''}
                    </p>
                    {canPause || canResume || canRevoke ? (
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {canPause
                          ? opButton(id, grant.id, 'pause', 'Pause', 'btn-secondary')
                          : null}
                        {canResume
                          ? opButton(id, grant.id, 'resume', 'Resume', 'btn-secondary')
                          : null}
                        {canRevoke
                          ? opButton(id, grant.id, 'revoke', 'Revoke', 'btn-danger')
                          : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
