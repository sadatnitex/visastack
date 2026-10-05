import { getMissionSnapshot } from '@visastack/services';
import { withSession } from '../../../../../../../lib/session';

/**
 * Downloads one mission snapshot's full content as JSON — the application
 * packet once the mission has reached READY_TO_EXPORT or later (Build Spec
 * §4.5's "pack production": index, evidence references, requirement mapping,
 * readiness, all under one checksum). Owner-only, recomputed from nothing —
 * this is the exact stored, immutable content, never regenerated.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; snapshotId: string }> },
): Promise<Response> {
  const { id, snapshotId } = await params;

  const snapshot = await withSession(async ({ db, accountId }) => {
    const result = await getMissionSnapshot(db, accountId, id, snapshotId);
    return result.ok ? result.value : null;
  });

  if (!snapshot) return new Response('not found', { status: 404 });

  return new Response(JSON.stringify(snapshot.content, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="case-${id}-snapshot-v${snapshot.version}.json"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
