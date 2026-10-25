import 'server-only';
import {
  type Db,
  computeReadiness,
  getLiveAcknowledgement,
  getOrganization,
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
import { fieldLabel } from '../../../../lib/master-profile';

/**
 * What each page of an agency's console reads (Commercial V1 Part 9 UX-01). The
 * console used to be one page that loaded all of this on every visit; it is now
 * one page per section, and each section loads only what it shows. The reads are
 * the ones the single page made, moved here unchanged, so who may see what is
 * decided exactly where it was: by the service functions, never by the page.
 */

type Organization = NonNullable<Awaited<ReturnType<typeof getOrganization>>>;
type OkValue<R> = R extends { readonly ok: true; readonly value: infer V } ? V : never;

export type OrgMember = OkValue<Awaited<ReturnType<typeof listOrgMemberships>>>[number];
export type EvidenceRequestRow = OkValue<
  Awaited<ReturnType<typeof listEvidenceRequestsForOrgDetailed>>
>[number];

export interface OrgAccess {
  readonly org: Organization;
  readonly admin: boolean;
  /** Any active member, administrator or not. */
  readonly member: boolean;
}

/**
 * Who this account is in this organization, or null when the organization does
 * not exist. Not member-gated by design: the organization's name already renders
 * for anyone who reaches the page by URL, and branding carries no more
 * sensitivity than that.
 *
 * Finding #31 (post-programme defect register): mission collaboration --
 * assignments, notes, requirements, and the reviewer decision workflow
 * recordMissionDecision itself authorizes -- is NOT an admin-only capability at
 * the service layer (canReadMissionCollaboration checks a COMMENT-or-MANAGE org
 * grant; recordMissionDecision checks active membership + assignment + grant,
 * never isOrgAdmin). Any active member, not just an OWNER/ADMIN, has standing to
 * reach it, hence `member` is wider than `admin`.
 */
export async function loadOrgAccess(
  db: Db,
  accountId: string,
  orgId: string,
): Promise<OrgAccess | null> {
  const org = await getOrganization(db, orgId);
  if (!org) return null;
  const admin = await isOrgAdmin(db, accountId, orgId);
  const member = admin || (await isActiveMember(db, accountId, orgId));
  return { org, admin, member };
}

/**
 * The full membership roster. Administrator data: `listOrgMemberships` refuses
 * anyone else at the service layer, and it is not even asked for them, so a
 * non-administrator correctly gets an empty roster (their note-author names
 * resolve to "Unknown" rather than gaining roster access through a side door).
 */
export async function loadMembers(
  db: Db,
  accountId: string,
  orgId: string,
  access: Pick<OrgAccess, 'admin'>,
): Promise<OrgMember[]> {
  if (!access.admin) return [];
  const result = await listOrgMemberships(db, accountId, orgId);
  return result.ok ? result.value : [];
}

/** Org-wide evidence requests: administrator data, empty for anyone else. */
export async function loadEvidenceRequests(
  db: Db,
  accountId: string,
  orgId: string,
  access: Pick<OrgAccess, 'admin'>,
): Promise<EvidenceRequestRow[]> {
  if (!access.admin) return [];
  const result = await listEvidenceRequestsForOrgDetailed(db, accountId, orgId);
  return result.ok ? result.value : [];
}

/** Pending team invitations: administrator data. */
export async function loadPendingTeamInvitations(
  db: Db,
  accountId: string,
  orgId: string,
  access: Pick<OrgAccess, 'admin'>,
) {
  if (!access.admin) return [];
  const result = await listOrganizationInvitations(db, {
    actorAccountId: accountId,
    organizationId: orgId,
  });
  return result.ok ? result.value.filter((i) => i.status === 'PENDING') : [];
}

/** Pending client invitations: administrator data. */
export async function loadPendingClientInvitations(
  db: Db,
  accountId: string,
  orgId: string,
  access: Pick<OrgAccess, 'admin'>,
) {
  if (!access.admin) return [];
  const result = await listClientInvitations(db, {
    actorAccountId: accountId,
    organizationId: orgId,
  });
  return result.ok ? result.value.filter((i) => i.status === 'PENDING') : [];
}

/** The applicants the "Request Evidence" form can target: only ever shown to an administrator. */
export async function loadApplicants(db: Db, orgId: string, access: Pick<OrgAccess, 'admin'>) {
  return access.admin ? listApplicantsForOrganization(db, orgId) : [];
}

/**
 * Commercial V1 Part 4 section 11's "reassignment queue": every case this
 * organization can still act on but that currently has nobody assigned at all,
 * most often because `setMembershipActive`'s deactivation path auto-unassigned a
 * departed member's sole case. Administrator-only surfacing (it matches
 * assignMember/unassignMember's own bar), though the read itself carries no more
 * than `listMissionsForOrganization` already exposes to this organization.
 */
export async function loadUnassignedQueue(db: Db, orgId: string, access: Pick<OrgAccess, 'admin'>) {
  return access.admin ? listUnassignedActiveMissions(db, orgId) : [];
}

/**
 * CAS-02: the single source of truth for "which cases can this actor see"
 * (administrators: all the organization can reach; anyone else: only the cases
 * they are personally assigned to), so a search and this default listing never
 * diverge in what they authorize. Light: no per-case detail.
 */
export async function loadVisibleCaseList(db: Db, accountId: string, orgId: string) {
  return (await listVisibleMissionsForMember(db, orgId, accountId)).missions;
}

/**
 * Every case this person can see, each with its assignments, notes, tasks,
 * appointments, requirements, reviewer decisions, issuer confirmations,
 * readiness and the applicant's live acknowledgement. This is the heavy read, so
 * only the two pages that show it (Dashboard and Cases) call it.
 */
export async function loadCases(
  db: Db,
  accountId: string,
  orgId: string,
  members: readonly OrgMember[],
) {
  const visible = await listVisibleMissionsForMember(db, orgId, accountId);
  const cases = await Promise.all(
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
        liveAcknowledgement,
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
        // TRU-02 (Part 7 §3): replaces CAS-02's earlier "Acknowledgement:
        // not yet tracked" placeholder now that the feature exists.
        // getLiveAcknowledgement does no authorization of its own by
        // design -- safe here since `mission.missionId` is already this
        // org's own authorized set (every other read in this Promise.all
        // already trusts it the same way).
        getLiveAcknowledgement(db, mission.missionId),
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
          // admin-only data -- a non-admin viewer correctly sees
          // "Unknown" here rather than gaining roster access through a
          // side door; the note body/date/requirement content itself
          // is unaffected.
          authorEmail: members.find((m) => m.accountId === n.authorAccountId)?.email ?? 'Unknown',
        })),
        requirements: requirements.ok
          ? requirements.value.map((r) => ({
              id: r.id,
              label:
                r.kind === 'FIELD'
                  ? (fieldLabel(r.fieldKey ?? '') ?? r.fieldKey ?? '')
                  : (r.docType ?? ''),
            }))
          : [],
        // A non-admin, non-assigned-to-THIS-mission member correctly
        // gets [] here (listMissionDecisions refuses per-mission, not
        // per-org) -- they still see every mission they ARE assigned to.
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
        liveAcknowledgementAt: liveAcknowledgement?.createdAt.toISOString() ?? null,
      };
    }),
  );
  return { admin: visible.admin, cases };
}

export type CaseDetail = Awaited<ReturnType<typeof loadCases>>['cases'][number];
