import {
  computeReadiness,
  getOrganization,
  getOrganizationBrandingForDisplay,
  isActiveMember,
  isOrgAdmin,
  listApplicantsForOrganization,
  listAppointmentsForOrg,
  listAssignmentsDetailed,
  listClientInvitations,
  listEvidenceRequestsForOrgDetailed,
  listIssuerVerificationsForDocument,
  listIssuerVerificationsForFact,
  listMissionDecisions,
  listMissionRequirementsForOrg,
  listNotes,
  listOrgMemberships,
  listOrganizationInvitations,
  listSelectedEvidenceForOrg,
  listTasksForOrg,
  listUnassignedActiveMissions,
  listVisibleMissionsForMember,
} from '@visastack/services';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  capabilityUnavailableMessage,
  getPlatformCapabilities,
} from '../../../../lib/capabilities';
import { profileField } from '../../../../lib/profile-fields';
import { withSession } from '../../../../lib/session';
import { createStorage } from '../../../../lib/storage';
import { BrandingForm } from './branding-form';
import { CaseSearchForm, STAGE_LABELS } from './case-search-form';
import { ClientInvitationForm } from './client-invitation-form';
import { ClientInvitationRevokeButton } from './client-invitation-revoke-button';
import { EvidenceRequestActions } from './evidence-request-actions';
import { InvitationRevokeButton } from './invitation-revoke-button';
import { AddMemberForm } from './member-form';
import { MemberToggleButton } from './member-toggle-button';
import { MissionCollaboration } from './mission-collaboration';
import { OrgBrandingHeader } from './org-branding-header';
import { RequestEvidenceForm } from './request-evidence-form';
import { RequireDifferentReviewerToggle } from './require-different-reviewer-toggle';

export const dynamic = 'force-dynamic';

const ORG_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING_VERIFICATION: { label: 'Pending verification', tone: 'badge-warning' },
  ACTIVE: { label: 'Active', tone: 'badge-success' },
  SUSPENDED: { label: 'Suspended', tone: 'badge-danger' },
  REJECTED: { label: 'Rejected', tone: 'badge-danger' },
  CLOSED: { label: 'Closed', tone: 'badge-neutral' },
};

// A case counts as "approaching" a date within this many days -- the same
// horizon the rest of this product has no existing precedent for, chosen as
// a reasonable default rather than derived from anything (Part 5's Expiry
// Centre, NTF-01, is the eventual home for a configurable version of this).
const APPROACHING_DAYS = 14;

/** The soonest of a case's target deadline / travel start date that's still in the future and within APPROACHING_DAYS, or null. */
function nextApproachingDate(
  targetDeadline: string | null,
  travelStartDate: string | null,
): { readonly label: string; readonly date: string } | null {
  const now = Date.now();
  const horizon = now + APPROACHING_DAYS * 24 * 60 * 60 * 1000;
  const candidates: { label: string; date: string; ms: number }[] = [];
  if (targetDeadline) {
    const ms = new Date(targetDeadline).getTime();
    if (ms >= now && ms <= horizon)
      candidates.push({ label: 'Deadline', date: targetDeadline, ms });
  }
  if (travelStartDate) {
    const ms = new Date(travelStartDate).getTime();
    if (ms >= now && ms <= horizon) candidates.push({ label: 'Travel', date: travelStartDate, ms });
  }
  candidates.sort((a, b) => a.ms - b.ms);
  return candidates[0] ?? null;
}

const REQ_STATUS: Record<string, { label: string; tone: string }> = {
  OPEN: { label: 'Open', tone: 'badge-warning' },
  RECEIVED: { label: 'Submitted', tone: 'badge-neutral' },
  UNDER_REVIEW: { label: 'Under review', tone: 'badge-neutral' },
  ACCEPTED: { label: 'Accepted', tone: 'badge-success' },
  NEEDS_REPLACEMENT: { label: 'Needs replacement', tone: 'badge-warning' },
  CANCELLED: { label: 'Cancelled', tone: 'badge-neutral' },
  // Legacy: no longer written, but a pre-Part-4 request row may still hold one.
  FULFILLED: { label: 'Fulfilled', tone: 'badge-success' },
  DECLINED: { label: 'Declined', tone: 'badge-neutral' },
};

