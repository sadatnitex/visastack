import { openRedactionEditor } from '@visastack/services';
import {
  authorizeSafeCopy,
  isSameOrigin,
  jsonResponse,
  readSafeCopyRequest,
  redactionDeps,
  safeCopyErrorResponse,
} from '../../../../lib/safe-copy';
import { withSession } from '../../../../lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Prepare Safe Copy, step one (ADR 0022, S23): what the owner's editor needs to start, which is
 * the latest version, its page count and the boxes already saved for it. A PREVIEW proof through
 * the central access gate (a restricted document asks for a fresh identity check); the service
 * refuses anyone but the record owner. Same-origin JSON only.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ message: 'Not authorized.' }, 403);
  const input = await readSafeCopyRequest(request);
  if (!input) return jsonResponse({ message: 'Choose a document first.' }, 400);
  return withSession(async ({ db, accountId }) => {
    const authorized = await authorizeSafeCopy(db, accountId, 'PREVIEW', input);
    if (authorized.kind === 'response') return authorized.response;
    const result = await openRedactionEditor(authorized.access, redactionDeps(db));
    if (!result.ok) return safeCopyErrorResponse(result.error);
    const { versionId, pageCount, state, savedPages, canSave } = result.value;
    return jsonResponse({ versionId, pageCount, state, savedPages, canSave }, 200);
  });
}
