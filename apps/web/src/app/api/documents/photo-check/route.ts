import { checkVisaPhoto } from '@visastack/services';
import {
  authorizePhoto,
  errorResponse,
  isSameOrigin,
  jsonResponse,
  photoSizingDeps,
  readPhotoRequest,
} from '../../../../lib/photo-sizes';
import { withSession } from '../../../../lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Visa Photo Sizes, step one, run when the person opens the section: advisory checks and a small
 * preview of a Photograph document for the crop control. It needs the same safe-copy permission
 * (DOWNLOAD_REDACTED) as the download itself, through the central access gate, so a viewer who may
 * only preview the document never gets the sized preview. Same-origin JSON only.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ message: 'Not authorized.' }, 403);
  const input = await readPhotoRequest(request);
  if (!input) return jsonResponse({ message: 'Choose a photo first.' }, 400);
  return withSession(async ({ db, accountId }) => {
    const authorized = await authorizePhoto(db, accountId, input);
    if (authorized.kind === 'response') return authorized.response;
    const result = await checkVisaPhoto(authorized.access, photoSizingDeps(db));
    if (!result.ok) return errorResponse(result.error);
    const { sourceWidth, sourceHeight, findings, preview } = result.value;
    return jsonResponse(
      {
        sourceWidth,
        sourceHeight,
        findings,
        preview: {
          width: preview.width,
          height: preview.height,
          jpegBase64: Buffer.from(preview.bytes).toString('base64'),
        },
      },
      200,
    );
  });
}
