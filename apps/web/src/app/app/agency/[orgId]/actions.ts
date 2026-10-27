'use server';

import type { MembershipRole } from '@visastack/core';
import { resolveDocumentType } from '@visastack/core/catalogue/documents';
import {
  addMemberByEmail,
  addNote,
  assignMember,
  cancelEvidenceRequest,
  createAppointmentForOrg,
  createClientInvitation,
  createTaskForOrg,
  decideAppointmentForOrg,
  decideEvidenceResponse,
  decideTaskForOrg,
  listSelectedEvidenceForOrg,
  recordIssuerVerification,
  recordMissionDecision,
  removeOrganizationLogo,
  requestEvidence,
  revokeClientInvitation,
  revokeOrganizationInvitation,
  setMembershipActive,
  setRequireDifferentReviewer,
  startEvidenceReview,
  unassignMember,
  updateOrganizationBranding,
  updateTaskForOrg,
  uploadOrganizationLogo,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { resolveBaseUrl } from '../../../../lib/base-url';
import {
  capabilityUnavailableMessage,
  getPlatformCapabilities,
} from '../../../../lib/capabilities';
import { parseFieldKeyInput } from '../../../../lib/catalogue-input';
import { humanizeCode } from '../../../../lib/format-code';
import { triggerNotificationWorker } from '../../../../lib/jobs';
import { createKeyManagementPort, createMalwareScanner } from '../../../../lib/providers';
import { withSession } from '../../../../lib/session';
import { createStorage } from '../../../../lib/storage';
import {
  REQUEST_SENT_LINE,
  invitationReadyLine,
  memberAddedLine,
} from '../../../../lib/success-lines';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly invitationUrl?: string;
}

/**
 * Server-side capability gate (master recovery directive §7): assignment,
 * notes, evidence requests, and membership activation all sit behind
 * `agencyCollaboration`. The confirmed PR 1 defects behind these four
 * functions (cross-tenant IDOR in `setMembershipActive`, missing
 * authorization in `addNote`, missing grant-relationship checks in
 * `assignMember`/`requestEvidence`) were repaired in PR 2 and are covered by
 * the hostile-authorization suite — see
 * docs/audits/commercial-readiness-recovery-baseline.md §7 and
 * packages/services/src/agency.test.ts. This check now normally passes
 * (`agencyCollaboration` reports `available`); it stays in place as a live
 * kill-switch, not dead code — flipping the registry's
 * `KNOWN_SECURITY_GAPS` set (apps/web/src/lib/capabilities.ts) re-engages it
 * instantly, with no redeploy, should a future regression need it. Member
 * *addition* (`addMemberAction`) is deliberately NOT gated — it was
 * independently reviewed and has no confirmed defect.
 */
function requireAgencyCollaboration(): ActionState | null {
  if (getPlatformCapabilities().agencyCollaboration === 'available') return null;
  return { ok: false, message: capabilityUnavailableMessage('agencyCollaboration') };
}

const ROLES: readonly MembershipRole[] = ['ADMIN', 'CASE_MANAGER', 'REVIEWER'];
function toRole(value: string): MembershipRole {
  return (ROLES as readonly string[]).includes(value) ? (value as MembershipRole) : 'REVIEWER';
}

