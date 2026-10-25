import 'server-only';
import { createPhotoSizer } from '@visastack/adapters';
import { type CropInput, clampCropInput } from '@visastack/core/photo-specs';
import {
  type ActingFor,
  type AuthorizedApplicant,
  type Db,
  EACH_GRANT,
  type PhotoSizingDeps,
  type RequireAccessOptions,
  type ServiceError,
  accountPrincipal,
  requireAccess,
} from '@visastack/services';
import { safeReturnPath } from './neon-recency';
import { establishStepUpProof } from './step-up';
import { createStorage } from './storage';

/**
 * Shared request handling for the two visa photo routes (api/documents/photo-check and
 * api/documents/photo-size): same-origin JSON bodies only, the central access gate with the exact
 * permission the service needs, a step-up when the document is restricted, and plain answers.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const NO_STORE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
});

export function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { ...NO_STORE_HEADERS } });
}

export interface PhotoRequest {
  readonly documentId: string;
  readonly actingFor: ActingFor | undefined;
  readonly returnTo: string;
  readonly specId: string | undefined;
  readonly crop: CropInput | undefined;
}

/** A cross-site page must never be able to spend someone's session on this. */
export function isSameOrigin(request: Request): boolean {
  return request.headers.get('origin') === new URL(request.url).origin;
}

/** A real request body is a few hundred bytes; anything far larger is refused unread. */
export const PHOTO_REQUEST_MAX_BYTES = 4096;

/**
 * Reads and validates the JSON body. Undefined for anything malformed, for a body with no declared
 * length, or for one larger than `PHOTO_REQUEST_MAX_BYTES` (refused before it is read).
 */
export async function readPhotoRequest(request: Request): Promise<PhotoRequest | undefined> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
    return undefined;
  }
  const declared = Number(request.headers.get('content-length'));
  if (!Number.isSafeInteger(declared) || declared < 1 || declared > PHOTO_REQUEST_MAX_BYTES) {
    return undefined;
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > PHOTO_REQUEST_MAX_BYTES) return undefined;
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof body !== 'object' || body === null) return undefined;
  const fields = body as {
    readonly documentId?: unknown;
    readonly actingFor?: unknown;
    readonly returnTo?: unknown;
    readonly specId?: unknown;
    readonly offsetX?: unknown;
    readonly offsetY?: unknown;
    readonly zoom?: unknown;
  };
  const documentId = typeof fields.documentId === 'string' ? fields.documentId : '';
  if (!UUID.test(documentId)) return undefined;
  const acting = fields.actingFor;
  let actingFor: ActingFor | undefined;
  if (acting === undefined || acting === null || acting === '') actingFor = undefined;
  else if (acting === 'individual') actingFor = 'individual';
  else if (typeof acting === 'string' && UUID.test(acting)) actingFor = { organizationId: acting };
  else return undefined;
  const returnTo = safeReturnPath(typeof fields.returnTo === 'string' ? fields.returnTo : '');
  const specId = typeof fields.specId === 'string' ? fields.specId : undefined;
  const hasCrop =
    fields.offsetX !== undefined || fields.offsetY !== undefined || fields.zoom !== undefined;
  const crop = hasCrop
    ? clampCropInput({
        offsetX: fields.offsetX,
        offsetY: fields.offsetY,
        zoom: fields.zoom,
      })
    : undefined;
  if (hasCrop && !crop) return undefined;
  return { documentId, actingFor, returnTo, specId, crop };
}

export type PhotoAuthorization =
  | { readonly kind: 'ok'; readonly access: AuthorizedApplicant<'DOWNLOAD_REDACTED'> }
  | { readonly kind: 'response'; readonly response: Response };

const ACTION = 'DOWNLOAD_REDACTED' as const;

function gateOptions(actingFor: ActingFor | undefined): RequireAccessOptions {
  return { purpose: EACH_GRANT, ...(actingFor !== undefined ? { actingFor } : {}) };
}

/**
 * Whether this viewer may use Visa Photo Sizes on this document: the very question both routes ask
 * (safe copies, every grant judged against its own purpose, through the chosen relationship). A
 * restricted document that only needs a fresh identity check still counts, since the routes then
 * ask for it. Used by pages so the section is never shown to someone the routes would refuse.
 */
export async function mayUseVisaPhotoSizes(
  db: Db,
  accountId: string,
  documentId: string,
  actingFor: ActingFor | undefined,
): Promise<boolean> {
  const result = await requireAccess(
    db,
    accountPrincipal(accountId),
    ACTION,
    { documentId },
    gateOptions(actingFor),
  );
  return result.ok || result.error.code === 'step_up_required';
}

/**
 * The central access gate for a safe copy, with every grant judged against its own purpose (the
 * same question the shared workspace asks). A restricted document gets a step-up: at once when the
 * session is fresh, otherwise the caller is told where to confirm it is them.
 */
export async function authorizePhoto(
  db: Db,
  accountId: string,
  input: PhotoRequest,
): Promise<PhotoAuthorization> {
  const action = ACTION;
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
        response: jsonResponse(
          {
            message: 'Confirm it is you to use this photo.',
            reauthUrl: stepUp.reauthUrl,
          },
          401,
        ),
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
  if (!result.ok) return { kind: 'response', response: errorResponse(result.error) };
  return { kind: 'ok', access: result.value };
}

/** Plain words for every refusal; the reason itself stays in the audit trail. */
export function errorResponse(error: ServiceError): Response {
  switch (error.code) {
    case 'rate_limited':
      return jsonResponse(
        { message: 'Too many photo requests in a short time. Try again in a while.' },
        429,
      );
    case 'invalid':
      return jsonResponse(
        {
          message:
            'This photo cannot be sized. Use a JPEG or PNG file saved as a Photograph, and choose one of the listed sizes.',
        },
        400,
      );
    // A missing record answers exactly like a refusal, so nobody can tell which ids exist.
    default:
      return jsonResponse(
        {
          message:
            'This photo is not available to you, or it is still being checked. Try again soon.',
        },
        403,
      );
  }
}

export function photoSizingDeps(db: Db): PhotoSizingDeps {
  return { storage: createStorage(db), sizer: createPhotoSizer() };
}
