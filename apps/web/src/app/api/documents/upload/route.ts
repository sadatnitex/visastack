import { getApplicant } from '@visastack/services';
import type { UpgradeLineKind } from '../../../../components/upgrade-line';
import { withSession } from '../../../../lib/session';
import {
  STREAM_UPLOAD_LIMIT,
  admitsHeicUpload,
  pdfUploadsAccepted,
  readBoundedUpload,
  validateUploadBytes,
} from '../../../../lib/upload-preflight';
import { uploadDocumentAction } from '../../../app/applicant/[id]/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const json = (message: string, status: number, title?: string, upgrade?: UpgradeLineKind) =>
  Response.json(
    { message, ...(title ? { title } : {}), ...(upgrade ? { upgrade } : {}) },
    {
      status,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    },
  );

/**
 * A header value sent percent-encoded (so a name in any script survives the trip), or '' when it
 * is missing or not valid encoding.
 */
function encodedHeader(request: Request, name: string): string {
  const raw = request.headers.get(name);
  if (!raw) return '';
  try {
    return decodeURIComponent(raw).slice(0, 200);
  } catch {
    return '';
  }
}

/**
 * Authenticated, same-origin raw-body upload, one file per request (the upload form sends each
 * file this way so it can show how far each one has got). Original evidence bytes are never
 * rewritten, except that an iPhone photo (HEIC or HEIF) is stored as a converted JPEG copy, which
 * the upload action records. The kind of document, when chosen, arrives in `X-Document-Kind` and
 * the name of an "Other" kind in `X-Document-Name`; both are checked by the action like a form's.
 */
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return json('Not authorized.', 403);
  const size = Number(request.headers.get('content-length'));
  if (!Number.isSafeInteger(size) || size < 1 || size > STREAM_UPLOAD_LIMIT || !request.body) {
    return json('Choose a file smaller than 4 MB.', 413);
  }
  const applicantId = new URL(request.url).searchParams.get('applicantId');
  if (!applicantId || !/^[a-f0-9-]{36}$/i.test(applicantId))
    return json('Choose a traveller.', 400);
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  // Authenticate before spending memory on the body. Ownership, quota, durable
  // registration, stored-byte verification and job enqueue remain in the action.
  return withSession(async ({ db, accountId }) => {
    if ((await getApplicant(db, applicantId))?.ownerAccountId !== accountId)
      return json('Not authorized.', 403);
    let bytes: Uint8Array;
    try {
      bytes = await readBoundedUpload(request.body as ReadableStream<Uint8Array>, size);
    } catch {
      return json('The upload could not be read.', 400);
    }
    const admitted =
      admitsHeicUpload(bytes, contentType) ||
      validateUploadBytes(bytes, contentType, pdfUploadsAccepted());
    if (!admitted) return json('This file type cannot be safely processed.', 415);
    const form = new FormData();
    form.set('applicantId', applicantId);
    form.set('docType', encodedHeader(request, 'x-document-kind'));
    form.set('subject', encodedHeader(request, 'x-document-name'));
    // Do not accept a caller-controlled path or header as the stored filename.
    form.set('file', new File([Buffer.from(bytes)], 'document', { type: contentType }));
    const result = await uploadDocumentAction({ ok: false, message: '' }, form);
    return json(
      result.message,
      result.ok ? 201 : 400,
      result.ok ? result.title : undefined,
      result.ok ? undefined : result.upgrade,
    );
  });
}
