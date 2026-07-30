'use server';

import type { MissionState } from '@visastack/core';
import { attachPackVersion, snapshotMission, transitionMission } from '@visastack/services';
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
