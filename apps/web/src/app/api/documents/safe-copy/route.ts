import { produceSafeCopy } from '@visastack/services';
import {
  authorizeSafeCopy,
  isSameOrigin,
  jsonResponse,
  readSafeCopyRequest,
  redactionDeps,
  safeCopyErrorResponse,
  streamBytes,
} from '../../../../lib/safe-copy';
import { withSession } from '../../../../lib/session';
import { blobResponseHeaders } from '../../blob/[key]/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The service gives up drawing after 30 seconds; this leaves room to read the file and answer.
export const maxDuration = 60;

/**
 * Download Safe Copy (ADR 0022, S23): the document drawn fresh with the owner's black boxes, as an
 * image-only PDF (or one PNG for a photo), made on request and never stored. DOWNLOAD_REDACTED
 * ("Download Safe Copies") through the central gate: the owner, or anyone a grant lets download
 * safe copies, with a fresh identity check for a restricted document. Nothing is served until
 * the owner has prepared every page. Streamed as an attachment with the document download
 * headers (nosniff, no-store and a sandbox policy).
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ message: 'Not authorized.' }, 403);
  const input = await readSafeCopyRequest(request);
  if (!input) return jsonResponse({ message: 'Choose a document first.' }, 400);
  return withSession(async ({ db, accountId }) => {
    const authorized = await authorizeSafeCopy(db, accountId, 'DOWNLOAD_REDACTED', input);
    if (authorized.kind === 'response') return authorized.response;
    const result = await produceSafeCopy(authorized.access, redactionDeps(db));
    if (!result.ok) return safeCopyErrorResponse(result.error);
    const { bytes, contentType, filename } = result.value;
    return new Response(streamBytes(bytes), {
      status: 200,
      headers: {
        ...blobResponseHeaders({ contentType, dispositionKind: 'attachment', filename }),
        'Content-Length': String(bytes.byteLength),
      },
    });
  });
}
