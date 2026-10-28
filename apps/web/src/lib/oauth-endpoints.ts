import 'server-only';
import {
  type AiOAuthError,
  type Db,
  RATE_LIMITS,
  checkRateLimit,
  exchangeAiAuthorizationCode,
  isMissingRelationError,
  refreshAiTokens,
  registerAiClient,
  revokeAiToken,
  touchAiClient,
} from '@visastack/services';
import {
  aiConnectorEnabled,
  aiResource,
  noStoreJson,
  notFound,
  readOAuthForm,
} from './ai-connector';
import { clientAddressFrom, hashedSubject } from './client-address';
import { withPublicDb } from './public-db';
import { reportServerError } from './server-error';

/**
 * The token and revocation endpoints of the AI connector's sign-in (ADR 0021 section 2). Thin:
 * every rule lives in the token store (`access/ai-connection.ts`). Dependencies are injectable so
 * tests run without a database or the switch.
 */
export interface OAuthEndpointDeps {
  readonly enabled: () => boolean;
  readonly withDb: <T>(work: (db: Db) => Promise<T>) => Promise<T>;
  readonly resource: () => string;
}

const defaults: OAuthEndpointDeps = {
  enabled: () => aiConnectorEnabled(),
  withDb: withPublicDb,
  resource: aiResource,
};

/** One parameter of a checked form (a variable key keeps both the type checker and lint happy). */
function field(form: Readonly<Record<string, string>>, name: string): string | undefined {
  return form[name];
}

function busy(): Response {
  return noStoreJson({ error: SLOW_DOWN.error, error_description: SLOW_DOWN.description }, 429, {
    'retry-after': '60',
  });
}

function oauthFailure(error: AiOAuthError | { error: string; description: string }): Response {
  const status =
    error.error === 'invalid_client' ? 401 : error.error === 'temporarily_unavailable' ? 503 : 400;
  return noStoreJson({ error: error.error, error_description: error.description }, status);
}

const BAD_BODY = {
  error: 'invalid_request',
  description:
    'Send a form-encoded body (application/x-www-form-urlencoded) with each parameter once.',
} as const;

async function withinTokenLimit(db: Db, request: Request): Promise<boolean> {
  const decision = await checkRateLimit(
    db,
    {
      subjectId: hashedSubject('net', clientAddressFrom(request.headers)),
      action: 'ai.token_ip',
      label: 'ai',
    },
    RATE_LIMITS.AI_TOKEN_IP,
  );
  return decision.allowed;
}

// Not an OAuth refusal of the grant: a busy signal, so apps retry instead of dropping the sign-in.
const SLOW_DOWN = {
  error: 'temporarily_unavailable',
  description: 'Too many requests. Try again shortly.',
};

