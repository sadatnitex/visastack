'use server';

import {
  type CreateAgencyAiRefusal,
  createAgencyAiConnection,
  isAgencyAiConnectionDuration,
} from '@visastack/services';
import { redirect } from 'next/navigation';
import type { FormResult } from '../../../components/form-feedback';
import { aiConnectorEnabled } from '../../../lib/ai-connector';
import { authorizationResponseUrl, checkAuthorizeRequest } from '../../../lib/oauth-authorize';
import { withPublicDb } from '../../../lib/public-db';
import { withSession } from '../../../lib/session';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === 'string' && value.length <= 2048 ? value : undefined;
}

/** Plain words for each reason an agency connection was not made (typed reasons, never text). */
const REFUSED = {
  not_available: 'Connecting AI apps for an agency is not available yet. Try again later.',
  agency_member_ended: 'Only an active owner or admin of this agency can connect an AI app for it.',
  agency_not_active: 'This agency is not active, so an AI app cannot be connected for it.',
  agency_billing_suspended:
    'This agency’s billing is suspended, so its AI tools are paused. Settle the billing in Plan and Usage first.',
  agency_setting_off:
    'AI Connections for This Agency is turned off. An owner or admin can turn it on in the agency’s Settings.',
  agency_connection_expired: 'This could not be connected. Start again from the AI app.',
  feature_off: 'Agency AI Tools is turned off right now. Everything else works as usual.',
  invalid_request: 'Choose how long the app may read, then try again.',
} as const satisfies Readonly<Record<CreateAgencyAiRefusal, string>>;

/**
 * An agency owner or admin answered the agency consent screen (S22). Every part of the request is
 * checked again, and the agency in the form is re-checked on the server from live state (never
 * trusted): an active owner or admin membership, an active agency whose billing is not Suspended,
 * the agency's setting on, and Agency AI Tools on. Then the app is sent back with a single-use
 * code, or with `access_denied`.
 */
export async function answerAgencyAiConsentAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
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
  const organizationId = text(formData, 'agency') ?? '';
  if (!UUID_RE.test(organizationId)) {
    return { ok: false, message: 'Choose the agency to connect.' };
  }
  const duration = text(formData, 'duration');
  if (!isAgencyAiConnectionDuration(duration)) {
    return { ok: false, message: REFUSED.invalid_request, field: 'duration' };
  }
  const outcome = await withSession(({ db, accountId }) =>
    db.transaction((tx) =>
      createAgencyAiConnection(tx, {
        organizationId,
        accountId,
        client: {
          clientId: request.client.clientId,
          clientName: request.client.clientName,
          clientHost: request.client.host,
        },
        duration,
        codeChallenge: request.codeChallenge,
        redirectUri: request.redirectUri,
        resource: request.resource,
      }),
    ),
  );
  if (!outcome.ok) {
    return {
      ok: false,
      message: REFUSED[outcome.error],
    };
  }
  redirect(
    authorizationResponseUrl(request.redirectUri, { code: outcome.value.code }, request.state),
  );
}
