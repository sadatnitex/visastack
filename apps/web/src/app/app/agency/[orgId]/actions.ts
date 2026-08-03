'use server';

import type { MembershipRole } from '@visastack/core';
import {
  addMembership,
  addNote,
  assignMember,
  getAccountByEmail,
  recordMissionDecision,
  requestEvidence,
  setMembershipActive,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
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
    });
    if (!requested.ok) return { ok: false, message: requested.error.message } satisfies ActionState;
    return { ok: true, message: 'Evidence request sent.' } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/agency/${organizationId}`);
  return result;
}

/** Add an existing VisaStack user to the organization by email (org admin). */
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
    if (!account) {
      return {
        ok: false,
        message: 'No VisaStack account for that email. They must sign in once first.',
      } satisfies ActionState;
    }
    const added = await addMembership(db, {
      actorAccountId: accountId,
      organizationId,
      accountId: account.id,
      role,
    });
    if (!added.ok) return { ok: false, message: added.error.message } satisfies ActionState;
    return { ok: true, message: `${memberEmail} added as ${role}.` } satisfies ActionState;
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

/** Add a case note to a mission (org admin). */
export async function addNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = requireAgencyCollaboration();
  if (gate) return gate;

  const organizationId = String(formData.get('organizationId') ?? '');
  const missionId = String(formData.get('missionId') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  if (body.length === 0) return { ok: false, message: 'Enter a note.' };

  const result = await withSession(async ({ db, accountId }) => {
    const note = await addNote(db, { actorAccountId: accountId, missionId, body });
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
