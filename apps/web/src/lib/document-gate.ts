import 'server-only';
import {
  type ActingFor,
  type AuthorizedApplicant,
  type Db,
  EACH_GRANT,
  type RequireAccessOptions,
  type ServiceError,
  accountPrincipal,
  requireAccess,
} from '@visastack/services';
import { establishStepUpProof } from './step-up';

/**
 * The central access gate for one document, shared by the routes that make something from it on
 * request (Visa Photo Sizes and safe copies): every grant judged against its own purpose, through
 * the chosen relationship, and a fresh identity check when the document is restricted (at once
 * when the session is fresh, otherwise the caller is told where to confirm it is them).
 */

export const NO_STORE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
});

export function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { ...NO_STORE_HEADERS } });
}

/** A cross-site page must never be able to spend someone's session on this. */
export function isSameOrigin(request: Request): boolean {
  return request.headers.get('origin') === new URL(request.url).origin;
}

export type GatedAction = 'PREVIEW' | 'MANAGE' | 'DOWNLOAD_REDACTED';

export type DocumentAuthorization<A extends GatedAction> =
  | { readonly kind: 'ok'; readonly access: AuthorizedApplicant<A> }
  | { readonly kind: 'response'; readonly response: Response };

export function gateOptions(actingFor: ActingFor | undefined): RequireAccessOptions {
  return { purpose: EACH_GRANT, ...(actingFor !== undefined ? { actingFor } : {}) };
}

export interface DocumentGateRequest {
  readonly documentId: string;
  readonly actingFor: ActingFor | undefined;
  readonly returnTo: string;
}

export async function authorizeDocument<A extends GatedAction>(
  db: Db,
  accountId: string,
  action: A,
  input: DocumentGateRequest,
  words: {
    /** Said when a fresh identity check is needed, beside the Confirm It Is You link. */
    readonly reauth: string;
    readonly refused: (error: ServiceError) => Response;
  },
): Promise<DocumentAuthorization<A>> {
  const principal = accountPrincipal(accountId);
  const ref = { documentId: input.documentId };
  const options = gateOptions(input.actingFor);
  let result = await requireAccess(db, principal, action, ref, options);
  if (!result.ok && result.error.code === 'step_up_required') {
    const stepUp = await establishStepUpProof(
      { accountId, action, resourceId: input.documentId },
      input.returnTo,
    );
    if (stepUp.kind === 'reauth_required') {
      return {
        kind: 'response',
        response: jsonResponse({ message: words.reauth, reauthUrl: stepUp.reauthUrl }, 401),
      };
    }
    if (stepUp.kind === 'not_configured') {
      return {
        kind: 'response',
        response: jsonResponse({ message: 'This is not available here yet.' }, 503),
      };
    }
    result = await requireAccess(db, principal, action, ref, { ...options, stepUp: stepUp.proof });
  }
  if (!result.ok) return { kind: 'response', response: words.refused(result.error) };
  return { kind: 'ok', access: result.value };
}
