import { renderRedactionPage } from '@visastack/services';
import {
  authorizeSafeCopy,
  isSameOrigin,
  jsonResponse,
  readSafeCopyRequest,
  redactionDeps,
  safeCopiesOffResponse,
  safeCopyErrorResponse,
} from '../../../../lib/safe-copy';
import { withSession } from '../../../../lib/session';
import { blobResponseHeaders } from '../../blob/[key]/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * One page of the owner's document for the safe copy editor, drawn fresh as a JPEG with nothing
 * hidden, so the owner can see where to place boxes. The owner's alone: a PREVIEW proof through
 * the central gate (with a fresh identity check for a restricted document), and the service
 * refuses anyone but the record owner. Inline, never cached, with the document sandbox headers.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ message: 'Not authorized.' }, 403);
  const off = safeCopiesOffResponse();
  if (off) return off;
  const input = await readSafeCopyRequest(request);
  if (!input?.versionId || input.page === undefined) {
    return jsonResponse({ message: 'Choose a page first.' }, 400);
  }
  const { versionId, page } = input;
  return withSession(async ({ db, accountId }) => {
    const authorized = await authorizeSafeCopy(db, accountId, 'PREVIEW', input);
    if (authorized.kind === 'response') return authorized.response;
    const result = await renderRedactionPage(authorized.access, redactionDeps(db), {
      versionId,
      page,
    });
    if (!result.ok) return safeCopyErrorResponse(result.error);
    const body = new Uint8Array(result.value.bytes.byteLength);
    body.set(result.value.bytes);
    return new Response(body.buffer, {
      status: 200,
      headers: {
        ...blobResponseHeaders({
          contentType: 'image/jpeg',
          dispositionKind: 'inline',
          filename: undefined,
        }),
        'X-Page-Width': String(result.value.width),
        'X-Page-Height': String(result.value.height),
      },
    });
  });
}
