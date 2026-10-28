'use server';

import {
  type StepUpProof,
  accountPrincipal,
  changeAiConnection,
  requireAccess,
  turnOffAiConnection,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormResult } from '../../../../../components/form-feedback';
import { aiConnectorEnabled } from '../../../../../lib/ai-connector';
import {
  type AiChangeDuration,
  type ConsentInitial,
  consentChoicesToQuery,
  parseAiAccessChoices,
} from '../../../../../lib/ai-consent-choices';
import { withSession } from '../../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, establishStepUpProof } from '../../../../../lib/step-up';

/** The Change Access choices as the person submitted them, so a retry shows (and saves) them. */
export type SubmittedAiChoices = Omit<ConsentInitial, 'duration'> & {
  readonly duration: AiChangeDuration;
};

/** A form result that can also send the browser back to the refreshed Sharing page. */
export interface AiConnectionActionState extends FormResult {
  readonly refreshPath?: string;
  /** Change Access only: what was submitted, kept after React resets the form. */
  readonly choices?: SubmittedAiChoices;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' && value.length <= 200 ? value : '';
}

const NOT_AVAILABLE: AiConnectionActionState = {
  ok: false,
  message: 'AI connections cannot be changed right now. Try again later.',
};
const NOT_FOUND: AiConnectionActionState = {
  ok: false,
  message: 'This AI connection was not found on this record. Reload the page.',
};

/** The owner's proof for this record from the central access gate, or nothing. */
async function ownerGate(
  db: Parameters<typeof requireAccess>[0],
  accountId: string,
  applicantId: string,
) {
  const gate = await requireAccess(
    db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { applicantId },
    { purpose: 'ai_connection' },
  );
  return gate.ok && gate.value.actor.kind === 'applicant_owner' ? gate.value : null;
}

/** Turn Off: the connection and every one of its sign-ins end now; the app's next request fails. */
export async function turnOffAiConnectionAction(
  _prev: AiConnectionActionState,
  formData: FormData,
): Promise<AiConnectionActionState> {
  const applicantId = text(formData, 'applicantId');
  const connectionId = text(formData, 'connectionId');
  if (!UUID_RE.test(applicantId) || !UUID_RE.test(connectionId)) return NOT_FOUND;
  const outcome = await withSession(({ db, accountId }) =>
    db.transaction(async (tx) => {
      const proof = await ownerGate(tx, accountId, applicantId);
      if (!proof) return { kind: 'denied' } as const;
      const result = await turnOffAiConnection(proof, { connectionId });
      return result.ok ? ({ kind: 'done' } as const) : ({ kind: result.error.code } as const);
    }),
  );
  if (outcome.kind === 'denied' || outcome.kind === 'not_owner') {
    return { ok: false, message: 'Only the owner of this record can turn off its AI apps.' };
  }
  if (outcome.kind === 'unavailable') return NOT_AVAILABLE;
  if (outcome.kind !== 'done') return NOT_FOUND;
  revalidatePath(`/app/applicant/${applicantId}/sharing`);
  return {
    ok: true,
    message: 'Turned off. The app can no longer read this record.',
    refreshPath: `/app/applicant/${applicantId}/sharing?ai=off#ai-connections`,
  };
}

/**
 * Change Access: the same choices as the consent screen. Every value is checked again here and in
 * the service. The service decides whether a fresh identity check is needed (only when Full
 * Document Numbers goes from off to on); if it is, the check runs with the person's choices kept,
 * and the change is tried again with its proof.
 */
export async function changeAiAccessAction(
  _prev: AiConnectionActionState,
  formData: FormData,
): Promise<AiConnectionActionState> {
  // Turning off always works; changing what an app reads only while connecting AI apps is on.
  if (!aiConnectorEnabled()) return { ok: false, message: 'Connecting AI apps is turned off.' };
  const applicantId = text(formData, 'applicantId');
  const connectionId = text(formData, 'connectionId');
  if (!UUID_RE.test(applicantId) || !UUID_RE.test(connectionId)) return NOT_FOUND;
  const parsed = parseAiAccessChoices(formData, { allowKeep: true });
  if (!parsed.ok) return parsed;
  const { caseMode, missionId, ...rest } = parsed.value;
  const submitted: SubmittedAiChoices = {
    layers: rest.layers,
    cases: rest.cases,
    documentList: rest.documentList,
    documentText: rest.documentText,
    revealIdentifiers: rest.revealIdentifiers,
    duration: rest.duration,
  };
  const choices = {
    layers: rest.layers,
    caseMode,
    ...(missionId !== undefined ? { missionId } : {}),
    documentList: rest.documentList,
    documentText: rest.documentText,
    revealIdentifiers: rest.revealIdentifiers,
    duration: rest.duration,
  };

  const outcome = await withSession(async ({ db, accountId }) => {
    const attempt = (stepUp?: StepUpProof) =>
      db.transaction(async (tx) => {
        const proof = await ownerGate(tx, accountId, applicantId);
        if (!proof) return { kind: 'denied' } as const;
        const result = await changeAiConnection(proof, {
          connectionId,
          choices,
          ...(stepUp ? { stepUp } : {}),
        });
        return result.ok ? ({ kind: 'done' } as const) : ({ kind: result.error.code } as const);
      });
    const first = await attempt();
    if (first.kind !== 'step_up_required') return first;
    // The same check, and the same proof, as the consent screen and the record's own export.
    const back = new URLSearchParams({
      ai_change: connectionId,
      ...consentChoicesToQuery(submitted),
    });
    const stepUp = await establishStepUpProof(
      { accountId, action: 'EXPORT_PROFILE', resourceId: applicantId },
      `/app/applicant/${applicantId}/sharing?${back.toString()}#ai-connections`,
    );
    if (stepUp.kind === 'not_configured') return { kind: 'step_up_unavailable' } as const;
    if (stepUp.kind === 'reauth_required')
      return { kind: 'reauth', url: stepUp.reauthUrl } as const;
    return attempt(stepUp.proof);
  });

  if (outcome.kind === 'reauth') redirect(outcome.url);
  const failed = (message: string, field?: string): AiConnectionActionState => ({
    ok: false,
    message,
    ...(field ? { field } : {}),
    choices: submitted,
  });
  if (outcome.kind === 'step_up_unavailable') return failed(STEP_UP_NOT_CONFIGURED_MESSAGE);
  if (outcome.kind === 'denied' || outcome.kind === 'not_owner') {
    return failed('Only the owner of this record can change its AI apps.');
  }
  if (outcome.kind === 'unavailable') return failed(NOT_AVAILABLE.message);
  if (outcome.kind === 'ended') {
    return failed(
      'This connection has ended, so its access cannot be changed. Connect it again from the AI app.',
    );
  }
  if (outcome.kind === 'case_not_on_record' || outcome.kind === 'invalid') {
    return failed('Choose a case, all current cases or none.', 'cases');
  }
  if (outcome.kind === 'step_up_required') {
    return failed(
      'To turn on Full Document Numbers, confirm it is you first: save again and sign in when asked.',
      'reveal_identifiers',
    );
  }
  if (outcome.kind !== 'done') return failed(NOT_FOUND.message);
  revalidatePath(`/app/applicant/${applicantId}/sharing`);
  return {
    ok: true,
    message: 'Access changed. The app gets the new access on its next request.',
    refreshPath: `/app/applicant/${applicantId}/sharing?ai=changed#ai-connections`,
  };
}
