import { clearRedactionMasks, saveRedactionMasks } from '@visastack/services';
import {
  MASKS_REQUEST_MAX_BYTES,
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
export const maxDuration = 30;

/**
 * Saves the owner's boxes for every page of the latest version (or the explicit "Nothing to Hide
 * on This Document"), after which each page is prepared through api/documents/safe-copy-prepare,
 * or clears them (and their prepared pages) with only the version named, without reading the file. A MANAGE proof through the central gate; the service
 * refuses anyone but the record owner, any version but the latest usable one, and a save that
 * does not cover every page. Same-origin JSON only.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ message: 'Not authorized.' }, 403);
  const off = safeCopiesOffResponse();
  if (off) return off;
  const input = await readSafeCopyRequest(request, MASKS_REQUEST_MAX_BYTES);
  if (!input?.versionId || (!input.clear && !input.pages)) {
    return jsonResponse({ message: 'Check the boxes on every page and try again.' }, 400);
  }
  const { versionId, pages } = input;
  return withSession(async ({ db, accountId }) => {
    const authorized = await authorizeSafeCopy(db, accountId, 'MANAGE', input);
    if (authorized.kind === 'response') return authorized.response;
    if (input.clear) {
      const cleared = await clearRedactionMasks(
        authorized.access,
        { versionId },
        redactionDeps(db),
      );
      if (!cleared.ok) return safeCopyErrorResponse(cleared.error);
      return jsonResponse({ state: 'NOT_PREPARED' }, 200);
    }
    const saved = await saveRedactionMasks(authorized.access, redactionDeps(db), {
      versionId,
      pages: pages ?? [],
      nothingToHide: input.nothingToHide,
    });
    if (!saved.ok) return safeCopyErrorResponse(saved.error);
    const { state, pageCount, boxCount, maskRevision } = saved.value;
    return jsonResponse({ state, pageCount, boxCount, maskRevision }, 200);
  });
}
