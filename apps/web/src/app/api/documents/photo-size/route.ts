import { CENTRED_CROP } from '@visastack/core/photo-specs';
import { produceVisaPhotoSize } from '@visastack/services';
import {
  authorizePhoto,
  errorResponse,
  isSameOrigin,
  jsonResponse,
  photoSizingDeps,
  readPhotoRequest,
} from '../../../../lib/photo-sizes';
import { withSession } from '../../../../lib/session';
import { blobResponseHeaders } from '../../blob/[key]/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Visa Photo Sizes, step two: the photo at one published size, as a JPEG attachment, made on
 * request and never stored. It is a new rendering with all metadata removed, never the stored
 * original, so it needs DOWNLOAD_REDACTED through the central access gate: the owner, or anyone a
 * grant lets download copies. Headers match the document download: attachment, nosniff, no-store,
 * and a sandbox policy.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ message: 'Not authorized.' }, 403);
  const input = await readPhotoRequest(request);
  if (!input?.specId) return jsonResponse({ message: 'Choose a size first.' }, 400);
  const specId = input.specId;
  return withSession(async ({ db, accountId }) => {
    const authorized = await authorizePhoto(db, accountId, 'DOWNLOAD_REDACTED', input);
    if (authorized.kind === 'response') return authorized.response;
    const result = await produceVisaPhotoSize(authorized.access, photoSizingDeps(db), {
      specId,
      crop: input.crop ?? CENTRED_CROP,
    });
    if (!result.ok) return errorResponse(result.error);
    const { photo, filename } = result.value;
    const body = new Uint8Array(photo.bytes.byteLength);
    body.set(photo.bytes);
    return new Response(body.buffer, {
      status: 200,
      headers: {
        ...blobResponseHeaders({
          contentType: 'image/jpeg',
          dispositionKind: 'attachment',
          filename,
        }),
        'X-Photo-Size-Within-Limits': photo.withinFileSizeRange ? 'yes' : 'no',
      },
    });
  });
}
