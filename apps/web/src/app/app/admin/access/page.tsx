import {
  listActivePlatformRoles,
  listInvitations,
  reportUnboundAccounts,
  staffFactorCoverage,
} from '@visastack/services';
import type { Metadata } from 'next';
import { PageHeader } from '../../../../components/ui';
import { isPlatformAdmin, isPlatformOwnerAccount } from '../../../../lib/admin';
import { formatTimestampDate } from '../../../../lib/format-date';
import { neonSessionRef } from '../../../../lib/neon-recency';
import { createKeyManagementPort } from '../../../../lib/providers';
import { withSession } from '../../../../lib/session';
import { staffFactorMode } from '../../../../lib/staff-factor';
import { tolerantReader } from '../../../../lib/tolerate';
import {
  ResetAuthenticatorButton,
  RevokeInvitationButton,
  RevokeRoleButton,
} from '../action-buttons';
import { GrantRoleForm, InviteForm } from '../admin-forms';
import { AdminRestricted } from '../admin-restricted';
import { FailedSectionsBanner } from '../failed-sections-banner';

export const metadata: Metadata = { title: 'Platform Access' };

export const dynamic = 'force-dynamic';

const PLATFORM_ROLE_LABELS: Record<string, string> = {
  PLATFORM_OWNER: 'Platform Owner',
  SECURITY_ADMIN: 'Security Admin',
  COMPLIANCE_ADMIN: 'Compliance Admin',
  SUPPORT_ADMIN: 'Support Admin',
  QUALITY_ADMIN: 'Quality Admin',
};

/** Platform roles, pilot sign-in invitations, and accounts still waiting to be tied to a sign-in identity. */
export default async function AdminAccessPage() {
  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    const { read: t, failed: failedSections } = tolerantReader();
    const [roles, unboundAccounts, invitations, owner, coverage] = await Promise.all([
      t('platform roles', () => listActivePlatformRoles(db), []),
      t('unbound accounts', () => reportUnboundAccounts(db), []),
      t('invitations', () => listInvitations(db), []),
      isPlatformOwnerAccount(db, { accountId, email }),
      t('authenticator coverage', () => staffFactorCoverage(db), null),
    ]);
    return {
      admin: true as const,
      roles,
      unboundAccounts,
      invitations,
      owner,
      coverage,
      self: accountId,
      // Both are needed to check a code: a readable sign-in and the key service that opens the secret.
      canCheckCodes: (await neonSessionRef()) !== null && createKeyManagementPort() !== undefined,
      failedSections,
    };
  });

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Platform"
        title="Access"
        description="Who holds a platform role, and who may sign in during the controlled pilot."
      />

      {!data.admin ? (
        <AdminRestricted />
      ) : (
        <>
          <FailedSectionsBanner sections={data.failedSections} />

          <article className="card u-mb-150" id="admin-security">
            <p className="card-kicker">Identity</p>
            <h2 className="card-title">Platform Roles</h2>
            <p className="card-body u-mb-100">
              Platform roles determine who can manage the service. Role history is retained when
              access is revoked.
            </p>
            <p className="card-body u-mb-100">
              {staffFactorMode() === 'off'
                ? 'Authenticator codes are not required for staff yet.'
                : 'Staff confirm sensitive actions with an authenticator code.'}
              {data.coverage
                ? ` ${data.coverage.enrolled} of ${data.coverage.staff} staff have set one up.`
                : ''}
              {data.canCheckCodes
                ? ' Codes can be checked here.'
                : ' Codes cannot be checked here yet, so do not require them.'}
            </p>
            {data.roles.length === 0 ? (
              <p className="card-body u-mb-125">No active grants.</p>
            ) : (
              <div className="rows u-mb-125">
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
                      <span className="row-end">
                        <span className="muted u-fs-085">{formatTimestampDate(r.assignedAt)}</span>
                        {data.owner && r.accountId && r.accountId !== data.self ? (
                          <ResetAuthenticatorButton targetAccountId={r.accountId} />
                        ) : null}
                        {data.owner ? <RevokeRoleButton grantId={r.id} /> : null}
                      </span>
                    </div>
                    <span className="muted u-fs-085">{r.reason}</span>
                  </div>
                ))}
              </div>
            )}
            {data.owner ? (
              <GrantRoleForm />
            ) : (
              <p className="muted u-fs-085">Only a platform owner can grant or revoke roles.</p>
            )}
          </article>

          <article className="card u-mb-150" id="admin-pilot-access">
            <p className="card-kicker">Controlled Pilot</p>
            <h2 className="card-title">Pilot Access</h2>
            <p className="card-body u-mb-100">
              This is an invite-only controlled pilot: an authenticated identity that isn't invited
              or allowlisted is denied a local account. An invitation is never deleted, only revoked
              - the full history of who was invited, by whom, and why is always reconstructable.
              Revoking only blocks a future, not-yet-provisioned sign-in; an account already
              provisioned from this invitation keeps its access.
            </p>
            {data.invitations.length === 0 ? (
              <p className="card-body u-mb-125">No invitations yet.</p>
            ) : (
              <div className="rows u-mb-125">
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
                        <span className="row-end">
                          <span className={`badge ${status.tone}`}>{status.label}</span>
                          {data.owner && !inv.revokedAt ? (
                            <RevokeInvitationButton invitationId={inv.id} />
                          ) : null}
                        </span>
                      </div>
                      <span className="muted u-fs-085">
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
              <p className="muted u-fs-085">
                Only a platform owner can invite or revoke pilot access.
              </p>
            )}
          </article>

          {data.unboundAccounts.length > 0 ? (
            <article className="card u-mb-150">
              <p className="card-kicker">Identity</p>
              <h2 className="card-title">Legacy Sign-In References</h2>
              <p className="card-body u-mb-100">
                This report tracks the older sign-in system. A Neon Auth account can appear here
                even when its current sign-in works. This list does not grant access or transfer
                account records.
              </p>
              <div className="rows">
                {data.unboundAccounts.map((a) => (
                  <div className="row" key={a.id}>
                    <span className="row-key" style={{ wordBreak: 'break-word' }}>
                      {a.email}
                    </span>
                    <span className="row-end">
                      <span className="muted u-fs-085">
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
