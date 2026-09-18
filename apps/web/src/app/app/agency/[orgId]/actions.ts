'use server';

import type { MembershipRole } from '@visastack/core';
import {
  addMembership,
  addNote,
  assignMember,
  cancelEvidenceRequest,
  createClientInvitation,
  createOrganizationInvitation,
  decideEvidenceResponse,
  getAccountByEmail,
  listSelectedEvidenceForOrg,
  recordIssuerVerification,
  recordMissionDecision,
  requestEvidence,
  revokeClientInvitation,
  revokeOrganizationInvitation,
  setMembershipActive,
  setRequireDifferentReviewer,
  startEvidenceReview,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { resolveBaseUrl } from '../../../../lib/base-url';
import {
  capabilityUnavailableMessage,
  getPlatformCapabilities,
} from '../../../../lib/capabilities';
import { withSession } from '../../../../lib/session';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
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

  const result = await withSession(async ({ db, accountId }) => {
    const requested = await requestEvidence(db, {
      actorAccountId: accountId,
      organizationId,
      applicantId,
      kind,
      ...(kind === 'FIELD' ? { fieldKey: key } : { docType: key }),
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
    return { ok: true, message: 'Evidence request sent.' } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
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
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
  return result;
}

/** Org member accepts what was submitted, or asks for a replacement, with an optional reason. */
export async function decideEvidenceResponseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const outcomeRaw = String(formData.get('outcome') ?? '');
  const outcome =
    outcomeRaw === 'ACCEPTED' || outcomeRaw === 'NEEDS_REPLACEMENT' ? outcomeRaw : null;
  const reason = String(formData.get('reason') ?? '').trim();
  if (!outcome) return { ok: false, message: 'Choose accept or needs replacement.' };
  if (outcome === 'NEEDS_REPLACEMENT' && reason.length === 0) {
    return { ok: false, message: 'Explain what needs to be replaced.' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const decided = await decideEvidenceResponse(db, {
      actorAccountId: accountId,
      requestId,
      outcome,
      ...(reason.length > 0 ? { reason } : {}),
    });
    if (!decided.ok) return { ok: false, message: decided.error.message } satisfies ActionState;
    return {
      ok: true,
      message: outcome === 'ACCEPTED' ? 'Accepted.' : 'Replacement requested.',
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
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
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
  return result;
}

/**
 * Add a member by email (org admin). When the email already has a VisaStack
 * account, membership is granted immediately. Otherwise this mints a secure,
 * single-use invitation (Commercial V1 Part 4 §5) instead of just erroring:
 * no real email adapter exists yet (Part 5 scope), so the accept link is
 * handed straight back to the admin to share, rather than the invitee never
 * being reachable at all.
 */
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
    const account = await getAccountByEmail(db, memberEmail);
    if (account) {
      const added = await addMembership(db, {
        actorAccountId: accountId,
        organizationId,
        accountId: account.id,
        role,
      });
      if (!added.ok) return { ok: false, message: added.error.message } satisfies ActionState;
      return { ok: true, message: `${memberEmail} added as ${role}.` } satisfies ActionState;
    }

    const invited = await createOrganizationInvitation(db, {
      actorAccountId: accountId,
      organizationId,
      email: memberEmail,
      role,
    });
    if (!invited.ok) return { ok: false, message: invited.error.message } satisfies ActionState;
    const acceptUrl = `${resolveBaseUrl()}/app/invitations/accept?token=${invited.value.rawToken}`;
    return {
      ok: true,
      message: `No account yet for ${memberEmail}. Share this link (expires in 7 days): ${acceptUrl}`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
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
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
  return result;
}

/**
 * Invite a traveller as a new client (Commercial V1 Part 4 §6, IAM-03). The
 * agency never claims or picks the traveller's applicant profile, only a
 * minimal display name/contact/requested route/case owner, so the token
 * this mints is the only thing that changes hands; the traveller alone
 * decides what it attaches to when they accept. No real email adapter
 * exists yet (Part 5 scope), so the accept link is handed straight back to
 * the admin to share, the same interim pattern `addMemberAction` already
 * uses for a teammate with no account yet.
 */
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
    return { ok: false, message: 'Enter a contact email or phone number.' };
  }
  if (caseOwnerAccountId.length === 0) return { ok: false, message: 'Choose a case owner.' };

  const result = await withSession(async ({ db, accountId }) => {
    const invited = await createClientInvitation(db, {
      actorAccountId: accountId,
      organizationId,
      caseOwnerAccountId,
      displayName,
      contactDestination,
      ...(requestedRoute.length > 0 ? { requestedRoute } : {}),
    });
    if (!invited.ok) return { ok: false, message: invited.error.message } satisfies ActionState;
    const acceptUrl = `${resolveBaseUrl()}/app/client-invitations/accept?token=${invited.value.rawToken}`;
    return {
      ok: true,
      message: `Invitation created for ${displayName}. Share this link (expires in 7 days): ${acceptUrl}`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
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
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
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
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
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
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
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
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
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
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
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
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
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
  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
  return result;
}
