import { buildManifest, listRequirements } from '@visastack/services';
import { isPlatformAdmin } from '../../../../../../../../lib/admin';
import { withSession } from '../../../../../../../../lib/session';

/**
 * Downloads a pack version's deterministic manifest — the exact requirement
 * set its frozen checksum was computed over (Build Spec §4.1). Platform-admin
 * only; recomputed from the current requirement rows, never stored bytes, so
 * it always reflects reality.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ packId: string; versionId: string }> },
): Promise<Response> {
  const { versionId } = await params;

  const manifest = await withSession(async ({ db, email }) => {
    if (!isPlatformAdmin(email)) return null;
    const requirements = await listRequirements(db, versionId);
    return buildManifest(requirements).manifest;
  });

  if (!manifest) return new Response('not authorized', { status: 403 });

  return new Response(JSON.stringify(manifest, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="pack-manifest-${versionId}.json"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
