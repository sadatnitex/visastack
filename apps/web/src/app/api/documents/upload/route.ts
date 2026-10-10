import { getApplicant } from '@visastack/services';
import { withSession } from '../../../../lib/session';
import {
  STREAM_UPLOAD_LIMIT,
  readBoundedUpload,
  validateUploadBytes,
} from '../../../../lib/upload-preflight';
import { uploadDocumentAction } from '../../../app/applicant/[id]/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const json = (message: string, status: number) =>
  Response.json(
    { message },
    {
      status,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    },
  );

/** Authenticated, same-origin raw-body upload. Original evidence bytes are never rewritten. */
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return json('Not authorized.', 403);
  const size = Number(request.headers.get('content-length'));
  if (!Number.isSafeInteger(size) || size < 1 || size > STREAM_UPLOAD_LIMIT || !request.body) {
    return json('Choose a file smaller than 4 MB.', 413);
  }
  const applicantId = new URL(request.url).searchParams.get('applicantId');
  if (!applicantId || !/^[a-f0-9-]{36}$/i.test(applicantId))
    return json('Choose an applicant.', 400);
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
    if (
      !validateUploadBytes(bytes, contentType, readEnv('MALWARE_SCANNER_PROVIDER') === 'clamav')
    ) {
      return json('This file type cannot be safely processed.', 415);
    }
    const form = new FormData();
    form.set('applicantId', applicantId);
    // Do not accept a caller-controlled path or header as the stored filename.
    form.set('file', new File([Buffer.from(bytes)], 'document', { type: contentType }));
    const result = await uploadDocumentAction({ ok: false, message: '' }, form);
    return json(result.message, result.ok ? 201 : 400);
  });
}

function readEnv(name: string): string | undefined {
  return process.env[name];
}
