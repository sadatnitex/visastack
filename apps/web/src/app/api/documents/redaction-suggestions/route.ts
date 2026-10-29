import { suggestRedactions } from '@visastack/services';
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
export const maxDuration = 30;

/**
 * Suggested boxes for the owner's safe copy: the passport's machine-readable lines, the owner's
 * own identity numbers and account numbers on financial documents. Positions and a reason only,
 * never the values found. Owner only, through the central gate, like the page images.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ message: 'Not authorized.' }, 403);
  const off = safeCopiesOffResponse();
  if (off) return off;
  const input = await readSafeCopyRequest(request);
  if (!input?.versionId) return jsonResponse({ message: 'Choose a document first.' }, 400);
  const { versionId } = input;
  return withSession(async ({ db, accountId }) => {
    const authorized = await authorizeSafeCopy(db, accountId, 'PREVIEW', input);
    if (authorized.kind === 'response') return authorized.response;
    const result = await suggestRedactions(authorized.access, redactionDeps(db), { versionId });
    if (!result.ok) return safeCopyErrorResponse(result.error);
    return jsonResponse(
      {
        suggestions: result.value.map((suggestion) => ({
          page: suggestion.page,
          box: suggestion.box,
          reason: suggestion.reason,
        })),
      },
      200,
    );
  });
}
