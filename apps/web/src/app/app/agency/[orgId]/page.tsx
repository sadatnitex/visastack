import {
  getOrganization,
  isActiveMember,
  isOrgAdmin,
  listApplicantsForOrganization,
  listAssignedMissionIds,
  listAssignmentsDetailed,
  listEvidenceRequestsForOrgDetailed,
  listIssuerVerificationsForDocument,
  listIssuerVerificationsForFact,
  listMissionDecisions,
  listMissionRequirementsForOrg,
  listMissionsForOrganization,
  listNotes,
  listOrgMemberships,
  listOrganizationInvitations,
  listSelectedEvidenceForOrg,
} from '@visastack/services';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  capabilityUnavailableMessage,
  getPlatformCapabilities,
} from '../../../../lib/capabilities';
import { profileField } from '../../../../lib/profile-fields';
import { withSession } from '../../../../lib/session';
import { InvitationRevokeButton } from './invitation-revoke-button';
import { AddMemberForm } from './member-form';
import { MemberToggleButton } from './member-toggle-button';
import { MissionCollaboration } from './mission-collaboration';
import { RequestEvidenceForm } from './request-evidence-form';

export const dynamic = 'force-dynamic';

const ORG_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING_VERIFICATION: { label: 'Pending verification', tone: 'badge-warning' },
  ACTIVE: { label: 'Active', tone: 'badge-success' },
  SUSPENDED: { label: 'Suspended', tone: 'badge-danger' },
  REJECTED: { label: 'Rejected', tone: 'badge-danger' },
  CLOSED: { label: 'Closed', tone: 'badge-neutral' },
};

const REQ_STATUS: Record<string, { label: string; tone: string }> = {
  OPEN: { label: 'Open', tone: 'badge-warning' },
  FULFILLED: { label: 'Fulfilled', tone: 'badge-success' },
  DECLINED: { label: 'Declined', tone: 'badge-neutral' },
};

