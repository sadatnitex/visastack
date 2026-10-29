import 'server-only';
import { createSafeCopyRenderer } from '@visastack/adapters';
import {
  type ActingFor,
  type AuthorizedApplicant,
  type Db,
  type RedactionDeps,
  type SafeCopyError,
  type SafeCopyState,
  accountPrincipal,
  isSafeCopyReady,
  listSafeCopyStatesForDocuments,
  requireAccess,
} from '@visastack/services';
import { getPlatformCapabilities } from './capabilities';
import {
  type DocumentAuthorization,
  type GatedAction,
  authorizeDocument,
  gateOptions,
  jsonResponse,
} from './document-gate';
import { safeReturnPath } from './neon-recency';
import { createKeyManagementPort } from './providers';
import { createStorage } from './storage';

export { isSameOrigin, jsonResponse } from './document-gate';

/**
 * Shared request handling for the safe copy routes (ADR 0022, S23): the owner's editor
 * (api/documents/redaction-editor, redaction-page, redaction-suggestions, redaction-masks) and the
 * safe copy itself (api/documents/safe-copy). Same-origin JSON bodies only, the central access
 * gate with the exact permission the service needs, a fresh identity check when the document is
 * restricted, and plain answers. The services decide everything else (owner only, latest version,
 * prepared pages); these routes only carry the request.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every request but a save is a few hundred bytes. */
export const SAFE_COPY_REQUEST_MAX_BYTES = 4096;
/** A save of 20 pages of 200 boxes each is under 300 KB. */
export const MASKS_REQUEST_MAX_BYTES = 512 * 1024;

export interface SafeCopyRequest {
  readonly documentId: string;
  readonly actingFor: ActingFor | undefined;
  readonly returnTo: string;
  readonly versionId: string | undefined;
  readonly page: number | undefined;
  /** Raw page entries of a save, checked by the service. */
  readonly pages:
    | readonly { readonly boxes: readonly unknown[]; readonly acceptedSuggestions: number }[]
    | undefined;
  readonly nothingToHide: boolean;
  readonly clear: boolean;
  /** The revision of saved boxes a preparing step names. */
  readonly maskRevision: string | undefined;
}

function readPages(value: unknown): SafeCopyRequest['pages'] | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) return null;
  const pages: { boxes: unknown[]; acceptedSuggestions: number }[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { boxes, acceptedSuggestions } = entry as {
      readonly boxes?: unknown;
      readonly acceptedSuggestions?: unknown;
    };
    if (!Array.isArray(boxes)) return null;
    const accepted = acceptedSuggestions === undefined ? 0 : acceptedSuggestions;
    if (typeof accepted !== 'number' || !Number.isSafeInteger(accepted)) return null;
    pages.push({ boxes, acceptedSuggestions: accepted });
  }
  return pages;
}

/**
 * Reads and validates the JSON body. Undefined for anything malformed, for a body with no declared
 * length, or for one larger than `maxBytes` (refused before it is read).
 */
