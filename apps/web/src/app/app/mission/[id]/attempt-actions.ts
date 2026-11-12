'use server';

import {
  accountPrincipal,
  recordAttemptEvent,
  recordOutcomeAttempt,
  requireAccess,
  trackSubmissionAsAttempt,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import type { FormResult } from '../../../../components/form-feedback';
import { reportServerError } from '../../../../lib/server-error';
import { refusalText } from '../../../../lib/service-error-message';
import { withSession } from '../../../../lib/session';

/**
 * UMPE P12: the Application Attempts card's three actions (track a submission report as an
 * attempt, record another attempt, record what happened after one). Each runs through the access
 * gate for the owner of this one case; the service checks everything again. No fresh sign-in is
 * asked for: these are the person's own reports about their own case, append-only, and they show
 * nothing new to anyone.
 */

type ActionState = FormResult;

const CASE_UNAVAILABLE = 'This case is not available to you.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function withCaseProof(
  missionId: string,
  run: (proof: Parameters<typeof recordOutcomeAttempt>[0]) => Promise<ActionState>,
): Promise<ActionState> {
  if (!UUID.test(missionId)) return { ok: false, message: CASE_UNAVAILABLE };
  try {
    const outcome = await withSession(async ({ db, accountId }) => {
      const proof = await requireAccess(
        db,
        accountPrincipal(accountId),
        'MANAGE',
        { missionId },
        { purpose: 'self' },
      );
      if (!proof.ok) return { ok: false, message: CASE_UNAVAILABLE } satisfies ActionState;
      return run(proof.value);
    });
    if (outcome.ok) revalidatePath(`/app/mission/${missionId}`);
    return outcome;
  } catch (error) {
    unstable_rethrow(error);
    reportServerError('outcomeAttemptAction', error);
    return { ok: false, message: 'Something went wrong. Try again.' };
  }
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

export async function trackReportAsAttemptAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = text(formData, 'missionId');
  const missionSubmissionId = text(formData, 'missionSubmissionId');
  return withCaseProof(missionId, async (proof) => {
    const tracked = await trackSubmissionAsAttempt(proof, { missionId, missionSubmissionId });
    if (!tracked.ok) return { ok: false, message: await refusalText(tracked.error) };
    return { ok: true, message: `Added as Attempt ${tracked.value.attemptNo}.` };
  });
}

export async function recordAttemptAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = text(formData, 'missionId');
  const channel = text(formData, 'channel');
  const submittedOn = text(formData, 'submittedOn');
  const evidence = text(formData, 'evidenceVersionId');
  if (channel.length === 0)
    return { ok: false, message: 'Choose how it was sent.', field: 'channel' };
  if (submittedOn.length === 0) {
    return { ok: false, message: 'Enter the day it was sent.', field: 'submittedOn' };
  }
  return withCaseProof(missionId, async (proof) => {
    const recorded = await recordOutcomeAttempt(proof, {
      missionId,
      channel,
      submittedOn,
      ...(evidence.length > 0 ? { evidenceDocumentVersionId: evidence } : {}),
    });
    if (!recorded.ok) return { ok: false, message: await refusalText(recorded.error) };
    return { ok: true, message: `Attempt ${recorded.value.attemptNo} recorded.` };
  });
}

export async function recordAttemptEventAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missionId = text(formData, 'missionId');
  const attemptId = text(formData, 'attemptId');
  const kind = text(formData, 'kind');
  const occurredOn = text(formData, 'occurredOn');
  const evidence = text(formData, 'evidenceVersionId');
  const decision = text(formData, 'decision');
  const requestSource = text(formData, 'requestSource');
  const requestedDocTypes = formData
    .getAll('docType')
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);
  if (kind.length === 0) return { ok: false, message: 'Choose what happened.', field: 'kind' };
  if (occurredOn.length === 0) {
    return { ok: false, message: 'Enter the day it happened.', field: 'occurredOn' };
  }
  if (kind === 'DECISION' && decision.length === 0) {
    return { ok: false, message: 'Choose the decision.', field: 'decision' };
  }
  if (kind === 'AUTHORITY_REQUEST' && requestSource.length === 0) {
    return { ok: false, message: 'Choose who asked for more.', field: 'requestSource' };
  }
  return withCaseProof(missionId, async (proof) => {
    const recorded = await recordAttemptEvent(proof, {
      missionId,
      attemptId,
      kind,
      occurredOn,
      ...(kind === 'DECISION' ? { decision } : {}),
      ...(kind === 'AUTHORITY_REQUEST' ? { requestSource, requestedDocTypes } : {}),
      ...(evidence.length > 0 ? { evidenceDocumentVersionId: evidence } : {}),
    });
    if (!recorded.ok) return { ok: false, message: await refusalText(recorded.error) };
    return { ok: true, message: 'Saved to this attempt.' };
  });
}
