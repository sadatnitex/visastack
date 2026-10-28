'use server';

import {
  AI_CONNECTION_LAYERS,
  type AiCaseMode,
  type AiConnectionLayer,
  type StepUpProof,
  accountPrincipal,
  changeAiConnection,
  getAiConnection,
  requireAccess,
  turnOffAiConnection,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormResult } from '../../../../../components/form-feedback';
import { aiConnectorEnabled } from '../../../../../lib/ai-connector';
import { consentChoicesToQuery, isAiChangeDuration } from '../../../../../lib/ai-consent-choices';
import { withSession } from '../../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, establishStepUpProof } from '../../../../../lib/step-up';

/** A form result that can also send the browser back to the refreshed Sharing page. */
export interface AiConnectionActionState extends FormResult {
  readonly refreshPath?: string;
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
 * the service; turning Full Document Numbers on asks for the same fresh identity check as consent.
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
  const layers = formData
    .getAll('layer')
    .filter((value): value is AiConnectionLayer =>
      (AI_CONNECTION_LAYERS as readonly unknown[]).includes(value),
    );
  const caseChoice = text(formData, 'cases') || 'all';
  const caseMode: AiCaseMode =
    caseChoice === 'none' ? 'NONE' : caseChoice === 'all' ? 'ALL_CURRENT' : 'ONE';
  const missionId = caseMode === 'ONE' ? caseChoice : undefined;
  if (missionId !== undefined && !UUID_RE.test(missionId)) {
    return { ok: false, message: 'Choose a case, all current cases or none.', field: 'cases' };
  }
  const duration = text(formData, 'duration') || 'keep';
  if (!isAiChangeDuration(duration)) {
    return { ok: false, message: 'Choose how long the app may read.', field: 'duration' };
  }
  const revealIdentifiers = formData.get('reveal_identifiers') === 'on';
  const documentList = formData.get('document_list') === 'on';
  const documentText = formData.get('document_text') === 'on';
  const choices = {
    layers,
    caseMode,
    ...(missionId !== undefined ? { missionId } : {}),
    documentList,
    documentText,
    revealIdentifiers,
    duration,
  };

  const outcome = await withSession(async ({ db, accountId }) => {
    let fullNumbersProof: StepUpProof | undefined;
    if (revealIdentifiers) {
      // Only a change from off to on needs the check; keeping it on does not.
      const current = await db.transaction(async (tx) => {
        const proof = await ownerGate(tx, accountId, applicantId);
        return proof ? getAiConnection(proof, connectionId) : null;
      });
      if (current === null) return { kind: 'denied' } as const;
      if (current.ok && !current.value.revealIdentifiers) {
        const back = new URLSearchParams(
          consentChoicesToQuery({
            layers,
            cases: caseChoice,
            documentList,
            documentText,
            revealIdentifiers,
            duration,
          }),
        );
        const stepUp = await establishStepUpProof(
          { accountId, action: 'EXPORT_PROFILE', resourceId: applicantId },
          `/app/applicant/${applicantId}/sharing?ai_change=${connectionId}&${back.toString()}#ai-connections`,
        );
        if (stepUp.kind === 'not_configured') return { kind: 'step_up_unavailable' } as const;
        if (stepUp.kind === 'reauth_required') {
          return { kind: 'reauth', url: stepUp.reauthUrl } as const;
        }
        fullNumbersProof = stepUp.proof;
      }
    }
    return db.transaction(async (tx) => {
      const proof = await ownerGate(tx, accountId, applicantId);
      if (!proof) return { kind: 'denied' } as const;
      const result = await changeAiConnection(proof, {
        connectionId,
        choices,
        ...(fullNumbersProof ? { stepUp: fullNumbersProof } : {}),
      });
      return result.ok ? ({ kind: 'done' } as const) : ({ kind: result.error.code } as const);
    });
  });

  if (outcome.kind === 'reauth') redirect(outcome.url);
  if (outcome.kind === 'step_up_unavailable') {
    return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE };
  }
  if (outcome.kind === 'denied' || outcome.kind === 'not_owner') {
    return { ok: false, message: 'Only the owner of this record can change its AI apps.' };
  }
  if (outcome.kind === 'unavailable') return NOT_AVAILABLE;
  if (outcome.kind === 'ended') {
    return {
      ok: false,
      message:
        'This connection has ended, so its access cannot be changed. Connect it again from the AI app.',
    };
  }
  if (outcome.kind === 'case_not_on_record' || outcome.kind === 'invalid') {
    return { ok: false, message: 'Choose a case, all current cases or none.', field: 'cases' };
  }
  if (outcome.kind === 'step_up_required') {
    return {
      ok: false,
      message:
        'To turn on Full Document Numbers, confirm it is you first: save again and sign in when asked.',
      field: 'reveal_identifiers',
    };
  }
  if (outcome.kind !== 'done') return NOT_FOUND;
  revalidatePath(`/app/applicant/${applicantId}/sharing`);
  return {
    ok: true,
    message: 'Access changed. The app gets the new access on its next request.',
    refreshPath: `/app/applicant/${applicantId}/sharing?ai=changed#ai-connections`,
  };
}