/** Org admin requests a specific field or document from an applicant. */
export async function requestEvidenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const applicantId = String(formData.get('applicantId') ?? '').trim();
  const missionId = String(formData.get('missionId') ?? '').trim();
  const kind = String(formData.get('kind') ?? '') === 'DOCUMENT' ? 'DOCUMENT' : 'FIELD';
  const key = String(formData.get('key') ?? '').trim();
  const message = String(formData.get('message') ?? '').trim();
  const dueDateRaw = String(formData.get('dueDate') ?? '').trim();
  const dueDate = dueDateRaw.length > 0 ? new Date(dueDateRaw) : undefined;
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    return { ok: false, message: 'Enter a valid due date.' };
  }

  if (applicantId.length === 0) return { ok: false, message: 'Enter the applicant ID.' };
  if (key.length === 0) {
    return {
      ok: false,
      message: kind === 'FIELD' ? 'Enter the field key.' : 'Enter the document type.',
    };
  }

  // A detail must be one the product knows (its standard name is what gets stored). A document type is
  // stored under its standard key when the catalogue knows it; a name typed for "something else" stays as typed.
  const named = kind === 'FIELD' ? parseFieldKeyInput(key) : undefined;
  if (named && !named.ok) return { ok: false, message: named.message };
  const requestedKey =
    kind === 'FIELD' ? (named?.ok ? named.key : key) : (resolveDocumentType(key)?.key ?? key);

  const result = await withSession(async ({ db, accountId }) => {
    const requested = await requestEvidence(db, {
      actorAccountId: accountId,
      organizationId,
      applicantId,
      kind,
      ...(kind === 'FIELD' ? { fieldKey: requestedKey } : { docType: requestedKey }),
      ...(message.length > 0 ? { message } : {}),
      // Threads the mission scope through when the requester picked one —
      // an organization whose only standing for this applicant is a
      // mission-scoped grant would otherwise always hit `scope_mismatch`
      // even though `listApplicantsForOrganization` correctly surfaces the
      // applicant (Codex review, PR #65).
      ...(missionId.length > 0 ? { missionId } : {}),
      ...(dueDate ? { dueDate } : {}),
    });
    if (!requested.ok) return { ok: false, message: requested.error.message } satisfies ActionState;
    return { ok: true, message: REQUEST_SENT_LINE } satisfies ActionState;
  });

  if (result.ok) {
    revalidatePath(`/app/agency/${organizationId}`, 'layout');
    // NTF-02/§3: "event enqueue <=60 seconds" -- near-instant delivery for
    // the common case; the periodic cron sweep is the durability backstop.
    after(() => triggerNotificationWorker());
  }
  return result;
}