const EVIDENCE_DECIDABLE_STATUSES = new Set(['RECEIVED', 'UNDER_REVIEW']);

export default async function OrgConsolePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ orgId: string }>;
  readonly searchParams: Promise<{
    readonly q?: string;
    readonly stage?: string;
    readonly destination?: string;
    readonly assignee?: string;
  }>;
}) {
  const { orgId } = await params;
  const {
    q: rawQuery = '',
    stage: stageFilter = '',
    destination: rawDestinationFilter = '',
    assignee: assigneeFilter = '',
  } = await searchParams;
  const capabilities = getPlatformCapabilities();

  const data = await withSession(async ({ db, accountId }) => {
    const org = await getOrganization(db, orgId);
    if (!org) return null;
    // Not member-gated: the org name already renders unconditionally in the
    // header below for anyone who can reach this page by URL, and branding
    // (name/logo/accent color) carries no more sensitivity than that.
    const branding = await getOrganizationBrandingForDisplay(db, createStorage(db), orgId);
    const adminCheck = await isOrgAdmin(db, accountId, orgId);
    // Finding #31 (post-programme defect register): mission collaboration —
    // assignments, notes, requirements, and the reviewer decision workflow
    // recordMissionDecision itself authorizes — is NOT an admin-only
    // capability at the service layer (canReadMissionCollaboration checks
    // a COMMENT-or-MANAGE org grant; recordMissionDecision checks active
    // membership + assignment + grant, never isOrgAdmin). Any active
    // member, not just an OWNER/ADMIN, has standing to reach it.
    const member = adminCheck || (await isActiveMember(db, accountId, orgId));
    if (!member) {
      return {
        org,
        branding,
        admin: false,
        member: false,
        requests: [],
        members: [],
        invitations: [],
        clientInvitations: [],
        applicants: [],
        missions: [],
        unassignedQueue: [],
        viewerAccountId: accountId,
      };
    }

    // Admin-only data: full membership roster, pending invitations,
    // org-wide evidence requests, and the applicant list the "Request
    // evidence" form targets, each gated by isOrgAdmin at the service
    // layer already (listOrgMemberships, listOrganizationInvitations,
    // listClientInvitations, listEvidenceRequestsForOrgDetailed), or only
    // ever consumed by an admin-only section of this page (applicants).
    const [requests, members, invitations, clientInvitationsResult, applicants, visible] =
      await Promise.all([
        adminCheck
          ? listEvidenceRequestsForOrgDetailed(db, accountId, orgId)
          : Promise.resolve(null),
        adminCheck ? listOrgMemberships(db, accountId, orgId) : Promise.resolve(null),
        adminCheck
          ? listOrganizationInvitations(db, { actorAccountId: accountId, organizationId: orgId })
          : Promise.resolve(null),
        adminCheck
          ? listClientInvitations(db, { actorAccountId: accountId, organizationId: orgId })
          : Promise.resolve(null),
        adminCheck ? listApplicantsForOrganization(db, orgId) : Promise.resolve([]),
        // CAS-02: the single source of truth for "which cases can this
        // actor see" (admin-wide vs assigned-only), so the search below
        // and this default listing never diverge in what they authorize.
        listVisibleMissionsForMember(db, orgId, accountId),
      ]);
    const admin = visible.admin;
    const membersResolved = members?.ok ? members.value : [];
    const invitationsResolved = invitations?.ok
      ? invitations.value.filter((i) => i.status === 'PENDING')
      : [];
    const clientInvitationsResolved = clientInvitationsResult?.ok
      ? clientInvitationsResult.value.filter((i) => i.status === 'PENDING')
      : [];
    const missions = await Promise.all(
      visible.missions.map(async (mission) => {
        const [
          assignments,
          notes,
          requirements,
          decisions,
          selectedEvidence,
          tasks,
          appointments,
          readiness,
        ] = await Promise.all([
          listAssignmentsDetailed(db, orgId, mission.applicantId, mission.missionId),
          listNotes(db, orgId, mission.applicantId, mission.missionId),
          listMissionRequirementsForOrg(db, orgId, mission.missionId),
          listMissionDecisions(db, accountId, mission.missionId),
          listSelectedEvidenceForOrg(db, orgId, mission.missionId),
          listTasksForOrg(db, orgId, mission.applicantId, mission.missionId),
          listAppointmentsForOrg(db, orgId, mission.applicantId, mission.missionId),
          // Manual-mode cases never carry an official readiness claim
          // (CAS-01 §8), even if a pack happens to still be attached;
          // a case with no pack attached at all has nothing to compute.
          !mission.manualMode && mission.packVersionId
            ? computeReadiness(db, mission.missionId)
            : Promise.resolve(null),
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
          tasks: tasks.map((t) => ({
            id: t.id,
            description: t.description,
            status: t.status,
            priority: t.priority,
            assigneeAccountId: t.assigneeAccountId,
            dueDate: t.dueDate ? t.dueDate.toISOString() : null,
          })),
          appointments: appointments.map((a) => ({
            id: a.id,
            title: a.title,
            localDateTime: a.localDateTime.toISOString(),
            timezone: a.timezone,
            place: a.place,
            channel: a.channel,
            status: a.status,
          })),
          readiness: readiness?.ok ? readiness.value : null,
        };
      }),
    );
    // Commercial V1 Part 4 §11's "reassignment queue": every mission this
    // org can still act on but that currently has nobody assigned at all,
    // most often because `setMembershipActive`'s deactivation path
    // auto-unassigned a departed member's sole case. Admin-only surfacing
    // (matches assignMember/unassignMember's own admin-only bar), though the
    // read itself carries no more than `listMissionsForOrganization` already
    // exposes to this org.
    const unassignedQueue = admin ? await listUnassignedActiveMissions(db, orgId) : [];
    return {
      org,
      branding,
      admin,
      member: true,
      requests: requests?.ok ? requests.value : [],
      members: membersResolved,
      invitations: invitationsResolved,
      clientInvitations: clientInvitationsResolved,
      applicants,
      missions,
      unassignedQueue,
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
          <OrgBrandingHeader branding={data.branding} />
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {data.org.name}
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Collaboration console
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {data.member ? (
            <Link href={`/app/agency/${orgId}/plan`} className="pill">
              Plan &amp; usage
            </Link>
          ) : null}
          <span className={`badge ${badge.tone}`}>{badge.label}</span>
        </div>
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

          <article className="card" style={{ marginBottom: '1.5rem' }}>
            <p className="card-kicker">Case inbox</p>
            <h2 className="card-title">What needs attention</h2>
            <p className="card-body" style={{ marginBottom: '1rem' }}>
              Search only looks at cases you're already authorized to see below - never a wider,
              unscoped lookup. There's no passport-number or wallet-content search here; only case
              metadata already shown in this console.
            </p>
            <CaseSearchForm
              orgId={orgId}
              members={data.members.map((m) => ({ accountId: m.accountId, email: m.email }))}
              query={rawQuery}
              stage={stageFilter}
              destination={rawDestinationFilter}
              assignee={assigneeFilter}
            />
            {data.missions.length === 0 ? (
              <p className="card-body" style={{ marginTop: '1rem' }}>
                {data.admin
                  ? 'No cases are reachable yet - an applicant must grant this organization access to a specific mission.'
                  : "You aren't assigned to any cases yet - ask an admin to assign you to one."}
              </p>
            ) : (
              (() => {
                const q = rawQuery.trim().toLowerCase();
                const destinationQuery = rawDestinationFilter.trim().toLowerCase();
                const searched = data.missions.filter((mission) => {
                  if (q.length > 0) {
                    const haystack =
                      `${mission.applicantName} ${mission.title} ${mission.missionId}`.toLowerCase();
                    if (!haystack.includes(q)) return false;
                  }
                  if (stageFilter.length > 0 && mission.state !== stageFilter) return false;
                  if (
                    destinationQuery.length > 0 &&
                    !(mission.destination ?? '').toLowerCase().includes(destinationQuery)
                  ) {
                    return false;
                  }
                  if (
                    assigneeFilter.length > 0 &&
                    !mission.assignments.some((a) => a.memberAccountId === assigneeFilter)
                  ) {
                    return false;
                  }
                  return true;
                });
                if (searched.length === 0) {
                  return (
                    <p className="card-body" style={{ marginTop: '1rem' }}>
                      No cases match that search.
                    </p>
                  );
                }
                return (
                  <div className="rows" style={{ marginTop: '1rem' }}>
                    {searched
                      .map((mission) => {
                        const openRequests = data.requests.filter(
                          (r) => r.applicantId === mission.applicantId && r.status === 'OPEN',
                        ).length;
                        // "Review issues": evidence a reviewer already looked
                        // at and sent back for replacement. A separate, older
                        // decision mechanism (recordMissionDecision/CAS-06's
                        // ledger note) also produces REJECTED outcomes; not
                        // folded in here, same as openRequests' own scope.
                        const reviewIssues = data.requests.filter(
                          (r) =>
                            r.applicantId === mission.applicantId &&
                            r.status === 'NEEDS_REPLACEMENT',
                        ).length;
                        const overdueTasks = mission.tasks.filter(
                          (t) =>
                            t.status === 'OPEN' &&
                            t.dueDate &&
                            t.dueDate < new Date().toISOString(),
                        ).length;
                        const approaching = nextApproachingDate(
                          mission.targetDeadline,
                          mission.travelStartDate,
                        );
                        const assignedToMe = mission.assignments.some(
                          (a) => a.memberAccountId === data.viewerAccountId,
                        );
                        return {
                          mission,
                          openRequests,
                          reviewIssues,
                          overdueTasks,
                          approaching,
                          assignedToMe,
                        };
                      })
                      // Cases needing action float to the top.
                      .sort((a, b) => {
                        const weight = (x: typeof a) =>
                          (x.mission.assignments.length === 0 ? 2 : 0) +
                          (x.openRequests > 0 ? 1 : 0) +
                          (x.reviewIssues > 0 ? 1 : 0) +
                          (x.overdueTasks > 0 ? 1 : 0) +
                          (x.approaching ? 1 : 0);
                        return weight(b) - weight(a);
                      })
                      .map(
                        ({
                          mission,
                          openRequests,
                          reviewIssues,
                          overdueTasks,
                          approaching,
                          assignedToMe,
                        }) => (
                          <div
                            className="row"
                            key={mission.missionId}
                            style={{
                              flexDirection: 'column',
                              alignItems: 'stretch',
                              gap: '0.3rem',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: '0.75rem',
                                flexWrap: 'wrap',
                              }}
                            >
                              <span className="row-key">
                                <Link href={`/app/mission/${mission.missionId}`}>
                                  {mission.applicantName} · {mission.title}
                                </Link>
                              </span>
                              <span style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
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
                                {reviewIssues > 0 ? (
                                  <span className="badge badge-warning">
                                    {reviewIssues} needs replacement
                                  </span>
                                ) : null}
                                {overdueTasks > 0 ? (
                                  <span className="badge badge-danger">
                                    {overdueTasks} overdue task{overdueTasks === 1 ? '' : 's'}
                                  </span>
                                ) : null}
                                {approaching ? (
                                  <span className="badge badge-warning">
                                    {approaching.label}{' '}
                                    {new Date(approaching.date).toLocaleDateString()}
                                  </span>
                                ) : null}
                                <span
                                  className={`badge ${mission.manualMode ? 'badge-warning' : mission.readiness?.ready ? 'badge-success' : 'badge-neutral'}`}
                                >
                                  {mission.manualMode
                                    ? 'Manual mode'
                                    : !mission.packVersionId
                                      ? 'No pack attached'
                                      : mission.readiness
                                        ? mission.readiness.ready
                                          ? 'Ready'
                                          : `${mission.readiness.requiredCount - mission.readiness.satisfiedRequired} missing`
                                        : 'Readiness unavailable'}
                                </span>
                              </span>
                            </div>
                            <span className="muted" style={{ fontSize: '0.8rem' }}>
                              {STAGE_LABELS[mission.state] ?? mission.state}
                              {' · '}
                              {mission.assignments.length > 0
                                ? `Assigned: ${mission.assignments.map((a) => a.memberEmail).join(', ')}`
                                : 'Unassigned'}
                              {mission.notes.length > 0 ? ` · ${mission.notes.length} note(s)` : ''}
                              {mission.destination ? ` · ${mission.destination}` : ''}
                              {/* Acknowledgement (traveller final sign-off) isn't a built feature yet
                                (Part 7, TRU-02); shown as an honest placeholder, never a fabricated status. */}
                              {' · Acknowledgement: not yet tracked'}
                            </span>
                          </div>
                        ),
                      )}
                  </div>
                );
              })()
            )}
          </article>

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
              <p className="card-kicker">Settings</p>
              <h2 className="card-title">Review policy</h2>
              <div className="row">
                <span className="row-key" style={{ maxWidth: '32rem' }}>
                  Require a different reviewer
                  <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>
                    When on, whoever raised an evidence request cannot also accept it or ask for a
                    replacement; a different team member must. Off by default.
                  </span>
                </span>
                <RequireDifferentReviewerToggle
                  organizationId={orgId}
                  required={data.org.requireDifferentReviewer}
                />
              </div>
            </article>
          ) : null}

          {data.admin ? (
            <article className="card" style={{ marginTop: '1.5rem' }}>
              <p className="card-kicker">Settings</p>
              <h2 className="card-title">Branding</h2>
              <p className="card-body" style={{ marginBottom: '1.25rem' }}>
                Approved logo, agency name, and one accessible accent color -- shown on this console
                and on invitations. "Powered by VisaStack" always stays alongside it, and this
                organization's branding never appears in another organization's workspace.
              </p>
              <BrandingForm
                organizationId={orgId}
                name={data.org.name}
                accentColor={data.org.accentColor}
                logoUrl={data.branding?.logoUrl ?? null}
              />
            </article>
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

          {data.admin ? (
            <article className="card" style={{ marginTop: '1.5rem' }}>
              <p className="card-kicker">Intake</p>
              <h2 className="card-title">Clients</h2>
              <p className="card-body" style={{ marginBottom: '1.25rem' }}>
                Invite a traveller as a new client. They alone choose which of their own applicant
                profiles the resulting case attaches to, and their acceptance is what actually
                grants this organization access, never the invitation itself.
              </p>
              {data.clientInvitations.length > 0 ? (
                <div className="rows" style={{ marginBottom: '1.5rem' }}>
                  {data.clientInvitations.map((invitation) => (
                    <div className="row" key={invitation.id}>
                      <span className="row-key">
                        {invitation.displayName}
                        <span
                          className="muted"
                          style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}
                        >
                          {invitation.contactDestination}
                        </span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span className="badge badge-warning">
                          Invited &middot; expires{' '}
                          {new Date(invitation.expiresAt).toLocaleDateString()}
                        </span>
                        <ClientInvitationRevokeButton
                          organizationId={orgId}
                          invitationId={invitation.id}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              <ClientInvitationForm
                organizationId={orgId}
                members={data.members.map((m) => ({
                  accountId: m.accountId,
                  email: m.email,
                  active: m.active,
                }))}
              />
            </article>
          ) : null}

          {data.admin && data.unassignedQueue.length > 0 ? (
            <article className="card" style={{ marginTop: '1.5rem' }}>
              <p className="card-kicker">Needs attention</p>
              <h2 className="card-title">Reassignment queue</h2>
              <p className="card-body" style={{ marginBottom: '1.25rem' }}>
                Active cases this organization can still act on but that currently have nobody
                assigned - most often because the only assigned member was removed. Assign someone
                in the Missions section below.
              </p>
              <div className="rows">
                {data.unassignedQueue.map((m) => (
                  <a key={m.missionId} href={`#mission-${m.missionId}`} className="row row-link">
                    <span className="row-key">{m.title}</span>
                    <span className="muted">{m.applicantName}</span>
                  </a>
                ))}
              </div>
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
                    tasks={mission.tasks}
                    appointments={mission.appointments}
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
                          {req.dueDate
                            ? ` · due ${new Date(req.dueDate).toLocaleDateString()}`
                            : ''}
                        </span>
                        {EVIDENCE_DECIDABLE_STATUSES.has(req.status) ? (
                          <EvidenceRequestActions
                            organizationId={orgId}
                            requestId={req.id}
                            status={req.status}
                          />
                        ) : null}
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
