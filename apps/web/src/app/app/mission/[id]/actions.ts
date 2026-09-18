'use server';

import type { MissionState } from '@visastack/core';
import {
  attachPackVersion,
  createTask,
  decideTask,
  generateCoverLetter,
  selectEvidence,
  setMissionItineraryRef,
  snapshotMission,
  transitionMission,
  unselectEvidence,
  updateMissionCaseDetails,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { withSession } from '../../../../lib/session';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

const STATE_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
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
  if (missionId.length === 0 || to.length === 0) return { ok: false, message: 'Missing mission.' };
  const result = await withSession(async ({ db, accountId }) => {
    const transitioned = await transitionMission(db, { actorAccountId: accountId, missionId, to });
    if (!transitioned.ok) {
      return { ok: false, message: transitioned.error.message } satisfies ActionState;
    }
    return {
      ok: true,
      message: `Mission moved to ${STATE_LABELS[to] ?? to}.`,
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
  if (missionId.length === 0) return { ok: false, message: 'Missing mission.' };
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
  const result = await withSession(async ({ db, accountId }) => {
    const task = await createTask(db, { actorAccountId: accountId, missionId, description });
    if (!task.ok) return { ok: false, message: task.error.message } satisfies ActionState;
    return { ok: true, message: 'Task added.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/mission/${missionId}`);
  return result;
}

/** Mark a task DONE or CANCELLED. */
export async function decideTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  const taskId = String(formData.get('taskId') ?? '');
  const status = String(formData.get('status') ?? '') as 'DONE' | 'CANCELLED';
  if (missionId.length === 0 || taskId.length === 0) {
    return { ok: false, message: 'Missing task.' };
  }
  const result = await withSession(async ({ db, accountId }) => {
    const decided = await decideTask(db, { actorAccountId: accountId, missionId, taskId, status });
    if (!decided.ok) return { ok: false, message: decided.error.message } satisfies ActionState;
    return {
      ok: true,
      message: status === 'DONE' ? 'Task completed.' : 'Task cancelled.',
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
  if (missionId.length === 0) return { ok: false, message: 'Missing mission.' };
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
  if (missionId.length === 0) return { ok: false, message: 'Missing mission.' };
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

/** Generate a new, versioned cover letter grounded in the mission's current satisfied evidence. */
export async function generateLetterAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = String(formData.get('missionId') ?? '');
  if (missionId.length === 0) return { ok: false, message: 'Missing mission.' };
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