/** Org member marks a RECEIVED request as UNDER_REVIEW (workflow visibility only). */
export async function startEvidenceReviewAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const result = await withSession(async ({ db, accountId }) => {
    const started = await startEvidenceReview(db, { actorAccountId: accountId, requestId });
    if (!started.ok) return { ok: false, message: started.error.message } satisfies ActionState;
    return { ok: true, message: 'Marked under review.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

const EVIDENCE_OUTCOMES = [
  'ACCEPTED',
  'NEEDS_REPLACEMENT',
  'CONTRADICTION',
  'CORRECTION_PROPOSED',
] as const;
type EvidenceOutcome = (typeof EVIDENCE_OUTCOMES)[number];

const EVIDENCE_OUTCOME_MESSAGES: Record<EvidenceOutcome, string> = {
  ACCEPTED: 'Accepted.',
  NEEDS_REPLACEMENT: 'Replacement requested.',
  CONTRADICTION: 'Flagged as contradicting the applicant profile.',
  CORRECTION_PROPOSED: 'Correction suggested to the applicant.',
};

/** Org member decides on what was submitted (Commercial V1 Part 4 §13): accept, ask for a replacement, flag a contradiction, or suggest a correction. */
export async function decideEvidenceResponseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const outcomeRaw = String(formData.get('outcome') ?? '');
  const outcome = (EVIDENCE_OUTCOMES as readonly string[]).includes(outcomeRaw)
    ? (outcomeRaw as EvidenceOutcome)
    : null;
  const reason = String(formData.get('reason') ?? '').trim();
  if (!outcome) {
    return {
      ok: false,
      message: 'Choose accept, needs replacement, contradiction, or correction.',
    };
  }
  if (outcome !== 'ACCEPTED' && reason.length === 0) {
    return { ok: false, message: 'Explain the reason for the applicant to see.' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const decided = await decideEvidenceResponse(db, {
      actorAccountId: accountId,
      requestId,
      outcome,
      ...(reason.length > 0 ? { reason } : {}),
    });
    if (!decided.ok) return { ok: false, message: decided.error.message } satisfies ActionState;
    return { ok: true, message: EVIDENCE_OUTCOME_MESSAGES[outcome] } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Org member withdraws a request that no longer needs an answer. */
export async function cancelEvidenceRequestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  const result = await withSession(async ({ db, accountId }) => {
    const cancelled = await cancelEvidenceRequest(db, {
      actorAccountId: accountId,
      requestId,
      ...(reason.length > 0 ? { reason } : {}),
    });
    if (!cancelled.ok) return { ok: false, message: cancelled.error.message } satisfies ActionState;
    return { ok: true, message: 'Request cancelled.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Add or invite a teammate, with durable email and a private shareable link. */
export async function addMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const memberEmail = String(formData.get('memberEmail') ?? '')
    .trim()
    .toLowerCase();
  const role = toRole(String(formData.get('role') ?? ''));
  if (memberEmail.length === 0) return { ok: false, message: 'Enter a member email.' };

  const result = await withSession(async ({ db, accountId }) => {
    // Authorization, the rate limit and the "is this email registered?"
    // lookup all happen inside the service, in that order. Looking the account
    // up here first (as this action used to) made registration answerable
    // before any permission or limit check.
    const encryption = createKeyManagementPort();
    const outcome = await addMemberByEmail(db, {
      actorAccountId: accountId,
      organizationId,
      email: memberEmail,
      ...(encryption ? { encryption } : {}),
      role,
    });
    if (!outcome.ok) return { ok: false, message: outcome.error.message } satisfies ActionState;
    if (outcome.value.kind === 'added') {
      return { ok: true, message: memberAddedLine(humanizeCode(role)) } satisfies ActionState;
    }
    const acceptUrl = `${resolveBaseUrl()}/invitation?kind=team&token=${outcome.value.rawToken}`;
    return {
      ok: true,
      message: invitationReadyLine(Boolean(encryption), '7 days'),
      invitationUrl: acceptUrl,
    } satisfies ActionState;
  });
  if (result.ok) {
    revalidatePath(`/app/agency/${organizationId}`, 'layout');
    after(() => triggerNotificationWorker().then(() => undefined));
  }
  return result;
}

/** Revoke a still-pending member invitation (org admin). */
export async function revokeInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const invitationId = String(formData.get('invitationId') ?? '');

  const result = await withSession(async ({ db, accountId }) => {
    const revoked = await revokeOrganizationInvitation(db, {
      actorAccountId: accountId,
      organizationId,
      invitationId,
    });
    if (!revoked.ok) return { ok: false, message: revoked.error.message } satisfies ActionState;
    return { ok: true, message: 'Invitation revoked.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Invite a client without an account lookup or automatic wallet access. */
export async function inviteClientAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const caseOwnerAccountId = String(formData.get('caseOwnerAccountId') ?? '');
  const displayName = String(formData.get('displayName') ?? '').trim();
  const contactDestination = String(formData.get('contactDestination') ?? '').trim();
  const requestedRoute = String(formData.get('requestedRoute') ?? '').trim();
  if (displayName.length === 0) return { ok: false, message: "Enter the traveller's name." };
  if (contactDestination.length === 0) {
    return { ok: false, message: "Enter the client's email address." };
  }
  if (caseOwnerAccountId.length === 0) return { ok: false, message: 'Choose a case owner.' };

  const result = await withSession(async ({ db, accountId }) => {
    const encryption = createKeyManagementPort();
    const invited = await createClientInvitation(db, {
      actorAccountId: accountId,
      organizationId,
      caseOwnerAccountId,
      displayName,
      contactDestination,
      ...(encryption ? { encryption } : {}),
      ...(requestedRoute.length > 0 ? { requestedRoute } : {}),
    });
    if (!invited.ok) return { ok: false, message: invited.error.message } satisfies ActionState;
    const acceptUrl = `${resolveBaseUrl()}/invitation?kind=client&token=${invited.value.rawToken}`;
    return {
      ok: true,
      message: invitationReadyLine(invited.value.emailQueued, '7 days'),
      invitationUrl: acceptUrl,
    } satisfies ActionState;
  });
  if (result.ok) {
    revalidatePath(`/app/agency/${organizationId}`, 'layout');
    after(() => triggerNotificationWorker().then(() => undefined));
  }
  return result;
}

/** Revoke a still-pending client invitation (org admin). */
export async function revokeClientInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const invitationId = String(formData.get('invitationId') ?? '');

  const result = await withSession(async ({ db, accountId }) => {
    const revoked = await revokeClientInvitation(db, {
      actorAccountId: accountId,
      organizationId,
      invitationId,
    });
    if (!revoked.ok) return { ok: false, message: revoked.error.message } satisfies ActionState;
    return { ok: true, message: 'Invitation revoked.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Assign an org member to a mission (org admin). Bookkeeping only — never grants access on its own. */
export async function assignMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const missionId = String(formData.get('missionId') ?? '');
  const memberAccountId = String(formData.get('memberAccountId') ?? '');
  if (missionId.length === 0 || memberAccountId.length === 0) {
    return { ok: false, message: 'Choose a member to assign.' };
  }
  const result = await withSession(async ({ db, accountId }) => {
    const assigned = await assignMember(db, {
      actorAccountId: accountId,
      organizationId,
      memberAccountId,
      missionId,
    });
    if (!assigned.ok) return { ok: false, message: assigned.error.message } satisfies ActionState;
    return { ok: true, message: 'Member assigned.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Unassign a member from a mission (org admin) -- the manual counterpart to the automatic reassignment-queue unassign on membership deactivation. */
export async function unassignMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const missionId = String(formData.get('missionId') ?? '');
  const memberAccountId = String(formData.get('memberAccountId') ?? '');
  if (missionId.length === 0 || memberAccountId.length === 0) {
    return { ok: false, message: 'Missing member or case.' };
  }
  const result = await withSession(async ({ db, accountId }) => {
    const unassigned = await unassignMember(db, {
      actorAccountId: accountId,
      organizationId,
      memberAccountId,
      missionId,
    });
    if (!unassigned.ok) {
      return { ok: false, message: unassigned.error.message } satisfies ActionState;
    }
    return { ok: true, message: 'Member unassigned.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Org-side task creation (Commercial V1 Part 4 §11) -- an assigned member's own checklist item, distinct from the applicant owner's. */
export async function createTaskForOrgAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const missionId = String(formData.get('missionId') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  if (description.length === 0) return { ok: false, message: 'A description is required.' };
  const priorityRaw = String(formData.get('priority') ?? '');
  const priority = (['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).includes(priorityRaw as never)
    ? (priorityRaw as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT')
    : undefined;
  const dueDateRaw = String(formData.get('dueDate') ?? '').trim();
  const dueDate = dueDateRaw.length > 0 ? new Date(dueDateRaw) : undefined;
  const assigneeAccountId = String(formData.get('assigneeAccountId') ?? '').trim();

  const result = await withSession(async ({ db, accountId }) => {
    const task = await createTaskForOrg(db, {
      actorAccountId: accountId,
      organizationId,
      missionId,
      description,
      ...(priority ? { priority } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(assigneeAccountId ? { assigneeAccountId } : {}),
    });
    if (!task.ok) return { ok: false, message: task.error.message } satisfies ActionState;
    return { ok: true, message: 'Task added.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Reassign, reschedule, or re-prioritize a task (org admin/assigned member); every change is audited (Commercial V1 Part 4 §11). */
export async function updateTaskForOrgAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const missionId = String(formData.get('missionId') ?? '');
  const taskId = String(formData.get('taskId') ?? '');
  const assigneeAccountId = String(formData.get('assigneeAccountId') ?? '').trim();
  if (taskId.length === 0) return { ok: false, message: 'Missing task.' };

  const result = await withSession(async ({ db, accountId }) => {
    const updated = await updateTaskForOrg(db, {
      actorAccountId: accountId,
      organizationId,
      missionId,
      taskId,
      assigneeAccountId: assigneeAccountId.length > 0 ? assigneeAccountId : null,
    });
    if (!updated.ok) return { ok: false, message: updated.error.message } satisfies ActionState;
    return { ok: true, message: 'Task reassigned.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Move an org-visible task through OPEN -> IN_PROGRESS -> DONE/CANCELLED. */
export async function decideTaskForOrgAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const missionId = String(formData.get('missionId') ?? '');
  const taskId = String(formData.get('taskId') ?? '');
  const status = String(formData.get('status') ?? '') as 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  if (taskId.length === 0) return { ok: false, message: 'Missing task.' };

  const result = await withSession(async ({ db, accountId }) => {
    const decided = await decideTaskForOrg(db, {
      actorAccountId: accountId,
      organizationId,
      missionId,
      taskId,
      status,
    });
    if (!decided.ok) return { ok: false, message: decided.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `Task ${status.toLowerCase().replace('_', ' ')}.`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Org-side appointment scheduling (Commercial V1 Part 4 §11). */
export async function createAppointmentForOrgAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const missionId = String(formData.get('missionId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const localDate = String(formData.get('localDate') ?? '').trim();
  const localTime = String(formData.get('localTime') ?? '').trim();
  const timezone = String(formData.get('timezone') ?? '').trim();
  if (title.length === 0 || !localDate || !localTime || !timezone) {
    return { ok: false, message: 'Title, date, time, and timezone are required.' };
  }
  const localDateTime = new Date(`${localDate}T${localTime}:00`);
  if (Number.isNaN(localDateTime.getTime())) {
    return { ok: false, message: 'Invalid date or time.' };
  }
  const place = String(formData.get('place') ?? '').trim();
  const channel = String(formData.get('channel') ?? '').trim();

  const result = await withSession(async ({ db, accountId }) => {
    const appointment = await createAppointmentForOrg(db, {
      actorAccountId: accountId,
      organizationId,
      missionId,
      title,
      localDateTime,
      timezone,
      ...(place ? { place } : {}),
      ...(channel ? { channel } : {}),
    });
    if (!appointment.ok) {
      return { ok: false, message: appointment.error.message } satisfies ActionState;
    }
    return { ok: true, message: 'Appointment scheduled.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Mark an org-visible appointment DONE or CANCELLED. */
export async function decideAppointmentForOrgAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const missionId = String(formData.get('missionId') ?? '');
  const appointmentId = String(formData.get('appointmentId') ?? '');
  const status = String(formData.get('status') ?? '') as 'DONE' | 'CANCELLED';
  if (appointmentId.length === 0) return { ok: false, message: 'Missing appointment.' };

  const result = await withSession(async ({ db, accountId }) => {
    const decided = await decideAppointmentForOrg(db, {
      actorAccountId: accountId,
      organizationId,
      missionId,
      appointmentId,
      status,
    });
    if (!decided.ok) return { ok: false, message: decided.error.message } satisfies ActionState;
    return {
      ok: true,
      message: status === 'DONE' ? 'Appointment completed.' : 'Appointment cancelled.',
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Add a case note to a mission (org admin). Visibility is required, explicit, never defaulted: see agency.ts's addNote doc comment. */
export async function addNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const missionId = String(formData.get('missionId') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  if (body.length === 0) return { ok: false, message: 'Enter a note.' };
  const visibilityRaw = String(formData.get('visibility') ?? '');
  if (visibilityRaw !== 'AGENCY_INTERNAL' && visibilityRaw !== 'TRAVELLER_SHARED') {
    return {
      ok: false,
      message: 'Select whether this note is internal or shared with the traveller.',
    };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const note = await addNote(db, {
      actorAccountId: accountId,
      missionId,
      body,
      visibility: visibilityRaw,
    });
    if (!note.ok) return { ok: false, message: note.error.message } satisfies ActionState;
    return { ok: true, message: 'Note added.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Record a reviewer decision on a specific requirement (assigned, granted member only). */
export async function recordDecisionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const missionId = String(formData.get('missionId') ?? '');
  const packRequirementId = String(formData.get('packRequirementId') ?? '');
  const outcome = String(formData.get('outcome') ?? '') as 'ACCEPTED' | 'REJECTED';
  const reason = String(formData.get('reason') ?? '').trim() || undefined;
  if (packRequirementId.length === 0) return { ok: false, message: 'Choose a requirement.' };

  const result = await withSession(async ({ db, accountId }) => {
    const decision = await recordMissionDecision(db, {
      actorAccountId: accountId,
      organizationId,
      missionId,
      packRequirementId,
      outcome,
      ...(reason ? { reason } : {}),
    });
    if (!decision.ok) return { ok: false, message: decision.error.message } satisfies ActionState;
    return { ok: true, message: `Decision recorded: ${outcome}.` } satisfies ActionState;
  });
  if (result.ok) {
    revalidatePath(`/app/agency/${organizationId}`, 'layout');
    after(() => triggerNotificationWorker());
  }
  return result;
}

/**
 * Record an issuer confirmation (EVI-05, tier E3) against whatever a
 * requirement's evidence is currently selected as. The fact/document is
 * resolved server-side from `packRequirementId` via
 * `listSelectedEvidenceForOrg` (never trusted from the client directly);
 * `recordIssuerVerification` itself re-authorizes independently with its
 * own MANAGE-grant check, so this action does not widen either.
 */
export async function recordIssuerVerificationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const missionId = String(formData.get('missionId') ?? '');
  const applicantId = String(formData.get('applicantId') ?? '');
  const packRequirementId = String(formData.get('packRequirementId') ?? '');
  const issuerIdentity = String(formData.get('issuerIdentity') ?? '').trim();
  const contactMethod = String(formData.get('contactMethod') ?? '').trim();
  const exactClaim = String(formData.get('exactClaim') ?? '').trim();
  const response = String(formData.get('response') ?? '').trim();
  const validUntilRaw = String(formData.get('validUntil') ?? '');
  if (packRequirementId.length === 0) return { ok: false, message: 'Choose a requirement.' };
  if (!issuerIdentity || !contactMethod || !exactClaim || !response || !validUntilRaw) {
    return { ok: false, message: 'Every field is required to record an issuer confirmation.' };
  }
  const validUntil = new Date(validUntilRaw);
  if (Number.isNaN(validUntil.getTime())) {
    return { ok: false, message: 'Enter a valid date.' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const evidence = await listSelectedEvidenceForOrg(db, organizationId, missionId);
    if (!evidence.ok) return { ok: false, message: evidence.error.message } satisfies ActionState;
    const selection = evidence.value.find((e) => e.packRequirementId === packRequirementId);
    if (!selection || (!selection.factId && !selection.documentId)) {
      return {
        ok: false,
        message: 'No evidence is selected for this requirement yet.',
      } satisfies ActionState;
    }

    const recorded = await recordIssuerVerification(db, {
      actorAccountId: accountId,
      applicantId,
      missionId,
      ...(selection.factId ? { factId: selection.factId } : {}),
      ...(selection.documentId ? { documentId: selection.documentId } : {}),
      issuerIdentity,
      contactMethod,
      exactClaim,
      response,
      validUntil,
    });
    if (!recorded.ok) return { ok: false, message: recorded.error.message } satisfies ActionState;
    return { ok: true, message: 'Issuer confirmation recorded.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Activate or deactivate a membership (org admin). Deactivation ends access. */
export async function toggleMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const membershipId = String(formData.get('membershipId') ?? '');
  const active = String(formData.get('active') ?? '') === 'true';
  if (membershipId.length === 0) return { ok: false, message: 'Missing membership id.' };
  const result = await withSession(async ({ db, accountId }) => {
    const updated = await setMembershipActive(db, {
      actorAccountId: accountId,
      organizationId,
      membershipId,
      active,
    });
    if (!updated.ok) return { ok: false, message: updated.error.message } satisfies ActionState;
    return {
      ok: true,
      message: active ? 'Member reactivated.' : 'Member deactivated.',
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Org admin toggles whether a reviewer must differ from whoever raised the evidence request (Commercial V1 Part 4 §13). */
export async function setRequireDifferentReviewerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const required = String(formData.get('required') ?? '') === 'true';
  const result = await withSession(async ({ db, accountId }) => {
    const updated = await setRequireDifferentReviewer(db, {
      actorAccountId: accountId,
      organizationId,
      required,
    });
    if (!updated.ok) return { ok: false, message: updated.error.message } satisfies ActionState;
    return {
      ok: true,
      message: required
        ? 'A reviewer must now differ from whoever raised the request.'
        : 'Reviewer restriction turned off.',
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Org admin changes the agency name and/or accent color (Commercial V1 COM-04). An empty accentColor field clears it back to unset. */
export async function updateBrandingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const nameRaw = formData.get('name');
  const accentColorRaw = String(formData.get('accentColor') ?? '').trim();
  const result = await withSession(async ({ db, accountId }) => {
    const updated = await updateOrganizationBranding(db, {
      actorAccountId: accountId,
      organizationId,
      ...(typeof nameRaw === 'string' && nameRaw.trim().length > 0 ? { name: nameRaw } : {}),
      accentColor: accentColorRaw.length > 0 ? accentColorRaw : null,
    });
    if (!updated.ok) return { ok: false, message: updated.error.message } satisfies ActionState;
    return { ok: true, message: 'Branding updated.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Org admin uploads (or replaces) the agency logo (Commercial V1 COM-04). Scanned synchronously; an unsafe or invalid image is never attached. */
export async function uploadLogoAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Choose an image file.' };
  }
  const result = await withSession(async ({ db, accountId }) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const storage = createStorage(db);
    const scanner = createMalwareScanner(storage);
    const uploaded = await uploadOrganizationLogo(db, storage, scanner, {
      actorAccountId: accountId,
      organizationId,
      contentType: file.type,
      bytes,
    });
    if (!uploaded.ok) return { ok: false, message: uploaded.error.message } satisfies ActionState;
    return { ok: true, message: 'Logo updated.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}

/** Org admin removes the agency logo (Commercial V1 COM-04). Idempotent -- a no-op success when none is set. */
export async function removeLogoAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '');
  const result = await withSession(async ({ db, accountId }) => {
    const storage = createStorage(db);
    const removed = await removeOrganizationLogo(db, storage, {
      actorAccountId: accountId,
      organizationId,
    });
    if (!removed.ok) return { ok: false, message: removed.error.message } satisfies ActionState;
    return { ok: true, message: 'Logo removed.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`, 'layout');
  return result;
}