export default async function OrgConsolePage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const capabilities = getPlatformCapabilities();

  const data = await withSession(async ({ db, accountId }) => {
    const org = await getOrganization(db, orgId);
    if (!org) return null;
    const admin = await isOrgAdmin(db, accountId, orgId);
    // Finding #31 (post-programme defect register): mission collaboration —
    // assignments, notes, requirements, and the reviewer decision workflow
    // recordMissionDecision itself authorizes — is NOT an admin-only
    // capability at the service layer (canReadMissionCollaboration checks
    // a COMMENT-or-MANAGE org grant; recordMissionDecision checks active
    // membership + assignment + grant, never isOrgAdmin). Any active
    // member, not just an OWNER/ADMIN, has standing to reach it.
    const member = admin || (await isActiveMember(db, accountId, orgId));
    if (!member) {
      return {
        org,
        admin: false,
        member: false,
        requests: [],
        members: [],
        invitations: [],
        applicants: [],
        missions: [],
        viewerAccountId: accountId,
      };
    }

    // Admin-only data: full membership roster, pending invitations,
    // org-wide evidence requests, and the applicant list the "Request
    // evidence" form targets, each gated by isOrgAdmin at the service
    // layer already (listOrgMemberships, listOrganizationInvitations,
    // listEvidenceRequestsForOrgDetailed), or only ever consumed by an
    // admin-only section of this page (applicants).
    const [requests, members, invitations, applicants, orgMissions, assignedMissionIds] =
      await Promise.all([
        admin ? listEvidenceRequestsForOrgDetailed(db, accountId, orgId) : Promise.resolve(null),
        admin ? listOrgMemberships(db, accountId, orgId) : Promise.resolve(null),
        admin
          ? listOrganizationInvitations(db, { actorAccountId: accountId, organizationId: orgId })
          : Promise.resolve(null),
        admin ? listApplicantsForOrganization(db, orgId) : Promise.resolve([]),
        listMissionsForOrganization(db, orgId),
        admin ? Promise.resolve(null) : listAssignedMissionIds(db, orgId, accountId),
      ]);
    const membersResolved = members?.ok ? members.value : [];
    const invitationsResolved = invitations?.ok
      ? invitations.value.filter((i) => i.status === 'PENDING')
      : [];
    // Codex review, PR-D2, round 1: listAssignmentsDetailed/listNotes/
    // listMissionRequirementsForOrg below only check the ORGANIZATION's
    // grant, never the individual caller's own assignment — correct for
    // an admin (who legitimately sees every mission the org can reach),
    // but a non-admin member must see only THEIR OWN assigned missions
    // (Build Spec §2: "Agency staff / reviewer ... Sees only assigned
    // applicants and missions"). Without this filter, any active member
    // could see every other member's assignments, note bodies, and
    // applicant names for missions they have no personal standing on.
    const visibleOrgMissions = admin
      ? orgMissions
      : orgMissions.filter((m) => assignedMissionIds?.has(m.missionId) ?? false);
    const missions = await Promise.all(
      visibleOrgMissions.map(async (mission) => {
        const [assignments, notes, requirements, decisions, selectedEvidence] = await Promise.all([
          listAssignmentsDetailed(db, orgId, mission.applicantId, mission.missionId),
          listNotes(db, orgId, mission.applicantId, mission.missionId),
          listMissionRequirementsForOrg(db, orgId, mission.missionId),
          listMissionDecisions(db, accountId, mission.missionId),
          listSelectedEvidenceForOrg(db, orgId, mission.missionId),
        ]);
        // EVI-05: an issuer confirmation is recorded against whatever a
        // requirement's evidence resolves to (fact or document), not
        // against the requirement directly, so it's looked up the same way
        // the write action resolves it (listSelectedEvidenceForOrg), then
        // tagged with the requirement id here for display grouping.
        const issuerVerifications = selectedEvidence.ok
          ? (
              await Promise.all(
                selectedEvidence.value.map(async (evidence) => {
                  const rows = evidence.factId
                    ? await listIssuerVerificationsForFact(db, evidence.factId)
                    : evidence.documentId
                      ? await listIssuerVerificationsForDocument(db, evidence.documentId)
                      : [];
                  return rows.map((v) => ({
                    id: v.id,
                    packRequirementId: evidence.packRequirementId,
                    issuerIdentity: v.issuerIdentity,
                    exactClaim: v.exactClaim,
                    response: v.response,
                    validUntil: v.validUntil.toISOString(),
                    expired: v.validUntil.getTime() <= Date.now(),
                  }));
                }),
              )
            ).flat()
          : [];
        return {
          ...mission,
          assignments,
          notes: notes.map((n) => ({
            id: n.id,
            body: n.body,
            createdAt: n.createdAt.toISOString(),
            visibility: n.visibility,
            // Author email resolution needs the full membership roster,
            // admin-only data (above) — a non-admin viewer correctly sees
            // "Unknown" here rather than gaining roster access through a
            // side door; the note body/date/requirement content itself is
            // unaffected.
            authorEmail:
              membersResolved.find((m) => m.accountId === n.authorAccountId)?.email ?? 'Unknown',
          })),
          requirements: requirements.ok
            ? requirements.value.map((r) => ({
                id: r.id,
                label:
                  r.kind === 'FIELD'
                    ? (profileField(r.fieldKey ?? '')?.label ?? r.fieldKey ?? '')
                    : (r.docType ?? ''),
              }))
            : [],
          // A non-admin, non-assigned-to-THIS-mission member correctly
          // gets [] here (listMissionDecisions refuses per-mission, not
          // per-org) — they still see every mission they ARE assigned to.
          decisions: decisions.ok
            ? decisions.value.map((d) => ({
                id: d.id,
                packRequirementId: d.packRequirementId,
                outcome: d.outcome,
                reason: d.reason,
                createdAt: d.createdAt.toISOString(),
              }))
            : [],
          issuerVerifications,
          viewerAssigned: assignments.some((a) => a.memberAccountId === accountId),
        };
      }),
    );
    return {
      org,
      admin,
      member: true,
      requests: requests?.ok ? requests.value : [],
      members: membersResolved,
      invitations: invitationsResolved,
      applicants,
      missions,
      viewerAccountId: accountId,
    };
  });

  if (!data) notFound();

  const badge = ORG_STATUS[data.org.status] ?? { label: data.org.status, tone: 'badge-neutral' };

  return (
    <section className="section container">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/app/agency" className="muted" style={{ fontSize: '0.9rem' }}>
          ← Organizations
        </Link>
      </div>
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Organization</span>
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {data.org.name}
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Collaboration console
          </p>
        </div>
        <span className={`badge ${badge.tone}`}>{badge.label}</span>
      </div>

      {!data.member ? (
        <article className="card">
          <p className="card-body">
            You don't have a role in this organization. Ask an owner or admin to add you as a
            member.
          </p>
        </article>
      ) : (
        <>
          {capabilities.agencyCollaboration !== 'available' ? (
            <div className="notice notice-warn" style={{ marginBottom: '1.5rem' }}>
              {capabilityUnavailableMessage('agencyCollaboration')}
            </div>
          ) : null}

          {!data.admin ? (
            <article className="card" style={{ marginBottom: '1.5rem' }}>
              <p className="card-body">
                You're a member of this organization but not an administrator. Requesting evidence,
                bulk export, and member management are admin-only — you can still collaborate on
                missions you're assigned to below.
              </p>
            </article>
          ) : null}

          {data.admin ? (
            <article className="card" style={{ marginBottom: '1.5rem' }}>
              <p className="card-kicker">Case inbox</p>
              <h2 className="card-title">What needs attention</h2>
              {data.missions.length === 0 ? (
                <p className="card-body">
                  No cases are reachable yet — an applicant must grant this organization access to a
                  specific mission.
                </p>
              ) : (
                <div className="rows" style={{ marginTop: '0.5rem' }}>
                  {data.missions
                    .map((mission) => {
                      const openRequests = data.requests.filter(
                        (r) => r.applicantId === mission.applicantId && r.status === 'OPEN',
                      ).length;
                      const assignedToMe = mission.assignments.some(
                        (a) => a.memberAccountId === data.viewerAccountId,
                      );
                      return { mission, openRequests, assignedToMe };
                    })
                    // Cases needing action float to the top: unassigned or open
                    // requests first, then everything else.
                    .sort((a, b) => {
                      const weight = (x: typeof a) =>
                        (x.mission.assignments.length === 0 ? 2 : 0) + (x.openRequests > 0 ? 1 : 0);
                      return weight(b) - weight(a);
                    })
                    .map(({ mission, openRequests, assignedToMe }) => (
                      <div
                        className="row"
                        key={mission.missionId}
                        style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.3rem' }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: '0.75rem',
                          }}
                        >
                          <span className="row-key">
                            {mission.applicantName} · {mission.title}
                          </span>
                          <span style={{ display: 'flex', gap: '0.4rem' }}>
                            {assignedToMe ? (
                              <span className="badge badge-neutral">Assigned to you</span>
                            ) : null}
                            {mission.assignments.length === 0 ? (
                              <span className="badge badge-warning">Needs assignment</span>
                            ) : null}
                            {openRequests > 0 ? (
                              <span className="badge badge-warning">
                                {openRequests} open request{openRequests === 1 ? '' : 's'}
                              </span>
                            ) : null}
                          </span>
                        </div>
                        <span className="muted" style={{ fontSize: '0.8rem' }}>
                          {mission.assignments.length > 0
                            ? `Assigned: ${mission.assignments.map((a) => a.memberEmail).join(', ')}`
                            : 'Unassigned'}
                          {mission.notes.length > 0 ? ` · ${mission.notes.length} note(s)` : ''}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </article>
          ) : null}

          {data.admin ? (
            <div className="grid">
              <article className="card">
                <p className="card-kicker">Collect</p>
                <h2 className="card-title">Request evidence</h2>
                <p className="card-body" style={{ marginBottom: '1.25rem' }}>
                  Ask an applicant for a specific field or document. They decide whether to fulfil
                  it.
                </p>
                <RequestEvidenceForm
                  organizationId={orgId}
                  applicants={data.applicants}
                  missions={data.missions.map((m) => ({
                    missionId: m.missionId,
                    title: m.title,
                    applicantName: m.applicantName,
                  }))}
                />
              </article>

              <article className="card">
                <p className="card-kicker">Export</p>
                <h2 className="card-title">Bulk export</h2>
                <p className="card-body" style={{ marginBottom: '1.25rem' }}>
                  Download the profiles of every applicant who granted this organization an accepted
                  export grant. Each applicant is re-checked by the policy engine at export time.
                </p>
                {capabilities.bulkExport === 'available' ? (
                  <a
                    href={`/app/agency/${orgId}/export?purpose=agency_review`}
                    className="btn btn-primary"
                    download
                  >
                    Download bulk export
                  </a>
                ) : (
                  <>
                    <button type="button" className="btn btn-primary" disabled>
                      Download bulk export
                    </button>
                    <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.6rem' }}>
                      {capabilityUnavailableMessage('bulkExport')}
                    </p>
                  </>
                )}
              </article>
            </div>
          ) : null}

          {data.admin ? (
            <article className="card" style={{ marginTop: '1.5rem' }}>
              <p className="card-kicker">Team</p>
              <h2 className="card-title">Members</h2>
              <p className="card-body" style={{ marginBottom: '1.25rem' }}>
                Membership is organizational bookkeeping — it never grants access to an applicant's
                records on its own. Access is always an accepted grant.
              </p>
              {data.members.length > 0 ? (
                <div className="rows" style={{ marginBottom: '1.5rem' }}>
                  {data.members.map((m) => (
                    <div className="row" key={m.membershipId}>
                      <span className="row-key">
                        {m.email}
                        <span
                          className="muted"
                          style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}
                        >
                          {m.role}
                        </span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
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
                <div className="rows" style={{ marginBottom: '1.5rem' }}>
                  {data.invitations.map((invitation) => (
                    <div className="row" key={invitation.id}>
                      <span className="row-key">
                        {invitation.email}
                        <span
                          className="muted"
                          style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}
                        >
                          {invitation.role}
                        </span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span className="badge badge-warning">
                          Invited &middot; expires{' '}
                          {new Date(invitation.expiresAt).toLocaleDateString()}
                        </span>
                        <InvitationRevokeButton
                          organizationId={orgId}
                          invitationId={invitation.id}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              <AddMemberForm organizationId={orgId} />
            </article>
          ) : null}

          <article className="card" style={{ marginTop: '1.5rem' }}>
            <p className="card-kicker">Collaborate</p>
            <h2 className="card-title">Missions</h2>
            <p className="card-body" style={{ marginBottom: '1.25rem' }}>
              {data.admin
                ? 'Assign a team member and leave case notes on any mission this organization has a grant for.'
                : "Leave case notes and record decisions on missions you're assigned to."}
            </p>
            {data.missions.length === 0 ? (
              <p className="card-body">
                {data.admin
                  ? 'No missions are reachable yet — an applicant must grant this organization access to a specific mission.'
                  : "You aren't assigned to any missions yet — ask an admin to assign you to a case."}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {data.missions.map((mission) => (
                  <MissionCollaboration
                    key={mission.missionId}
                    organizationId={orgId}
                    missionId={mission.missionId}
                    applicantId={mission.applicantId}
                    title={mission.title}
                    applicantName={mission.applicantName}
                    members={data.members.map((m) => ({ accountId: m.accountId, email: m.email }))}
                    assignments={mission.assignments}
                    notes={mission.notes}
                    requirements={mission.requirements}
                    decisions={mission.decisions}
                    issuerVerifications={mission.issuerVerifications}
                    viewerAssigned={mission.viewerAssigned}
                  />
                ))}
              </div>
            )}
          </article>

          {data.admin ? (
            <article className="card" style={{ marginTop: '1.5rem' }}>
              <p className="card-kicker">Activity</p>
              <h2 className="card-title">Evidence requests</h2>
              {data.requests.length === 0 ? (
                <p className="card-body">No evidence requests raised yet.</p>
              ) : (
                <div className="rows" style={{ marginTop: '0.5rem' }}>
                  {data.requests.map((req) => {
                    const rb = REQ_STATUS[req.status] ?? {
                      label: req.status,
                      tone: 'badge-neutral',
                    };
                    const target =
                      req.kind === 'FIELD'
                        ? ((req.fieldKey ? profileField(req.fieldKey)?.label : undefined) ??
                          req.fieldKey)
                        : req.docType;
                    return (
                      <div
                        className="row"
                        key={req.id}
                        style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.2rem' }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: '0.75rem',
                          }}
                        >
                          <span className="row-key">
                            {req.kind === 'FIELD' ? 'Field' : 'Document'}:{' '}
                            {target ?? '(unspecified)'}
                          </span>
                          <span className={`badge ${rb.tone}`}>{rb.label}</span>
                        </div>
                        <span className="muted" style={{ fontSize: '0.8rem' }}>
                          {req.applicantName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </article>
          ) : null}
        </>
      )}
    </section>
  );
}
