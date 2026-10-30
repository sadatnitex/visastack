'use server';

import {
  type StepUpProof,
  accountPrincipal,
  createAiConnection,
  requireAccess,
} from '@visastack/services';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { FormResult } from '../../../components/form-feedback';
import { aiConnectorEnabled } from '../../../lib/ai-connector';
import {
  AI_CONNECTION_DEFAULT_DURATION,
  AI_CONNECTION_DURATIONS,
  type AiFileChoice,
  type ConsentInitial,
  consentChoicesToQuery,
  keptAiChoices,
  parseAiAccessChoices,
} from '../../../lib/ai-consent-choices';
import {
  AI_FILE_PICKS_CONSENT,
  AI_FILE_PICKS_COOKIE,
  aiFilePicksCookieOptions,
  encodeAiFilePicks,
} from '../../../lib/ai-file-picks-retry';
import { resolveBaseUrl } from '../../../lib/base-url';
import { authorizationResponseUrl, checkAuthorizeRequest } from '../../../lib/oauth-authorize';
import { withPublicDb } from '../../../lib/public-db';
import { withSession } from '../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, establishStepUpProof } from '../../../lib/step-up';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The consent screen's page: the only page that receives the ticked files kept across sign-in. */
const CONSENT_PATH = '/oauth/authorize';

/** A consent answer that can also give the screen back what was chosen, after React resets it. */
export interface ConsentActionState extends FormResult {
  readonly choices?: ConsentInitial;
  readonly files?: readonly AiFileChoice[];
}

/** Keeps the ticked files across the fresh sign-in check, never in the address. Best effort. */
async function rememberFiles(
  accountId: string,
  applicantId: string,
  files: readonly AiFileChoice[],
) {
  const value = encodeAiFilePicks({ applicantId, target: AI_FILE_PICKS_CONSENT, files }, accountId);
  if (!value) return;
  (await cookies()).set(
    AI_FILE_PICKS_COOKIE,
    value,
    aiFilePicksCookieOptions(resolveBaseUrl().startsWith('https://'), CONSENT_PATH),
  );
}

async function forgetFiles() {
  (await cookies()).delete({ name: AI_FILE_PICKS_COOKIE, path: CONSENT_PATH });
}

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === 'string' && value.length <= 2048 ? value : undefined;
}

/**
 * The person answered the consent screen. Every part of the request is checked again here (a
 * hidden field can never widen what the screen showed), the central access gate confirms the
 * person owns the record, and full document numbers need a fresh sign-in check. Then the app is
 * sent back with a single-use code, or with `access_denied`.
 */