/** `POST /oauth/token`: `authorization_code` (PKCE S256 required) and `refresh_token`. */
export async function handleTokenRequest(
  request: Request,
  deps: OAuthEndpointDeps = defaults,
): Promise<Response> {
  if (!deps.enabled()) return notFound();
  const form = await readOAuthForm(request);
  if (!form) return oauthFailure(BAD_BODY);
  const clientId = field(form, 'client_id');
  if (!clientId) {
    return oauthFailure({ error: 'invalid_client', description: 'client_id is required' });
  }
  if (field(form, 'client_secret') !== undefined) {
    return oauthFailure({
      error: 'invalid_client',
      description: 'only public clients are supported (token_endpoint_auth_method none)',
    });
  }
  const grant = field(form, 'grant_type');
  try {
    return await deps.withDb(async (db) => {
      if (!(await withinTokenLimit(db, request))) return busy();
      if (grant === 'authorization_code') {
        const code = field(form, 'code');
        const verifier = field(form, 'code_verifier');
        const redirectUri = field(form, 'redirect_uri');
        const resource = field(form, 'resource');
        if (!code || !verifier || !redirectUri) {
          return oauthFailure({
            error: 'invalid_request',
            description: 'code, code_verifier and redirect_uri are required',
          });
        }
        if (!resource) {
          return oauthFailure({ error: 'invalid_target', description: 'resource is required' });
        }
        if (resource !== deps.resource()) {
          return oauthFailure({ error: 'invalid_target', description: 'unknown resource' });
        }
        const result = await exchangeAiAuthorizationCode(db, {
          code,
          codeVerifier: verifier,
          clientId,
          redirectUri,
          resource,
        });
        if (!result.ok) return oauthFailure(result.error);
        await touchAiClient(db, clientId);
        return noStoreJson(result.value);
      }
      if (grant === 'refresh_token') {
        const refreshToken = field(form, 'refresh_token');
        if (!refreshToken) {
          return oauthFailure({
            error: 'invalid_request',
            description: 'refresh_token is required',
          });
        }
        const resource = field(form, 'resource');
        if (resource !== undefined && resource !== deps.resource()) {
          return oauthFailure({ error: 'invalid_target', description: 'unknown resource' });
        }
        const result = await refreshAiTokens(db, {
          refreshToken,
          clientId,
          ...(resource !== undefined ? { resource } : {}),
        });
        if (!result.ok) return oauthFailure(result.error);
        await touchAiClient(db, clientId);
        return noStoreJson(result.value);
      }
      return oauthFailure({
        error: 'unsupported_grant_type',
        description: 'use authorization_code or refresh_token',
      });
    });
  } catch (error) {
    reportServerError('aiTokenEndpoint', error, { step: 'token request failed' });
    return oauthFailure({ error: 'temporarily_unavailable', description: 'Try again later.' });
  }
}

/** `POST /oauth/revoke` (RFC 7009): always 200 for a well-formed request, known token or not. */
export async function handleRevokeRequest(
  request: Request,
  deps: OAuthEndpointDeps = defaults,
): Promise<Response> {
  if (!deps.enabled()) return notFound();
  const form = await readOAuthForm(request);
  if (!form) return oauthFailure(BAD_BODY);
  const token = field(form, 'token');
  if (!token) return oauthFailure({ error: 'invalid_request', description: 'token is required' });
  const clientId = field(form, 'client_id');
  try {
    return await deps.withDb(async (db) => {
      if (!(await withinTokenLimit(db, request))) return busy();
      const result = await revokeAiToken(db, { token, ...(clientId ? { clientId } : {}) });
      return result.ok ? noStoreJson({}) : oauthFailure(result.error);
    });
  } catch (error) {
    reportServerError('aiRevokeEndpoint', error, { step: 'revocation failed' });
    return oauthFailure({ error: 'temporarily_unavailable', description: 'Try again later.' });
  }
}

const MAX_REGISTRATION_CHARS = 16 * 1024;

/**
 * `POST /oauth/register` (RFC 7591 Dynamic Client Registration): public clients only, return
 * addresses on a supported AI app or this computer, rate limited per network address. Claude and
 * ChatGPT prefer their published client documents; this is the fallback they also support.
 */
export async function handleRegisterRequest(
  request: Request,
  deps: OAuthEndpointDeps = defaults,
): Promise<Response> {
  if (!deps.enabled()) return notFound();
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  const invalid = (description: string) =>
    noStoreJson({ error: 'invalid_client_metadata', error_description: description }, 400);
  if (type !== 'application/json') return invalid('send application/json');
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return invalid('the body could not be read');
  }
  if (raw.length > MAX_REGISTRATION_CHARS) return invalid('the registration is too large');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return invalid('the body is not valid JSON');
  }
  try {
    return await deps.withDb(async (db) => {
      const result = await registerAiClient(db, {
        body,
        ipSubject: hashedSubject('net', clientAddressFrom(request.headers)),
      });
      if (result.ok) return noStoreJson(result.value, 201);
      const status = result.error.error === 'rate_limited' ? 429 : 400;
      return noStoreJson(result.error, status);
    });
  } catch (error) {
    if (isMissingRelationError(error)) {
      return noStoreJson(
        { error: 'temporarily_unavailable', error_description: 'Try again later.' },
        503,
      );
    }
    reportServerError('aiRegisterEndpoint', error, { step: 'registration failed' });
    return noStoreJson(
      { error: 'temporarily_unavailable', error_description: 'Try again later.' },
      503,
    );
  }
}
