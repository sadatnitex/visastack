import { prepareSafeCopyPage } from '@visastack/services';
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One page is drawn per call within the service's own 30 second limit.
export const maxDuration = 60;

/**
 * Prepares one page of the owner's safe copy (ADR 0022 amendment, deviation 7): the page drawn
 * once with its boxes painted black and stored as a private derived file. The editor calls this
 * once per page, in order, after saving; a page already prepared for that revision is skipped, so
 * an interrupted run resumes. A MANAGE proof through the central gate; the service refuses anyone
 * but the record owner, and a revision or version that is no longer current.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ message: 'Not authorized.' }, 403);
  const off = safeCopiesOffResponse();
  if (off) return off;
  const input = await readSafeCopyRequest(request);
  if (!input?.versionId || input.page === undefined || !input.maskRevision) {
    return jsonResponse({ message: 'Choose a page first.' }, 400);
  }
  const { versionId, page, maskRevision } = input;
  return withSession(async ({ db, accountId }) => {
    const authorized = await authorizeSafeCopy(db, accountId, 'MANAGE', input);
    if (authorized.kind === 'response') return authorized.response;
    const result = await prepareSafeCopyPage(authorized.access, redactionDeps(db), {
      versionId,
      page,
      maskRevision,
    });
    if (!result.ok) return safeCopyErrorResponse(result.error);
    return jsonResponse({ ...result.value }, 200);
  });
}