export async function readSafeCopyRequest(
  request: Request,
  maxBytes: number = SAFE_COPY_REQUEST_MAX_BYTES,
): Promise<SafeCopyRequest | undefined> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
    return undefined;
  }
  const declared = Number(request.headers.get('content-length'));
  if (!Number.isSafeInteger(declared) || declared < 1 || declared > maxBytes) return undefined;
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > maxBytes) return undefined;
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const fields = body as {
    readonly documentId?: unknown;
    readonly actingFor?: unknown;
    readonly returnTo?: unknown;
    readonly versionId?: unknown;
    readonly page?: unknown;
    readonly pages?: unknown;
    readonly nothingToHide?: unknown;
    readonly clear?: unknown;
    readonly maskRevision?: unknown;
  };
  const documentId = typeof fields.documentId === 'string' ? fields.documentId : '';
  if (!UUID.test(documentId)) return undefined;
  const acting = fields.actingFor;
  let actingFor: ActingFor | undefined;
  if (acting === undefined || acting === null || acting === '') actingFor = undefined;
  else if (acting === 'individual') actingFor = 'individual';
  else if (typeof acting === 'string' && UUID.test(acting)) actingFor = { organizationId: acting };
  else return undefined;
  let versionId: string | undefined;
  if (fields.versionId !== undefined) {
    if (typeof fields.versionId !== 'string' || !UUID.test(fields.versionId)) return undefined;
    versionId = fields.versionId;
  }
  let page: number | undefined;
  if (fields.page !== undefined) {
    if (typeof fields.page !== 'number' || !Number.isSafeInteger(fields.page)) return undefined;
    if (fields.page < 1 || fields.page > 20) return undefined;
    page = fields.page;
  }
  const pages = readPages(fields.pages);
  if (pages === null) return undefined;
  if (fields.nothingToHide !== undefined && typeof fields.nothingToHide !== 'boolean') {
    return undefined;
  }
  if (fields.clear !== undefined && typeof fields.clear !== 'boolean') return undefined;
  let maskRevision: string | undefined;
  if (fields.maskRevision !== undefined) {
    if (typeof fields.maskRevision !== 'string' || !UUID.test(fields.maskRevision)) {
      return undefined;
    }
    maskRevision = fields.maskRevision;
  }
  return {
    documentId,
    actingFor,
    returnTo: safeReturnPath(typeof fields.returnTo === 'string' ? fields.returnTo : ''),
    versionId,
    page,
    pages,
    nothingToHide: fields.nothingToHide === true,
    clear: fields.clear === true,
    maskRevision,
  };
}

const NOT_AVAILABLE =
  'This document is not available to you, or it is still being checked. Try again soon.';

/** Plain words for every refusal; the reason itself stays in the audit trail. */
export function safeCopyErrorResponse(error: SafeCopyError): Response {
  switch (error.refusal) {
    case 'not_available':
      return jsonResponse({ message: NOT_AVAILABLE }, 403);
    case 'not_prepared':
      return jsonResponse({ message: 'This safe copy is not prepared yet.' }, 409);
    case 'too_large':
      return jsonResponse({ message: 'This document is too large for a safe copy.' }, 413);
    case 'too_slow':
      return jsonResponse({ message: 'This page took too long to prepare. Try again.' }, 503);
    case 'unsupported':
      return jsonResponse(
        { message: 'Safe copies can be made from PDF files and photos only.' },
        415,
      );
    case 'unreadable':
      return jsonResponse({ message: 'This file could not be read for a safe copy.' }, 422);
    case 'not_ready_yet':
      return jsonResponse({ message: 'Safe copies are not ready yet.' }, 503);
    case 'out_of_date':
      return jsonResponse(
        {
          message:
            'This document or its boxes changed since this page was opened. Open the safe copy again.',
        },
        409,
      );
    default:
      break;
  }
  switch (error.code) {
    case 'rate_limited':
      return jsonResponse(
        { message: 'Too many requests in a short time. Try again in a while.' },
        429,
      );
    case 'invalid':
      return jsonResponse({ message: 'Check the boxes on every page and try again.' }, 400);
    // A missing record answers exactly like a refusal, so nobody can tell which ids exist.
    default:
      return jsonResponse({ message: NOT_AVAILABLE }, 403);
  }
}

/** The gate for one safe copy request: the same words for every route. */
export function authorizeSafeCopy<A extends GatedAction>(
  db: Db,
  accountId: string,
  action: A,
  input: SafeCopyRequest,
): Promise<DocumentAuthorization<A>> {
  return authorizeDocument(db, accountId, action, input, {
    reauth: 'Confirm it is you to open this document.',
    refused: safeCopyErrorResponse,
  });
}

/** Said wherever safe copies cannot be used on this deployment. */
export const SAFE_COPIES_OFF_MESSAGE = 'Safe copies are not available here yet.';

