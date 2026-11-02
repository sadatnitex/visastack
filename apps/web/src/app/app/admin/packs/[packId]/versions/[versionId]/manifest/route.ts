import {
  buildManifest,
  getPackVersion,
  listRequirements,
  manifestFormatFor,
  manifestFormatOf,
} from '@visastack/services';
import { isPlatformAdmin } from '../../../../../../../../lib/admin';
import { withSession } from '../../../../../../../../lib/session';

/**
 * Downloads a pack version's deterministic manifest — the exact requirement
 * set its frozen checksum was computed over (Build Spec §4.1). Platform-admin
 * only; recomputed from the current requirement rows, never stored bytes, so
 * it always reflects reality. An approved version is serialized in its own
 * manifest format (ADR 0026 D2); a draft in the format approval would choose.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ packId: string; versionId: string }> },
): Promise<Response> {
  const { versionId } = await params;

  const outcome = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return 'forbidden' as const;
    const version = await getPackVersion(db, versionId);
    if (!version) return 'missing' as const;
    const requirements = await listRequirements(db, versionId);
    const format =
      version.status === 'DRAFT' ? manifestFormatFor(requirements) : manifestFormatOf(version);
    if (format === null) return 'unknown_format' as const;
    return buildManifest(requirements, format).manifest;
  });

  if (outcome === 'forbidden') return new Response('not authorized', { status: 403 });
  if (outcome === 'missing') return new Response('not found', { status: 404 });
  if (outcome === 'unknown_format') {
    return new Response('this version uses a manifest format this release cannot read', {
      status: 409,
    });
  }
  const manifest = outcome;

  return new Response(JSON.stringify(manifest, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="pack-manifest-${versionId}.json"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
