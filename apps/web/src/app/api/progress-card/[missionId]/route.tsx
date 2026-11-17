import { accountPrincipal, readCaseProgressCounts, requireAccess } from '@visastack/services';
import { ImageResponse } from 'next/og';
import {
  PROGRESS_CARD_HEIGHT,
  PROGRESS_CARD_WIDTH,
  loadFlagSvg,
  progressCardElement,
} from '../../../../lib/progress-card/card-image';
import { progressCardModel } from '../../../../lib/progress-card/card-model';
import { progressCardOn } from '../../../../lib/progress-card/switch';
import { withSession } from '../../../../lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Headers every answer carries: never kept in a shared or disk cache, never sniffed, this site only. */
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
} as const;

/**
 * One answer for "switched off", "no such case", "not yours", "no checklist" and a malformed
 * address, so the route reveals nothing about which it was.
 */
function notFound(): Response {
  return new Response('not found', { status: 404, headers: PRIVATE_HEADERS });
}

/**
 * A case's progress card as a PNG picture (WP-PIC15, owner decision D5 of 17 Nov 2026: counts
 * only). Signed-in only, decided by the access gate for that one case, and made for the record's
 * owner alone. Drawn fresh on the server each time and never stored; one count-only audit row is
 * written per card (the service does it). Behind the owner's PROGRESS_CARD switch, off by default.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ missionId: string }> },
): Promise<Response> {
  if (!progressCardOn()) return notFound();
  const { missionId } = await params;
  if (!CASE_ID.test(missionId)) return notFound();
  const counts = await withSession(async ({ db, accountId }) => {
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { missionId },
      { purpose: 'self' },
    );
    if (!access.ok) return null;
    const read = await readCaseProgressCounts(access.value);
    return read.ok ? read.value : null;
  });
  if (!counts) return notFound();

  const model = progressCardModel(counts);
  const flag = model.place?.hasFlag ? await loadFlagSvg(model.place.iso2) : null;
  const image = new ImageResponse(progressCardElement(model, flag), {
    width: PROGRESS_CARD_WIDTH,
    height: PROGRESS_CARD_HEIGHT,
    headers: {
      ...PRIVATE_HEADERS,
      'Content-Disposition': 'inline; filename="progress-card.png"',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
  return image;
}
