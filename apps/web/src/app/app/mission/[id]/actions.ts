'use server';

import type { MissionState } from '@visastack/core';
import {
  attachPackVersion,
  computeReadiness,
  createAppointment,
  createContributorRequest,
  createTask,
  decideAppointment,
  decideTask,
  explainReadinessGap,
  fileComplaint,
  generateCoverLetter,
  getMissionForOwner,
  isAiDispatchAllowed,
  listRequirements,
  recordOutcome,
  recordSubmission,
  revokeContributorRequest,
  selectEvidence,
  setMissionItineraryRef,
  snapshotMission,
  submitFeedback,
  transitionMission,
  unselectEvidence,
  updateMissionCaseDetails,
  withdrawOwnComplaint,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { resolveAiExplainer } from '../../../../lib/ai';
import { resolveBaseUrl } from '../../../../lib/base-url';
import { createKeyManagementPort } from '../../../../lib/providers';
import { withSession } from '../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../lib/step-up';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

const STATE_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  INTAKE: 'Intake',
  IN_REVIEW: 'In review',
  AWAITING_APPLICANT: 'Awaiting applicant',
  SUBMISSION_READY: 'Submission ready',
  SUBMITTED: 'Submitted',
  IN_PROGRESS: 'In progress',
  READY_FOR_REVIEW: 'Ready for review',
  UNDER_REVIEW: 'Under review',
  READY_TO_EXPORT: 'Ready to export',
  LOCKED: 'Locked',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

/** Attach a PUBLISHED pack version to the mission. */
export async function attachPackAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const packVersionId = String(formData.get('packVersionId') ?? '');
  if (packVersionId.length === 0) return { ok: false, message: 'Choose a pack to attach.' };

  const result = await withSession(async ({ db, accountId }) => {
    const attached = await attachPackVersion(db, {
      actorAccountId: accountId,
      missionId,
      packVersionId,
    });
    if (!attached.ok) return { ok: false, message: attached.error.message } satisfies ActionState;
    return { ok: true, message: 'Pack attached.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/** Move the mission through the reviewer workflow (legal transitions only). */
export async function transitionMissionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const to = String(formData.get('to') ?? '') as MissionState;
  if (missionId.length === 0 || to.length === 0) return { ok: false, message: 'Missing case.' };
  const result = await withSession(async ({ db, accountId }) => {
    const transitioned = await transitionMission(db, { actorAccountId: accountId, missionId, to });
    if (!transitioned.ok) {
      return { ok: false, message: transitioned.error.message } satisfies ActionState;
    }
    return {
      ok: true,
      message: `Case moved to ${STATE_LABELS[to] ?? to}.`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/** Capture an immutable, checksummed snapshot of the mission. */
export async function snapshotMissionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  if (missionId.length === 0) return { ok: false, message: 'Missing case.' };
  const result = await withSession(async ({ db, accountId }) => {
    const snapshot = await snapshotMission(db, { actorAccountId: accountId, missionId });
    if (!snapshot.ok) return { ok: false, message: snapshot.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `Snapshot version ${snapshot.value.version} captured.`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/** Explicitly select which fact/document instance satisfies a requirement. */
export async function selectEvidenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const packRequirementId = String(formData.get('packRequirementId') ?? '');
  const factId = String(formData.get('factId') ?? '') || undefined;
  const documentId = String(formData.get('documentId') ?? '') || undefined;
  if (missionId.length === 0 || packRequirementId.length === 0 || (!factId && !documentId)) {
    return { ok: false, message: 'Choose an instance to select.' };
  }
  const result = await withSession(async ({ db, accountId }) => {
    const selected = await selectEvidence(db, {
      actorAccountId: accountId,
      missionId,
      packRequirementId,
      ...(factId ? { factId } : {}),
      ...(documentId ? { documentId } : {}),
    });
    if (!selected.ok) return { ok: false, message: selected.error.message } satisfies ActionState;
    return { ok: true, message: 'Evidence selected.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/** Remove an evidence selection — the requirement reverts to "any eligible instance". */
export async function unselectEvidenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const selectionId = String(formData.get('selectionId') ?? '');
  if (missionId.length === 0 || selectionId.length === 0) {
    return { ok: false, message: 'Missing selection.' };
  }
  const result = await withSession(async ({ db, accountId }) => {
    const removed = await unselectEvidence(db, {
      actorAccountId: accountId,
      missionId,
      selectionId,
    });
    if (!removed.ok) return { ok: false, message: removed.error.message } satisfies ActionState;
    return { ok: true, message: 'Selection removed.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/** Add a lightweight checklist item to the mission. */
export async function createTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  if (missionId.length === 0 || description.length === 0) {
    return { ok: false, message: 'A description is required.' };
  }
  const priorityRaw = String(formData.get('priority') ?? '');
  const priority = (['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).includes(priorityRaw as never)
    ? (priorityRaw as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT')
    : undefined;
  const dueDateRaw = String(formData.get('dueDate') ?? '').trim();
  const dueDate = dueDateRaw.length > 0 ? new Date(dueDateRaw) : undefined;
  const dueTimezoneRaw = String(formData.get('dueTimezone') ?? '').trim();
  const dueTimezone = dueTimezoneRaw.length > 0 ? dueTimezoneRaw : undefined;

  const result = await withSession(async ({ db, accountId }) => {
    const task = await createTask(db, {
      actorAccountId: accountId,
      missionId,
      description,
      ...(priority ? { priority } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(dueTimezone ? { dueTimezone } : {}),
    });
    if (!task.ok) return { ok: false, message: task.error.message } satisfies ActionState;
    return { ok: true, message: 'Task added.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/** Move a task through OPEN -> IN_PROGRESS -> DONE/CANCELLED. */
export async function decideTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const taskId = String(formData.get('taskId') ?? '');
  const status = String(formData.get('status') ?? '') as 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  if (missionId.length === 0 || taskId.length === 0) {
    return { ok: false, message: 'Missing task.' };
  }
  const result = await withSession(async ({ db, accountId }) => {
    const decided = await decideTask(db, { actorAccountId: accountId, missionId, taskId, status });
    if (!decided.ok) return { ok: false, message: decided.error.message } satisfies ActionState;
    const messages: Record<typeof status, string> = {
      IN_PROGRESS: 'Task started.',
      DONE: 'Task completed.',
      CANCELLED: 'Task cancelled.',
    };
    return { ok: true, message: messages[status] } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/** Schedule an appointment tied to the mission (Commercial V1 Part 4 §11). */
export async function createAppointmentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const localDate = String(formData.get('localDate') ?? '').trim();
  const localTime = String(formData.get('localTime') ?? '').trim();
  const timezone = String(formData.get('timezone') ?? '').trim();
  if (missionId.length === 0 || title.length === 0 || !localDate || !localTime || !timezone) {
    return { ok: false, message: 'Title, date, time, and timezone are required.' };
  }
  // The literal wall-clock instant, deliberately parsed with no timezone
  // suffix (never `Z`/offset) so it round-trips as the same local date/time
  // regardless of the server's own timezone -- `timezone` above is what
  // gives it meaning, not this raw value.
  const localDateTime = new Date(`${localDate}T${localTime}:00`);
  if (Number.isNaN(localDateTime.getTime())) {
    return { ok: false, message: 'Invalid date or time.' };
  }
  const place = String(formData.get('place') ?? '').trim();
  const channel = String(formData.get('channel') ?? '').trim();

  const result = await withSession(async ({ db, accountId }) => {
    const appointment = await createAppointment(db, {
      actorAccountId: accountId,
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
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/** Mark an appointment DONE or CANCELLED. */
export async function decideAppointmentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const appointmentId = String(formData.get('appointmentId') ?? '');
  const status = String(formData.get('status') ?? '') as 'DONE' | 'CANCELLED';
  if (missionId.length === 0 || appointmentId.length === 0) {
    return { ok: false, message: 'Missing appointment.' };
  }
  const result = await withSession(async ({ db, accountId }) => {
    const decided = await decideAppointment(db, {
      actorAccountId: accountId,
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
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/** Set or clear the mission's itinerary reference, linking it (display-only) to other missions as one family trip (IAM-04). */
export async function setItineraryRefAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const itineraryRef = String(formData.get('itineraryRef') ?? '');
  if (missionId.length === 0) return { ok: false, message: 'Missing case.' };
  const result = await withSession(async ({ db, accountId }) => {
    const updated = await setMissionItineraryRef(db, {
      actorAccountId: accountId,
      missionId,
      itineraryRef,
    });
    if (!updated.ok) return { ok: false, message: updated.error.message } satisfies ActionState;
    return {
      ok: true,
      message: updated.value.itineraryRef ? 'Linked.' : 'Unlinked.',
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

function parseOptionalDate(value: FormDataEntryValue | null): Date | null | undefined {
  const raw = String(value ?? '').trim();
  if (raw.length === 0) return undefined; // leave the existing value untouched
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Update a mission's CAS-01 case-creation fields (mission owner only). Each field is optional; only what the form actually submits is changed. */
export async function updateCaseDetailsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  if (missionId.length === 0) return { ok: false, message: 'Missing case.' };
  const jurisdiction = String(formData.get('jurisdiction') ?? '');
  const serviceCategory = String(formData.get('serviceCategory') ?? '');
  const travelStartDate = parseOptionalDate(formData.get('travelStartDate'));
  const travelEndDate = parseOptionalDate(formData.get('travelEndDate'));
  const targetDeadline = parseOptionalDate(formData.get('targetDeadline'));
  const manualMode = formData.get('manualMode') === 'true';

  const result = await withSession(async ({ db, accountId }) => {
    const updated = await updateMissionCaseDetails(db, {
      actorAccountId: accountId,
      missionId,
      jurisdiction,
      serviceCategory,
      ...(travelStartDate !== undefined ? { travelStartDate } : {}),
      ...(travelEndDate !== undefined ? { travelEndDate } : {}),
      ...(targetDeadline !== undefined ? { targetDeadline } : {}),
      manualMode,
    });
    if (!updated.ok) return { ok: false, message: updated.error.message } satisfies ActionState;
    return { ok: true, message: 'Case details updated.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/** Ask a named third party (a sponsor, a family member) for exactly one piece of evidence on this case (CAS-08). */
export async function createContributorRequestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const contributorEmail = String(formData.get('contributorEmail') ?? '').trim();
  const docType = String(formData.get('docType') ?? '').trim();
  const purpose = String(formData.get('purpose') ?? '').trim();
  const message = String(formData.get('message') ?? '').trim();
  if (missionId.length === 0) return { ok: false, message: 'Missing case.' };
  if (contributorEmail.length === 0)
    return { ok: false, message: "Enter the contributor's email." };
  if (docType.length === 0) return { ok: false, message: 'Name exactly what document is needed.' };
  if (purpose.length === 0) {
    return { ok: false, message: 'Explain why this is needed - the contributor will see this.' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const created = await createContributorRequest(db, {
      actorAccountId: accountId,
      missionId,
      contributorEmail,
      docType,
      purpose,
      ...(message.length > 0 ? { message } : {}),
    });
    if (!created.ok) return { ok: false, message: created.error.message } satisfies ActionState;
    const acceptUrl = `${resolveBaseUrl()}/app/contributor-requests/accept?token=${created.value.rawToken}`;
    return {
      ok: true,
      message: `Request created. Share this link with ${contributorEmail} (expires in 7 days): ${acceptUrl}`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/** Revoke a still-pending contributor request (mission owner only). */
export async function revokeContributorRequestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  if (missionId.length === 0 || requestId.length === 0) {
    return { ok: false, message: 'Missing request.' };
  }
  const result = await withSession(async ({ db, accountId }) => {
    const revoked = await revokeContributorRequest(db, {
      actorAccountId: accountId,
      missionId,
      requestId,
    });
    if (!revoked.ok) return { ok: false, message: revoked.error.message } satisfies ActionState;
    return { ok: true, message: 'Request revoked.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

const OUTCOME_DECISIONS = ['APPROVED', 'REFUSED', 'WITHDRAWN', 'CANCELLED', 'OTHER'] as const;
type OutcomeDecision = (typeof OUTCOME_DECISIONS)[number];
function isOutcomeDecision(value: string): value is OutcomeDecision {
  return (OUTCOME_DECISIONS as readonly string[]).includes(value);
}

/** Record a real-world case decision (TRU-04 §8) - a fact about the outcome, never a workflow position. */
export async function recordOutcomeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const decisionRaw = String(formData.get('decision') ?? '');
  const decisionDateRaw = String(formData.get('decisionDate') ?? '').trim();
  const officialWording = String(formData.get('officialWording') ?? '').trim();
  const agencyInterpretation = String(formData.get('agencyInterpretation') ?? '').trim();
  const evidenceDocumentId = String(formData.get('evidenceDocumentId') ?? '').trim();
  if (missionId.length === 0 || !isOutcomeDecision(decisionRaw) || decisionDateRaw.length === 0) {
    return { ok: false, message: 'A decision and decision date are required.' };
  }
  const decisionDate = new Date(decisionDateRaw);
  if (Number.isNaN(decisionDate.getTime())) {
    return { ok: false, message: 'Invalid decision date.' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'MISSION_OUTCOME', resourceId: missionId },
      `/app/mission/${missionId}`,
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);

    const recorded = await recordOutcome(db, {
      actorAccountId: accountId,
      missionId,
      decision: decisionRaw,
      decisionDate,
      ...(officialWording.length > 0 ? { officialWording } : {}),
      ...(agencyInterpretation.length > 0 ? { agencyInterpretation } : {}),
      ...(evidenceDocumentId.length > 0 ? { evidenceDocumentId } : {}),
      stepUpSatisfied: true,
    });
    if (!recorded.ok) return { ok: false, message: recorded.error.message } satisfies ActionState;
    return { ok: true, message: 'Outcome recorded.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

const SUBMISSION_CHANNELS = [
  'EMBASSY_PORTAL',
  'EMAIL',
  'IN_PERSON',
  'COURIER',
  'VISA_APPLICATION_CENTER',
  'OTHER',
] as const;
type SubmissionChannel = (typeof SUBMISSION_CHANNELS)[number];
function isSubmissionChannel(value: string): value is SubmissionChannel {
  return (SUBMISSION_CHANNELS as readonly string[]).includes(value);
}

/** Report that this case's live-acknowledged snapshot was actually submitted externally (TRU-04 §7) - the only path that ever moves a mission to SUBMITTED. */
export async function recordSubmissionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const channelRaw = String(formData.get('channel') ?? '');
  const externalReportDescription = String(formData.get('externalReportDescription') ?? '').trim();
  const externalReference = String(formData.get('externalReference') ?? '').trim();
  const submittedAtRaw = String(formData.get('submittedAt') ?? '').trim();
  if (
    missionId.length === 0 ||
    !isSubmissionChannel(channelRaw) ||
    externalReportDescription.length === 0
  ) {
    return {
      ok: false,
      message: 'A channel and description of how this was submitted are required.',
    };
  }
  let submittedAt: Date | undefined;
  if (submittedAtRaw.length > 0) {
    submittedAt = new Date(submittedAtRaw);
    if (Number.isNaN(submittedAt.getTime()))
      return { ok: false, message: 'Invalid submitted date.' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'MISSION_SUBMISSION', resourceId: missionId },
      `/app/mission/${missionId}`,
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);

    const recorded = await recordSubmission(db, {
      actorAccountId: accountId,
      missionId,
      channel: channelRaw,
      externalReportDescription,
      ...(externalReference.length > 0 ? { externalReference } : {}),
      ...(submittedAt ? { submittedAt } : {}),
      stepUpSatisfied: true,
    });
    if (!recorded.ok) return { ok: false, message: recorded.error.message } satisfies ActionState;
    return { ok: true, message: 'Submission report recorded.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/** File a case complaint (TRU-04 §9) - owner-only, no step-up (not a destructive/security-sensitive action). */
export async function fileComplaintAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  if (missionId.length === 0 || description.length === 0) {
    return { ok: false, message: 'Describe the complaint.' };
  }
  const result = await withSession(async ({ db, accountId }) => {
    const filed = await fileComplaint(db, { actorAccountId: accountId, missionId, description });
    if (!filed.ok) return { ok: false, message: filed.error.message } satisfies ActionState;
    return { ok: true, message: 'Complaint filed.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/** Withdraw a complaint this same account filed, while it's still open or in progress. */
export async function withdrawComplaintAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const complaintId = String(formData.get('complaintId') ?? '');
  if (missionId.length === 0 || complaintId.length === 0) {
    return { ok: false, message: 'Missing complaint.' };
  }
  const result = await withSession(async ({ db, accountId }) => {
    const withdrawn = await withdrawOwnComplaint(db, { actorAccountId: accountId, complaintId });
    if (!withdrawn.ok) return { ok: false, message: withdrawn.error.message } satisfies ActionState;
    return { ok: true, message: 'Complaint withdrawn.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/** Submit private post-case feedback (TRU-04 §9) - never visible to the agency being reviewed, only the submitter and QUALITY_ADMIN staff. */
export async function submitFeedbackAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const comments = String(formData.get('comments') ?? '').trim();
  if (missionId.length === 0 || comments.length === 0) {
    return { ok: false, message: 'Enter your feedback.' };
  }
  const result = await withSession(async ({ db, accountId }) => {
    const submitted = await submitFeedback(db, { actorAccountId: accountId, missionId, comments });
    if (!submitted.ok) return { ok: false, message: submitted.error.message } satisfies ActionState;
    return { ok: true, message: 'Feedback submitted. Thank you.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/** Generate a new, versioned cover letter grounded in the mission's current satisfied evidence. */
export async function generateLetterAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  if (missionId.length === 0) return { ok: false, message: 'Missing case.' };
  const result = await withSession(async ({ db, accountId }) => {
    const output = await generateCoverLetter(db, { actorAccountId: accountId, missionId });
    if (!output.ok) return { ok: false, message: output.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `Letter version ${output.value.version} generated.`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/**
 * Explain an already-determined readiness gap in plain language (Part 8
 * AI-01 item 5). Never trusts a client-supplied state/citation -- re-derives
 * both from a fresh `computeReadiness` call plus the pack requirement's own
 * row, exactly like the mission page's own read path, so the explanation is
 * always grounded in the CURRENT, server-verified determination, never a
 * stale or spoofed one. Refuses (mirroring the page's own gating) unless the
 * gap is genuinely CRITICAL_GAP or ATTENTION -- the only two states this
 * task covers (see `AiExplainInput`'s own doc comment in ai.ts).
 */
export async function explainReadinessGapAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const packRequirementId = String(formData.get('packRequirementId') ?? '');
  if (missionId.length === 0 || packRequirementId.length === 0) {
    return { ok: false, message: 'Missing case or requirement.' };
  }

  const result = await withSession(async ({ db, accountId }) => {
    const mission = await getMissionForOwner(db, accountId, missionId);
    if (!mission.ok) return { ok: false, message: mission.error.message } satisfies ActionState;
    if (!mission.value.packVersionId) {
      return {
        ok: false,
        message: 'This case has no attached pack version.',
      } satisfies ActionState;
    }

    const [readiness, requirements] = await Promise.all([
      computeReadiness(db, missionId),
      listRequirements(db, mission.value.packVersionId),
    ]);
    if (!readiness.ok) return { ok: false, message: readiness.error.message } satisfies ActionState;

    const current = readiness.value.requirementResults.find(
      (r) => r.packRequirementId === packRequirementId,
    );
    const requirementRow = requirements.find((r) => r.id === packRequirementId);
    if (!current || !requirementRow) {
      return { ok: false, message: 'Requirement not found on this case.' } satisfies ActionState;
    }
    if (current.state !== 'CRITICAL_GAP' && current.state !== 'ATTENTION') {
      return {
        ok: false,
        message: 'This requirement is no longer in a gap state -- nothing to explain.',
      } satisfies ActionState;
    }

    const resolved = await resolveAiExplainer(db, createKeyManagementPort());
    if (!resolved) {
      return { ok: false, message: 'AI explanation is not configured.' } satisfies ActionState;
    }

    const explained = await explainReadinessGap(db, resolved.ai, {
      actorAccountId: accountId,
      packRequirementId,
      requirementKind: current.kind,
      requirementKey: current.key,
      state: current.state,
      citation: requirementRow.citation,
      optional: current.optional,
      budgetLimitUnits: resolved.limits.budgetLimitUnits,
      maxConcurrentCalls: resolved.limits.maxConcurrentCalls,
      cacheMaxAgeDays: resolved.limits.cacheMaxAgeDays,
      killSwitchCheck: () => isAiDispatchAllowed(db),
    });
    if (!explained.ok) {
      return { ok: false, message: explained.error.message } satisfies ActionState;
    }
    return { ok: true, message: 'Explanation ready below.' } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}