/** Whether safe copies are on here: the capability registry's `redactedDownload`. */
export function safeCopiesAvailable(): boolean {
  return getPlatformCapabilities().redactedDownload === 'available';
}

/** The plain refusal every safe copy route gives while safe copies are off here. */
export function safeCopiesOffResponse(): Response | undefined {
  return safeCopiesAvailable()
    ? undefined
    : jsonResponse({ message: SAFE_COPIES_OFF_MESSAGE }, 503);
}

/**
 * What a viewer is offered for a document's safe copy:
 * - `ready`: prepared, and the viewer may download it now; Download Safe Copy.
 * - `confirm`: prepared (or not known without it), and the viewer may download it after a fresh
 *   identity check (a restricted document); the button asks for it.
 * - `not_prepared`: the viewer may download safe copies of it, but none is ready yet (also while
 *   it is being prepared). No identity check is asked for.
 * - `not_available`: a file a safe copy cannot be made from (documents, text, too large).
 * - `none`: this viewer may not download safe copies of it.
 */
export type SafeCopyOffer = 'ready' | 'confirm' | 'not_prepared' | 'not_available' | 'none';

function offerFor(
  state: SafeCopyState | undefined,
  download: 'allowed' | 'step_up' | 'refused',
): SafeCopyOffer {
  if (download === 'refused') return 'none';
  if (state === 'UNSUPPORTED' || state === 'TOO_LARGE') return 'not_available';
  if (state === undefined) return download === 'step_up' ? 'confirm' : 'not_prepared';
  if (!isSafeCopyReady(state)) return 'not_prepared';
  return download === 'allowed' ? 'ready' : 'confirm';
}

type StateProof = AuthorizedApplicant<'VIEW_METADATA'> | AuthorizedApplicant<'DOWNLOAD_REDACTED'>;

/**
 * The offer for each document, asked of the gate exactly as the safe copy route asks (DOWNLOAD
 * REDACTED, every grant judged against its own purpose, through the chosen relationship). The
 * state is read first from a view-details proof, which needs no fresh identity check, so a
 * restricted document asks for one only when its copy is ready. Every check runs at once, and
 * every state is read in one go.
 */
export async function safeCopyOffers(
  db: Db,
  accountId: string,
  documentIds: readonly string[],
  actingFor: ActingFor | undefined,
): Promise<ReadonlyMap<string, SafeCopyOffer>> {
  const principal = accountPrincipal(accountId);
  const options = gateOptions(actingFor);
  const checks = await Promise.all(
    documentIds.map(async (documentId) => {
      const [details, download] = await Promise.all([
        requireAccess(db, principal, 'VIEW_METADATA', { documentId }, options),
        requireAccess(db, principal, 'DOWNLOAD_REDACTED', { documentId }, options),
      ]);
      const proof: StateProof | undefined = details.ok
        ? details.value
        : download.ok
          ? download.value
          : undefined;
      const access: 'allowed' | 'step_up' | 'refused' = download.ok
        ? 'allowed'
        : download.error.code === 'step_up_required'
          ? 'step_up'
          : 'refused';
      return { documentId, proof, access };
    }),
  );
  const proofs = checks.flatMap((check) =>
    check.access !== 'refused' && check.proof ? [check.proof] : [],
  );
  const [first, ...rest] = proofs;
  const states = first ? await listSafeCopyStatesForDocuments(first, rest) : new Map();
  return new Map(
    checks.map((check) => [
      check.documentId,
      offerFor(check.proof ? states.get(check.documentId) : undefined, check.access),
    ]),
  );
}

export function redactionDeps(db: Db): RedactionDeps {
  return {
    storage: createStorage(db),
    renderer: createSafeCopyRenderer(),
    encryption: createKeyManagementPort(),
  };
}

/** Streams bytes in pieces, so a large safe copy is never held twice as one response body. */
export function streamBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const CHUNK = 256 * 1024;
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(bytes.byteLength, offset + CHUNK);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
}