export async function answerAiConsentAction(
  _prev: ConsentActionState,
  formData: FormData,
): Promise<ConsentActionState> {
  if (!aiConnectorEnabled()) return { ok: false, message: 'Connecting AI apps is turned off.' };
  const state = text(formData, 'state');
  const params = {
    response_type: 'code',
    client_id: text(formData, 'client_id'),
    redirect_uri: text(formData, 'redirect_uri'),
    code_challenge: text(formData, 'code_challenge'),
    code_challenge_method: 'S256',
    resource: text(formData, 'resource'),
    ...(state !== undefined ? { state } : {}),
  };
  const check = await withPublicDb((db) => checkAuthorizeRequest(db, params));
  if (check.kind === 'redirect') redirect(check.url);
  if (check.kind === 'refuse') {
    return {
      ok: false,
      message: 'This connection request is no longer valid. Start again from the AI app.',
    };
  }
  const { request } = check;
  if (formData.get('decision') !== 'allow') {
    redirect(
      authorizationResponseUrl(
        request.redirectUri,
        { error: 'access_denied', error_description: 'The person did not allow access' },
        request.state,
      ),
    );
  }

  const applicantId = text(formData, 'record') ?? '';
  if (!UUID_RE.test(applicantId)) return { ok: false, message: 'Choose the record to connect.' };
  const parsed = parseAiAccessChoices(formData);
  if (!parsed.ok) {
    // Typed values are kept: the screen starts again from what was submitted.
    const { files, duration, ...kept } = keptAiChoices(formData);
    const choices: ConsentInitial = {
      ...kept,
      duration: (AI_CONNECTION_DURATIONS as readonly string[]).includes(duration ?? '')
        ? (duration as ConsentInitial['duration'])
        : AI_CONNECTION_DEFAULT_DURATION,
    };
    return { ...parsed, choices, ...(files ? { files } : {}) };
  }
  const {
    layers,
    cases: caseChoice,
    caseMode,
    missionId,
    documentList,
    documentText,
    revealIdentifiers,
    suggestChanges,
    duration,
    files,
  } = parsed.value;
  const submitted: ConsentInitial = {
    layers,
    cases: caseChoice,
    documentList,
    documentText,
    revealIdentifiers,
    suggestChanges,
    duration,
  };
  // An Original under Original Files needs the same fresh identity check as full numbers (S20).
  const wantsOriginal = files?.some((file) => file.variant === 'ORIGINAL') === true;

  const outcome = await withSession(async ({ db, accountId }) => {
    let fullNumbersProof: StepUpProof | undefined;
    if (revealIdentifiers || wantsOriginal) {
      const back = new URLSearchParams({
        response_type: 'code',
        client_id: request.client.clientId,
        redirect_uri: request.redirectUri,
        code_challenge: request.codeChallenge,
        code_challenge_method: 'S256',
        resource: request.resource,
        record: applicantId,
        ...(request.state !== null ? { state: request.state } : {}),
        // The person's choices come back with them, so the check never resets the screen.
        ...consentChoicesToQuery({
          layers,
          cases: caseChoice,
          documentList,
          documentText,
          revealIdentifiers,
          suggestChanges,
          duration,
        }),
      });
      // The same check, and the same proof, the record's own export asks for before showing a
      // full number: the connection keeps that right only because the person passed it here.
      const stepUp = await establishStepUpProof(
        { accountId, action: 'EXPORT_PROFILE', resourceId: applicantId },
        `/oauth/authorize?${back.toString()}`,
      );
      if (stepUp.kind === 'not_configured') return { kind: 'step_up_unavailable' } as const;
      if (stepUp.kind === 'reauth_required') {
        if (files && files.length > 0) await rememberFiles(accountId, applicantId, files);
        return { kind: 'reauth', url: stepUp.reauthUrl } as const;
      }
      fullNumbersProof = stepUp.proof;
    }
    return db.transaction(async (tx) => {
      const proof = await requireAccess(
        tx,
        accountPrincipal(accountId),
        'VIEW_METADATA',
        { applicantId },
        { purpose: 'ai_connection' },
      );
      if (!proof.ok || proof.value.actor.kind !== 'applicant_owner')
        return { kind: 'denied' } as const;
      const created = await createAiConnection(proof.value, {
        client: {
          clientId: request.client.clientId,
          clientName: request.client.clientName,
          clientHost: request.client.host,
        },
        choices: {
          layers,
          caseMode,
          ...(missionId !== undefined ? { missionId } : {}),
          documentList,
          documentText,
          revealIdentifiers,
          suggestChanges,
          duration,
          ...(files ? { files } : {}),
        },
        codeChallenge: request.codeChallenge,
        redirectUri: request.redirectUri,
        resource: request.resource,
        ...(fullNumbersProof ? { stepUp: fullNumbersProof } : {}),
      });
      return created.ok
        ? ({ kind: 'created', code: created.value.code } as const)
        : ({
            kind: 'failed',
            unavailable: created.error.error === 'temporarily_unavailable',
          } as const);
    });
  });

  if (outcome.kind === 'reauth') redirect(outcome.url);
  const kept = { choices: submitted, ...(files ? { files } : {}) };
  if (outcome.kind === 'step_up_unavailable') {
    return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE, ...kept };
  }
  if (outcome.kind === 'denied') {
    return { ok: false, message: 'Only your own records can be connected.', ...kept };
  }
  if (outcome.kind === 'failed') {
    return {
      ok: false,
      message: outcome.unavailable
        ? 'Connecting AI apps is not available yet. Try again later.'
        : 'This could not be connected. Check your choices and try again.',
      ...kept,
    };
  }
  await forgetFiles();
  redirect(authorizationResponseUrl(request.redirectUri, { code: outcome.code }, request.state));
}
