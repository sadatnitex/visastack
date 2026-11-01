import 'server-only';
import {
  type ClientInvitation,
  type Db,
  EACH_GRANT,
  type TriageDocumentState,
  accountPrincipal,
  computeReadiness,
  documentLifecycleLabel,
  getClientsJoined,
  getDocumentLifecycles,
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
  listRespondingDocumentStatesForOrg,
  listSelectedEvidenceForOrg,
  listTasksForOrg,
  listUnassignedActiveMissions,
  listVisibleMissionsForMember,
  referenceCodesFor,
  requireAccess,
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
>[number] & {
  /**
   * The answered file's newest version, for the triage groups. Present only for a received
   * document request whose case (or traveller) this organization may still manage: `null` means
   * the file can no longer be used. Absent means the request status alone decides.
   */
  readonly respondingDocumentState?: TriageDocumentState | null;
  /**
   * Resource lifecycle (lane Z, PROGRAMME 5.3): "Archived", "Replaced" or "Removed by the
   * traveller on 3 Nov" when the answered file is no longer the traveller's everyday current one.
   * Never the file's name. Absent for a current file, or when file states were not asked for.
   */
  readonly respondingDocumentLabel?: string;
  /** The request's visible code (`R-7K2Q9M`, ADR 0018); absent when it has none yet. */
  readonly referenceCode?: string;
};

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

/**
 * Org-wide evidence requests: administrator data, empty for anyone else. With `withFileStates`
 * (only the screens that show triage ask for it), a received document request also carries its
 * file's newest state (WP-V4), read through the central access gate one case (or one traveller)
 * at a time, so a file this organization can no longer manage is never looked at.
 */
export async function loadEvidenceRequests(
  db: Db,
  accountId: string,
  orgId: string,
  access: Pick<OrgAccess, 'admin'>,
  options: {
    readonly withFileStates?: boolean;
    /**
     * WP-SB5: only the requests that name this one case, narrowed before any file or reference
     * code is read. A request made for the traveller with no case is left out: the case summary
     * never counts one (W0 structural flag 2).
     */
    readonly forCase?: { readonly missionId: string; readonly applicantId: string };
  } = {},
): Promise<EvidenceRequestRow[]> {
  if (!access.admin) return [];
  const result = await listEvidenceRequestsForOrgDetailed(db, accountId, orgId);
  if (!result.ok) return [];
  const forCase = options.forCase;
  const listed = forCase
    ? result.value.filter(
        (r) => r.missionId === forCase.missionId && r.applicantId === forCase.applicantId,
      )
    : result.value;
  // One registry read for the whole list (ADR 0018), alongside the file states.
  const [codes, rows] = await Promise.all([
    referenceCodesFor(
      db,
      'R',
      listed.map((r) => r.id),
    ),
    withRespondingDocumentStates(db, accountId, orgId, listed, options),
  ]);
  if (codes.size === 0) return rows;
  return rows.map((r) => {
    const referenceCode = codes.get(r.id);
    return referenceCode ? { ...r, referenceCode } : r;
  });
}

async function withRespondingDocumentStates(
  db: Db,
  accountId: string,
  orgId: string,
  requests: readonly EvidenceRequestRow[],
  options: { readonly withFileStates?: boolean },
): Promise<EvidenceRequestRow[]> {
  if (options.withFileStates !== true) return [...requests];
  const answered = requests.filter(
    (r) =>
      r.kind === 'DOCUMENT' &&
      (r.status === 'RECEIVED' || r.status === 'UNDER_REVIEW') &&
      r.respondingDocumentId,
  );
  if (answered.length === 0) return [...requests];
  const scopes = new Map<string, { applicantId: string } | { missionId: string }>();
  for (const r of answered) {
    if (r.missionId) scopes.set(`m:${r.missionId}`, { missionId: r.missionId });
    else scopes.set(`a:${r.applicantId}`, { applicantId: r.applicantId });
  }
  const states = new Map<string, TriageDocumentState | null>();
  const labels = new Map<string, string>();
  const now = new Date();
  await Promise.all(
    [...scopes.entries()].map(async ([scopeKey, ref]) => {
      const proof = await requireAccess(db, accountPrincipal(accountId), 'MANAGE', ref, {
        purpose: EACH_GRANT,
        actingFor: { organizationId: orgId },
      });
      // Refused: the organization can no longer manage that case, so its files stay unread.
      if (!proof.ok) return;
      for (const [id, state] of await listRespondingDocumentStatesForOrg(proof.value, orgId)) {
        states.set(id, state);
      }
      // The same proof reads each answered file's lifecycle (archived, replaced, removed).
      const inScope = answered.filter(
        (r) => (r.missionId ? `m:${r.missionId}` : `a:${r.applicantId}`) === scopeKey,
      );
      const lifecycles = await getDocumentLifecycles(
        db,
        inScope.flatMap((r) => (r.respondingDocumentId ? [r.respondingDocumentId] : [])),
        proof.value,
        { now },
      );
      for (const r of inScope) {
        const lifecycle = r.respondingDocumentId
          ? lifecycles.get(r.respondingDocumentId.toLowerCase())
          : undefined;
        const label = lifecycle ? documentLifecycleLabel(lifecycle, now) : null;
        if (label) labels.set(r.id, label);
      }
    }),
  );
  return requests.map((r) => {
    if (!states.has(r.id) && !labels.has(r.id)) return r;
    const label = labels.get(r.id);
    return {
      ...r,
      ...(states.has(r.id) ? { respondingDocumentState: states.get(r.id) ?? null } : {}),
      ...(label ? { respondingDocumentLabel: label } : {}),
    };
  });
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

/** The applicants the "Request Evidence" form can target: only ever shown to an administrator. */
export async function loadApplicants(db: Db, orgId: string, access: Pick<OrgAccess, 'admin'>) {
  return access.admin ? listApplicantsForOrganization(db, orgId) : [];
}

/**
 * How many clients have joined through an invitation (growth loop 1): the number accepted all time
 * and in the last 30 days, counted from the invitation records. Any active member sees it, like
 * the other counts on the dashboard; the service refuses everyone else, and the page then shows
 * nothing rather than a zero that would be untrue.
 */
export async function loadClientsJoined(db: Db, accountId: string, orgId: string) {
  const result = await getClientsJoined(db, { actorAccountId: accountId, organizationId: orgId });
  return result.ok ? result.value : null;
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
 * Every case this person can see, each with its assignments, tasks, appointments, requirements,
 * reviewer decisions, issuer confirmations, readiness and the applicant's live acknowledgement:
 * what the Dashboard ranks and counts. This is the heavy read, so only the Dashboard calls it. It
 * reads no notes (WP-SB5): the Dashboard shows none, and the Cases page reads them for the one
 * case it opens, a page at a time (`loadOpenCase`).
 */
export async function loadCases(db: Db, accountId: string, orgId: string) {
  const visible = await listVisibleMissionsForMember(db, orgId, accountId);
  // One registry read for the whole list (ADR 0018), never one per case.
  const [caseCodes, cases] = await Promise.all([
    referenceCodesFor(
      db,
      'C',
      visible.missions.map((m) => m.missionId),
    ),
    Promise.all(
      visible.missions.map((mission) => readCaseWorkspace(db, accountId, orgId, mission)),
    ),
  ]);
  return {
    admin: visible.admin,
    cases: cases.map((c) => withReferenceCode(c, caseCodes.get(c.missionId))),
  };
}

/**
 * Agency list sizes (WP-SB5): a list shows 15 rows and grows 15 at a time up to 90, then older
 * pages of 90 follow (the largest step under the 100-row server cap).
 */
export const AGENCY_LIST_SIZES = { step: 15, max: 90 } as const;
/** The Cases page shows this many notes on the open case, then Show More (WP-SB5). */
export const CASE_NOTES_STEP = 10;

/**
 * One page of the cases this person can see, newest opened first, with only what a list row
 * shows (WP-SB5): no per-case detail is read for any of them. The same visibility rule as every
 * other case read (`listVisibleMissionsForMember`): an administrator sees what the organization
 * can reach, anyone else only the cases assigned to them.
 */
export async function loadCaseListPage(
  db: Db,
  accountId: string,
  orgId: string,
  page: { readonly limit: number; readonly before?: string | undefined },
) {
  const visible = await listVisibleMissionsForMember(db, orgId, accountId, {
    limit: page.limit,
    ...(page.before ? { before: page.before } : {}),
  });
  const codes = await referenceCodesFor(
    db,
    'C',
    visible.missions.map((m) => m.missionId),
  );
  return {
    admin: visible.admin,
    total: visible.total,
    nextCursor: visible.nextCursor,
    cases: visible.missions.map((m) => withReferenceCode(m, codes.get(m.missionId))),
  };
}

/**
 * The one case the Cases page has open, with its whole workspace and its newest notes (WP-SB5),
 * or null when this person may not see that case. Whether they may is decided by the same
 * visibility read as the list (`listVisibleMissionsForMember` narrowed to this one id), so an
 * address naming any other case opens nothing. Nothing is read for any other case.
 */
export async function loadOpenCase(
  db: Db,
  accountId: string,
  orgId: string,
  members: readonly OrgMember[],
  missionId: string,
  options: { readonly notesLimit: number; readonly notesBefore?: string | undefined },
) {
  const visible = await listVisibleMissionsForMember(db, orgId, accountId, {
    only: missionId,
    limit: 1,
  });
  const mission = visible.missions[0];
  if (!mission) return null;
  const [codes, workspace, notes] = await Promise.all([
    referenceCodesFor(db, 'C', [mission.missionId]),
    readCaseWorkspace(db, accountId, orgId, mission),
    listNotes(db, orgId, mission.applicantId, mission.missionId, {
      limit: options.notesLimit,
      withTotal: true,
      ...(options.notesBefore ? { before: options.notesBefore } : {}),
    }),
  ]);
  return {
    ...withReferenceCode(workspace, codes.get(mission.missionId)),
    notes: notes.items.map((n) => noteView(n, members)),
    notesTotal: notes.total ?? notes.items.length,
    notesNextCursor: notes.nextCursor,
  };
}

/** How the workspace shows a note's author: administrator data, "Unknown" for anyone else. */
function noteView(
  n: {
    readonly id: string;
    readonly body: string;
    readonly createdAt: Date;
    readonly visibility: 'AGENCY_INTERNAL' | 'TRAVELLER_SHARED';
    readonly authorAccountId: string | null;
  },
  members: readonly OrgMember[],
) {
  return {
    id: n.id,
    body: n.body,
    createdAt: n.createdAt.toISOString(),
    visibility: n.visibility,
    // Author email resolution needs the full membership roster, admin-only data -- a non-admin
    // viewer correctly sees "Unknown" here rather than gaining roster access through a side
    // door; the note body/date/requirement content itself is unaffected.
    authorEmail: members.find((m) => m.accountId === n.authorAccountId)?.email ?? 'Unknown',
  };
}

function withReferenceCode<T extends object>(
  value: T,
  referenceCode: string | undefined,
): T & { readonly referenceCode?: string } {
  // The case's visible code (`C-7K2Q9M`); absent when it has none yet.
  return referenceCode ? { ...value, referenceCode } : value;
}

type VisibleCase = Awaited<ReturnType<typeof listVisibleMissionsForMember>>['missions'][number];

/** One case's workspace, apart from its notes: the reads the Dashboard and the open case share. */
async function readCaseWorkspace(db: Db, accountId: string, orgId: string, mission: VisibleCase) {
  const [
    assignments,
    requirements,
    decisions,
    selectedEvidence,
    tasks,
    appointments,
    readiness,
    liveAcknowledgement,
  ] = await Promise.all([
    listAssignmentsDetailed(db, orgId, mission.applicantId, mission.missionId),
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
      dueTimezone: t.dueTimezone,
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
}

/** How many of the most recently updated cases the Activity page reads notes from. */
export const ACTIVITY_CASE_LIMIT = 10;
/** Notes per Activity page (the log panel's server limit). */
export const ACTIVITY_PAGE_SIZE = 50;

/**
 * Case Activity (WP-SB5): one page of notes from the most recently updated cases this person can
 * see, newest first, as one list. Each case's notes are read through `listNotes`, so the same
 * read check and visibility rule apply; `before` is the previous page's cursor and continues every
 * case strictly after that note. Authors are named only for an administrator (the roster is
 * administrator data).
 */
export async function loadCaseActivity(
  db: Db,
  accountId: string,
  orgId: string,
  members: readonly OrgMember[],
  page: { readonly before?: string | undefined } = {},
) {
  const visible = await loadVisibleCaseList(db, accountId, orgId);
  const selected = [...visible]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, ACTIVITY_CASE_LIMIT);
  const perCase = await Promise.all(
    selected.map(async (mission) => {
      const notes = await listNotes(db, orgId, mission.applicantId, mission.missionId, {
        limit: ACTIVITY_PAGE_SIZE,
        ...(page.before ? { before: page.before } : {}),
      });
      return {
        more: notes.nextCursor !== null,
        notes: notes.items.map((note) => ({ note, mission })),
      };
    }),
  );
  // The same order every case read used (exact time, then id, newest first), so the merged page
  // continues each case exactly where it stops.
  const merged = perCase
    .flatMap((c) => c.notes)
    .sort((a, b) =>
      a.note.cursorAt === b.note.cursorAt
        ? b.note.id.localeCompare(a.note.id)
        : b.note.cursorAt.localeCompare(a.note.cursorAt),
    );
  const kept = merged.slice(0, ACTIVITY_PAGE_SIZE);
  const more = merged.length > kept.length || perCase.some((c) => c.more);
  const last = kept.at(-1);
  return {
    cases: selected.map((m) => ({ missionId: m.missionId, title: caseName(m) })),
    caseLimitReached: visible.length > ACTIVITY_CASE_LIMIT,
    nextCursor: more && last ? last.note.cursor : null,
    notes: kept.map(({ note, mission }) => ({
      id: note.id,
      createdAt: note.createdAt,
      body: note.body,
      // The traveller's name too, so two cases with the same title stay apart.
      caseTitle: caseName(mission),
      missionId: mission.missionId,
      authorEmail: members.find((m) => m.accountId === note.authorAccountId)?.email ?? null,
    })),
  };
}

function caseName(m: { readonly applicantName: string; readonly title: string }): string {
  return `${m.applicantName} · ${m.title}`;
}

/** One page of pending client invitations (WP-SB5): administrator data, empty for anyone else. */
export async function loadPendingClientInvitationPage(
  db: Db,
  accountId: string,
  orgId: string,
  access: Pick<OrgAccess, 'admin'>,
  page: { readonly limit: number; readonly before?: string | undefined },
): Promise<{
  readonly items: readonly ClientInvitation[];
  readonly nextCursor: string | null;
  readonly total: number;
}> {
  const none = { items: [], nextCursor: null, total: 0 };
  if (!access.admin) return none;
  const result = await listClientInvitations(
    db,
    { actorAccountId: accountId, organizationId: orgId },
    { limit: page.limit, status: 'PENDING', ...(page.before ? { before: page.before } : {}) },
  );
  return result.ok ? result.value : none;
}

/** The status views of the Clients page's request list (WP-SB5). */
export const REQUEST_VIEWS = [
  { key: 'open', label: 'Open', statuses: ['OPEN'] },
  { key: 'review', label: 'Waiting on You', statuses: ['RECEIVED', 'UNDER_REVIEW'] },
  { key: 'replacement', label: 'Needs Replacement', statuses: ['NEEDS_REPLACEMENT'] },
  {
    key: 'closed',
    label: 'Closed',
    statuses: ['ACCEPTED', 'CANCELLED', 'FULFILLED', 'DECLINED'],
  },
] as const;
export type RequestViewKey = (typeof REQUEST_VIEWS)[number]['key'];

/**
 * One page of the organization's evidence requests (WP-SB5), optionally one status view, with
 * each request's visible code and how many requests each view holds. Administrator data: empty
 * for anyone else.
 */
export async function loadEvidenceRequestPage(
  db: Db,
  accountId: string,
  orgId: string,
  access: Pick<OrgAccess, 'admin'>,
  page: {
    readonly view?: RequestViewKey | undefined;
    readonly limit: number;
    readonly before?: string | undefined;
    /** One request id: the page holds that request alone, when it is this organization's. */
    readonly only?: string | undefined;
  },
): Promise<{
  readonly items: EvidenceRequestRow[];
  readonly nextCursor: string | null;
  readonly total: number;
  readonly viewCounts: Readonly<Record<'all' | RequestViewKey, number>>;
}> {
  const viewCounts = { all: 0, open: 0, review: 0, replacement: 0, closed: 0 };
  const none = { items: [], nextCursor: null, total: 0, viewCounts };
  if (!access.admin) return none;
  const view = REQUEST_VIEWS.find((v) => v.key === page.view);
  const result = await listEvidenceRequestsForOrgDetailed(db, accountId, orgId, {
    limit: page.limit,
    ...(view ? { statuses: view.statuses } : {}),
    ...(page.before ? { before: page.before } : {}),
    ...(page.only ? { only: page.only } : {}),
  });
  if (!result.ok) return none;
  for (const [status, count] of Object.entries(result.value.statusCounts)) {
    viewCounts.all += count;
    const owner = REQUEST_VIEWS.find((v) => (v.statuses as readonly string[]).includes(status));
    if (owner) viewCounts[owner.key] += count;
  }
  const codes = await referenceCodesFor(
    db,
    'R',
    result.value.items.map((r) => r.id),
  );
  return {
    items: result.value.items.map((r) => {
      const referenceCode = codes.get(r.id);
      return referenceCode ? { ...r, referenceCode } : { ...r };
    }),
    nextCursor: result.value.nextCursor,
    total: result.value.total,
    viewCounts,
  };
}

export type CaseDetail = Awaited<ReturnType<typeof loadCases>>['cases'][number];
export type OpenCase = NonNullable<Awaited<ReturnType<typeof loadOpenCase>>>;
