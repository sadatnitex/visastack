import { switchOn } from '@visastack/core';
import 'server-only';
import { AI_OAUTH_SCOPES_SUPPORTED } from '@visastack/services';
import { resolveBaseUrl } from './base-url';

/**
 * The AI connector's switch and public addresses (ADR 0021). Off unless AI_CONNECTOR_ENABLED is
 * exactly "true": while off, every sign-in and discovery address answers "not found", so no AI
 * app can start connecting.
 */
export function aiConnectorEnabled(
  read: (name: string) => string | undefined = (name) => process.env[name],
): boolean {
  return switchOn(read('AI_CONNECTOR_ENABLED'));
}

/** The issuer: VisaStack itself, at its canonical address, with no trailing slash. */
export function aiIssuer(): string {
  return resolveBaseUrl().replace(/\/+$/, '');
}

/** The one resource every token is bound to: the AI context address. */
export function aiResource(): string {
  return `${aiIssuer()}/mcp`;
}

/** RFC 8414 authorization server metadata, with what Claude and ChatGPT check for. */
export function authorizationServerMetadata() {
  const issuer = aiIssuer();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: AI_OAUTH_SCOPES_SUPPORTED,
    service_documentation: `${issuer}/trust`,
  };
}

/** RFC 9728 protected resource metadata for the AI context address. */
export function protectedResourceMetadata() {
  return {
    resource: aiResource(),
    authorization_servers: [aiIssuer()],
    scopes_supported: AI_OAUTH_SCOPES_SUPPORTED,
    bearer_methods_supported: ['header'],
    resource_name: 'VisaStack',
  };
}

/** JSON answers that no cache or browser keeps (RFC 6749 section 5.1). */
export function noStoreJson(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', pragma: 'no-cache', ...extra },
  });
}

/** Discovery documents may be cached briefly by clients; they change only with a deployment. */
export function discoveryJson(body: unknown): Response {
  return Response.json(body, {
    headers: {
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
    },
  });
}

export function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
}

const MAX_FORM_CHARS = 8 * 1024;
const MAX_FORM_FIELDS = 20;

/**
 * A strict `application/x-www-form-urlencoded` body for the token and revocation endpoints:
 * bounded size, and a repeated parameter is refused (RFC 6749 section 3.2). `null` means
 * "invalid_request".
 */
export async function readOAuthForm(
  request: Request,
): Promise<Readonly<Record<string, string>> | null> {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return null;
  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_FORM_CHARS) return null;
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return null;
  }
  if (raw.length > MAX_FORM_CHARS) return null;
  const fields: Record<string, string> = Object.create(null) as Record<string, string>;
  let count = 0;
  for (const [name, value] of new URLSearchParams(raw)) {
    if (Object.hasOwn(fields, name) || ++count > MAX_FORM_FIELDS) return null;
    fields[name] = value;
  }
  return fields;
}
