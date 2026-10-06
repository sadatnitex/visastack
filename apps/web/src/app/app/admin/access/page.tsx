import {
  listActivePlatformRoles,
  listInvitations,
  reportUnboundAccounts,
} from '@visastack/services';
import type { Metadata } from 'next';
import { isPlatformAdmin, isPlatformOwnerAccount } from '../../../../lib/admin';
import { formatTimestampDate } from '../../../../lib/format-date';
import { withSession } from '../../../../lib/session';
import { tolerantReader } from '../../../../lib/tolerate';
import { RevokeInvitationButton, RevokeRoleButton } from '../action-buttons';
import { GrantRoleForm, InviteForm } from '../admin-forms';
import { AdminRestricted } from '../admin-restricted';
import { FailedSectionsBanner } from '../failed-sections-banner';

export const metadata: Metadata = { title: 'Platform access' };

export const dynamic = 'force-dynamic';

const PLATFORM_ROLE_LABELS: Record<string, string> = {
  PLATFORM_OWNER: 'Platform owner',
  SECURITY_ADMIN: 'Security admin',
  COMPLIANCE_ADMIN: 'Compliance admin',
  SUPPORT_ADMIN: 'Support admin',
  QUALITY_ADMIN: 'Quality admin',
};

/** Platform roles, pilot sign-in invitations, and accounts still waiting to be tied to a sign-in identity. */
export default async function AdminAccessPage() {
  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    const { read: t, failed: failedSections } = tolerantReader();
    const [roles, unboundAccounts, invitations, owner] = await Promise.all([
      t('platform roles', () => listActivePlatformRoles(db), []),
      t('unbound accounts', () => reportUnboundAccounts(db), []),
      t('invitations', () => listInvitations(db), []),
      isPlatformOwnerAccount(db, { accountId, email }),
    ]);
    return { admin: true as const, roles, unboundAccounts, invitations, owner, failedSections };
  });

  return (
    <section className="section container">
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Platform</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Access
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Who holds a platform role, and who may sign in during the controlled pilot.
          </p>
        </div>
      </div>

      {!data.admin ? (
        <AdminRestricted />
      ) : (
        <>
          <FailedSectionsBanner sections={data.failedSections} />

          <article className="card" style={{ marginBottom: '1.5rem' }} id="admin-security">
            <p className="card-kicker">Identity</p>
            <h2 className="card-title">Platform roles</h2>
            <p className="card-body" style={{ marginBottom: '1rem' }}>
              Replaces the old ADMIN_EMAILS allowlist. A grant is never deleted, only revoked, so
              the full history of who held what and why is always reconstructable.
            </p>
            {data.roles.length === 0 ? (
              <p className="card-body" style={{ marginBottom: '1.25rem' }}>
                No active grants.
              </p>
            ) : (
              <div className="rows" style={{ marginBottom: '1.25rem' }}>
                {data.roles.map((r) => (
                  <div
                    className="row"
                    key={r.id}
                    style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.75rem',
                      }}
                    >
                      <span className="row-key">{PLATFORM_ROLE_LABELS[r.role] ?? r.role}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span className="muted" style={{ fontSize: '0.8rem' }}>
                          {formatTimestampDate(r.assignedAt)}
                        </span>
                        {data.owner ? <RevokeRoleButton grantId={r.id} /> : null}
                      </span>
                    </div>
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      {r.reason}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {data.owner ? (
              <GrantRoleForm />
            ) : (
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                Only a platform owner can grant or revoke roles.
              </p>
            )}
          </article>

          <article className="card" style={{ marginBottom: '1.5rem' }} id="admin-pilot-access">
            <p className="card-kicker">Controlled pilot</p>
            <h2 className="card-title">Pilot access</h2>
            <p className="card-body" style={{ marginBottom: '1rem' }}>
              This is an invite-only controlled pilot: an authenticated identity that isn't invited
              or allowlisted is denied a local account. An invitation is never deleted, only revoked
              - the full history of who was invited, by whom, and why is always reconstructable.
              Revoking only blocks a future, not-yet-provisioned sign-in; an account already
              provisioned from this invitation keeps its access.
            </p>
            {data.invitations.length === 0 ? (
              <p className="card-body" style={{ marginBottom: '1.25rem' }}>
                No invitations yet.
              </p>
            ) : (
              <div className="rows" style={{ marginBottom: '1.25rem' }}>
                {data.invitations.map((inv) => {
                  const status = inv.revokedAt
                    ? { label: 'Revoked', tone: 'badge-danger' }
                    : inv.acceptedAt
                      ? { label: 'Accepted', tone: 'badge-success' }
                      : { label: 'Pending', tone: 'badge-neutral' };
                  return (
                    <div
                      className="row"
                      key={inv.id}
                      style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '0.75rem',
                        }}
                      >
                        <span className="row-key" style={{ wordBreak: 'break-word' }}>
                          {inv.email}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <span className={`badge ${status.tone}`}>{status.label}</span>
                          {data.owner && !inv.revokedAt ? (
                            <RevokeInvitationButton invitationId={inv.id} />
                          ) : null}
                        </span>
                      </div>
                      <span className="muted" style={{ fontSize: '0.8rem' }}>
                        {inv.reason ?? 'No reason given'} · invited{' '}
                        {formatTimestampDate(inv.invitedAt)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {data.owner ? (
              <InviteForm />
            ) : (
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                Only a platform owner can invite or revoke pilot access.
              </p>
            )}
          </article>

          {data.unboundAccounts.length > 0 ? (
            <article className="card" style={{ marginBottom: '1.5rem' }}>
              <p className="card-kicker">Identity</p>
              <h2 className="card-title">Accounts awaiting WorkOS identity binding</h2>
              <p className="card-body" style={{ marginBottom: '1rem' }}>
                Read-only migration report - resolves itself the moment each owner next signs in.
                The
                <code>workos_user_id</code> column becomes required only once this list is empty.
              </p>
              <div className="rows">
                {data.unboundAccounts.map((a) => (
                  <div className="row" key={a.id}>
                    <span className="row-key" style={{ wordBreak: 'break-word' }}>
                      {a.email}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span className="muted" style={{ fontSize: '0.8rem' }}>
                        since {formatTimestampDate(a.createdAt)}
                      </span>
                      <span
                        className={`badge ${a.applicantCount > 0 ? 'badge-warning' : 'badge-neutral'}`}
                      >
                        {a.applicantCount} applicant{a.applicantCount === 1 ? '' : 's'}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </article>
          ) : null}
        </>
      )}
    </section>
  );
}
