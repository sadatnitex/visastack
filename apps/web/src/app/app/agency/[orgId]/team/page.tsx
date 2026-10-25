import type { Metadata } from 'next';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { membershipRoleLabel } from '../../../../../lib/labels';
import { withSession } from '../../../../../lib/session';
import { loadMembers, loadOrgAccess, loadPendingTeamInvitations } from '../console-data';
import { InvitationRevokeButton } from '../invitation-revoke-button';
import { AddMemberForm } from '../member-form';
import { MemberToggleButton } from '../member-toggle-button';

export const metadata: Metadata = { title: 'Agency Team' };

export const dynamic = 'force-dynamic';

/**
 * Team: who belongs to this organization, who has been invited, and how to add
 * someone (Commercial V1 Part 9 UX-01). Administrator work: anyone else gets a
 * plain explanation, and the roster is not even read for them.
 */
export default async function AgencyTeamPage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const data = await withSession(async ({ db, accountId }) => {
    const access = await loadOrgAccess(db, accountId, orgId);
    if (!access?.member) return null;
    if (!access.admin) return { admin: false as const };
    const [members, invitations] = await Promise.all([
      loadMembers(db, accountId, orgId, access),
      loadPendingTeamInvitations(db, accountId, orgId, access),
    ]);
    return { admin: true as const, members, invitations };
  });
  if (!data) return null;

  if (!data.admin) {
    return (
      <article className="card">
        <p className="card-body">
          Managing the team is limited to this organization's owners and admins.
        </p>
      </article>
    );
  }

  return (
    <article className="card">
      <p className="card-kicker">Team</p>
      <h2 className="card-title">Members</h2>
      <p className="card-body u-mb-125">
        Membership is organizational bookkeeping - it never grants access to an applicant's records
        on its own. Access is always an accepted grant.
      </p>
      {data.members.length > 0 ? (
        <div className="rows u-mb-150">
          {data.members.map((m) => (
            <div className="row" key={m.membershipId}>
              <span className="row-key">
                {m.email}
                <span
                  className="muted"
                  style={{ fontSize: 'var(--text-small)', marginLeft: '0.5rem' }}
                >
                  {membershipRoleLabel(m.role)}
                </span>
              </span>
              <span className="row-end">
                <span className={`badge ${m.active ? 'badge-success' : 'badge-neutral'}`}>
                  {m.active ? 'Active' : 'Inactive'}
                </span>
                {m.role !== 'OWNER' ? (
                  <MemberToggleButton
                    organizationId={orgId}
                    membershipId={m.membershipId}
                    active={m.active}
                  />
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {data.invitations.length > 0 ? (
        <div className="rows u-mb-150">
          {data.invitations.map((invitation) => (
            <div className="row" key={invitation.id}>
              <span className="row-key">
                {invitation.email}
                <span
                  className="muted"
                  style={{ fontSize: 'var(--text-small)', marginLeft: '0.5rem' }}
                >
                  {membershipRoleLabel(invitation.role)}
                </span>
              </span>
              <span className="row-end">
                <span className="badge badge-warning">
                  Invited &middot; expires {formatTimestampDate(invitation.expiresAt)}
                </span>
                <InvitationRevokeButton organizationId={orgId} invitationId={invitation.id} />
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <AddMemberForm organizationId={orgId} />
    </article>
  );
}
