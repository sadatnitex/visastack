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
 * Visa Photo Sizes, step one: advisory checks and a small preview of a Photograph document, for
 * the crop control. Same permission as the document's own preview (PREVIEW), through the central
 * access gate, for the owner or anyone a grant lets preview it. Same-origin JSON only.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ message: 'Not authorized.' }, 403);
  const input = await readPhotoRequest(request);
  if (!input) return jsonResponse({ message: 'Choose a photo first.' }, 400);
  return withSession(async ({ db, accountId }) => {
    const authorized = await authorizePhoto(db, accountId, 'PREVIEW', input);
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
