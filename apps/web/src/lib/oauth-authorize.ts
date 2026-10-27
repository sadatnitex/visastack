import 'server-only';
import { type Db, redirectMatches, resolveAiClient } from '@visastack/services';
import { aiIssuer, aiResource } from './ai-connector';

/**
 * Checks one authorization request (`/oauth/authorize`) the same way for the consent screen and
 * for its approve action, so a hidden field can never widen what the screen showed (ADR 0021
 * section 2). Order follows RFC 6749 section 4.1.2.1: an unknown app or a return address it does
 * not own is shown on our own page and never redirected to; every later problem goes back to the
 * app as an error, with `state` and `iss`.
 */

export interface AuthorizeParams {
  readonly response_type?: string | undefined;
  readonly client_id?: string | undefined;
  readonly redirect_uri?: string | undefined;
  readonly code_challenge?: string | undefined;
  readonly code_challenge_method?: string | undefined;
  readonly resource?: string | undefined;
  readonly state?: string | undefined;
  readonly scope?: string | undefined;
}

export interface CheckedAuthorizeRequest {
  readonly client: {
    readonly clientId: string;
    readonly clientName: string;
    readonly host: string;
    /** Every return address is on this computer: the screen warns about that. */
    readonly loopbackOnly: boolean;
  };
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly resource: string;
  readonly state: string | null;
}

export type AuthorizeCheck =
  | { readonly kind: 'ok'; readonly request: CheckedAuthorizeRequest }
  | { readonly kind: 'refuse'; readonly reason: 'unsupported_app' | 'invalid_link' | 'unavailable' }
  | { readonly kind: 'redirect'; readonly url: string };

const MAX_PARAM = 2048;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

/** The first value of a query parameter, or undefined when absent, repeated or oversized. */
export function singleParam(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_PARAM) return undefined;
  return value;
}

/** The app's return address with an authorization result added, keeping its own query. */
export function authorizationResponseUrl(
  redirectUri: string,
  result: Readonly<Record<string, string>>,
  state: string | null,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(result)) url.searchParams.set(key, value);
  if (state !== null) url.searchParams.set('state', state);
  url.searchParams.set('iss', aiIssuer());
  return url.toString();
}

export async function checkAuthorizeRequest(
  db: Db,
  params: AuthorizeParams,
): Promise<AuthorizeCheck> {
  const clientId = params.client_id;
  const redirectUri = params.redirect_uri;
  if (!clientId || !redirectUri) return { kind: 'refuse', reason: 'invalid_link' };
  const client = await resolveAiClient(db, clientId);
  if (!client.ok) {
    return {
      kind: 'refuse',
      reason:
        client.error.code === 'unsupported_app'
          ? 'unsupported_app'
          : client.error.code === 'unreachable'
            ? 'unavailable'
            : 'invalid_link',
    };
  }
  if (!redirectMatches(client.value.redirectUris, redirectUri)) {
    return { kind: 'refuse', reason: 'invalid_link' };
  }
  const state = params.state ?? null;
  const back = (error: string, description: string): AuthorizeCheck => ({
    kind: 'redirect',
    url: authorizationResponseUrl(redirectUri, { error, error_description: description }, state),
  });
  if (params.response_type !== 'code') {
    return back('unsupported_response_type', 'only response_type=code is supported');
  }
  if (params.code_challenge_method !== 'S256' || !params.code_challenge) {
    return back('invalid_request', 'PKCE with code_challenge_method=S256 is required');
  }
  if (!CHALLENGE_RE.test(params.code_challenge)) {
    return back('invalid_request', 'code_challenge must be a base64url SHA-256 value');
  }
  if (params.resource !== aiResource()) {
    return back('invalid_target', 'resource must be the VisaStack AI context address');
  }
  return {
    kind: 'ok',
    request: {
      client: {
        clientId: client.value.clientId,
        clientName: client.value.clientName,
        host: client.value.host,
        loopbackOnly: client.value.loopbackOnly,
      },
      redirectUri,
      codeChallenge: params.code_challenge,
      resource: params.resource,
      state,
    },
  };
}
