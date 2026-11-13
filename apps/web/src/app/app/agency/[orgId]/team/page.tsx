import { agencyCollectionRequestsEnabled } from '@visastack/services';
import type { Metadata } from 'next';
import { appAgencyCatalog } from '../../../../../i18n/app-agency';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
import { membershipRoleLabel } from '../../../../../lib/labels';
import { withSession } from '../../../../../lib/session';
import { loadMembers, loadOrgAccess, loadPendingTeamInvitations } from '../console-data';
import { InvitationRevokeButton } from '../invitation-revoke-button';
import { AddMemberForm } from '../member-form';
import { MemberToggleButton } from '../member-toggle-button';
import { DocumentRequestToggle } from './document-request-toggle';

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
  const locale = await primeLocale();
  const t = getServerT(appAgencyCatalog);
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
  // UMPE G3: the permission exists only for document requests, so only while they are on.
  const documentRequests = agencyCollectionRequestsEnabled();

  if (!data.admin) {
    return (
      <article className="card">
        <p className="card-body">
          {t.node('appAgency.appAgencyOrgidTeamPage.managingTheTeamIsLimitedTo')}
        </p>
      </article>
    );
  }

  return (
    <article className="card">
      <p className="card-kicker">{t.node('appAgency.appAgencyOrgidTeamPage.team')}</p>
      <h2 className="card-title">{t.node('appAgency.appAgencyOrgidTeamPage.members')}</h2>
      <p className="card-body u-mb-125">
        {t.node('appAgency.appAgencyOrgidTeamPage.membershipIsOrganizationalBookkeepingItNever')}
      </p>
      {documentRequests ? (
        <p className="card-body u-mb-125 muted">
          {t.node('appAgency.appAgencyOrgidTeamPage.allowDocumentRequestsLetsAMember')}
        </p>
      ) : null}
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
                {documentRequests && m.mayRequestDocuments ? (
                  <span className="muted member-permission-note">
                    {t.node('appAgency.appAgencyOrgidTeamPage.mayRequestDocuments')}
                  </span>
                ) : null}
              </span>
              <span className="row-end">
                <span className={`badge ${m.active ? 'badge-success' : 'badge-neutral'}`}>
                  {m.active
                    ? t.node('appAgency.appAgencyOrgidTeamPage.active')
                    : t.node('appAgency.appAgencyOrgidTeamPage.inactive')}
                </span>
                {documentRequests && m.active && m.role !== 'OWNER' && m.role !== 'ADMIN' ? (
                  <DocumentRequestToggle
                    organizationId={orgId}
                    membershipId={m.membershipId}
                    allowed={m.mayRequestDocuments}
                    memberLabel={m.email}
                  />
                ) : null}
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
                  {t.node('appAgency.appAgencyOrgidClientsPage.invitedExpiresFormattimestampdate', {
                    formatTimestampDate: formatTimestampDate(invitation.expiresAt, locale),
                  })}
                </span>
                <InvitationRevokeButton organizationId={orgId} invitationId={invitation.id} />
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <AddMemberForm
        organizationId={orgId}
        pendingInvitationIds={data.invitations.map((invitation) => invitation.id)}
      />
    </article>
  );
}
