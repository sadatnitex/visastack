import { agencyCollectionRequestsEnabled } from '@visastack/services';
import type { Metadata } from 'next';
import { Icon } from '../../../../../components/icons';
import { ExpandableSection } from '../../../../../components/ui-lift/expandable-section';
import { appAgencyCatalog } from '../../../../../i18n/app-agency';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
import { membershipRoleLabel } from '../../../../../lib/labels';
import { withSession } from '../../../../../lib/session';
import { loadMembers, loadOrgAccess, loadPendingTeamInvitations } from '../console-data';
import { InvitationRevokeButton } from '../invitation-revoke-button';
import { AddMemberForm } from '../member-form';
import { MemberToggleButton } from '../member-toggle-button';
import { FocusFirstFieldOnOpen } from '../u8-fold-focus';
import { AgencyRow, AgencyRows, InitialsPicture } from '../u8-rows';
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

  const canRequestToggle = (m: { active: boolean; role: string }) =>
    m.active && m.role !== 'OWNER' && m.role !== 'ADMIN';

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
        <AgencyRows id="team-members" ariaLabel={t('appAgency.appAgencyOrgidTeamPage.members')}>
          {data.members.map((m) => (
            <AgencyRow
              key={m.membershipId}
              title={m.email}
              picture={<InitialsPicture name={m.email} />}
              chip={{ label: membershipRoleLabel(m.role), tone: m.active ? 'info' : 'neutral' }}
              meta={
                <>
                  {m.active
                    ? t.node('appAgency.appAgencyOrgidTeamPage.active')
                    : t.node('appAgency.appAgencyOrgidTeamPage.inactive')}
                  {documentRequests && m.mayRequestDocuments
                    ? ` · ${t('appAgency.appAgencyOrgidTeamPage.mayRequestDocuments')}`
                    : ''}
                </>
              }
            >
              {m.role !== 'OWNER' ? (
                <div className="u8-body-actions">
                  {documentRequests && canRequestToggle(m) ? (
                    <DocumentRequestToggle
                      organizationId={orgId}
                      membershipId={m.membershipId}
                      allowed={m.mayRequestDocuments}
                      memberLabel={m.email}
                    />
                  ) : null}
                  <MemberToggleButton
                    organizationId={orgId}
                    membershipId={m.membershipId}
                    active={m.active}
                  />
                </div>
              ) : undefined}
            </AgencyRow>
          ))}
        </AgencyRows>
      ) : null}
      {data.invitations.length > 0 ? (
        <AgencyRows id="team-invitations">
          {data.invitations.map((invitation) => (
            <AgencyRow
              key={invitation.id}
              title={invitation.email}
              picture={<InitialsPicture name={invitation.email} />}
              chip={{
                label: t.node(
                  'appAgency.appAgencyOrgidClientsPage.invitedExpiresFormattimestampdate',
                  { formatTimestampDate: formatTimestampDate(invitation.expiresAt, locale) },
                ),
                tone: 'warning',
              }}
              meta={membershipRoleLabel(invitation.role)}
            >
              <div className="u8-body-actions">
                <InvitationRevokeButton organizationId={orgId} invitationId={invitation.id} />
              </div>
            </AgencyRow>
          ))}
        </AgencyRows>
      ) : null}
      <ExpandableSection
        className="u8-row u8-add"
        title={t('appAgency.appAgencyOrgidU8.addMember')}
        picture={<Icon name="plus" size={20} />}
        headingLevel={3}
        remember
      >
        <FocusFirstFieldOnOpen />
        <AddMemberForm
          organizationId={orgId}
          pendingInvitationIds={data.invitations.map((invitation) => invitation.id)}
        />
      </ExpandableSection>
    </article>
  );
}
