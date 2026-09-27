import { getAccountExportArtifact } from '@visastack/services';
import { createKeyManagementPort, createStorage } from '../../../../../../lib/providers';
import { withSession } from '../../../../../../lib/session';

/**
 * Downloads a READY large-export artifact (PRV-04, master directive Part 7
 * §14 "Large export" -- "current access rechecked at download"). Self-
 * service only, so unlike `/api/blob/[key]` (which serves shared, possibly
 * third-party-granted document access via a signed reference) this needs no
 * separate signed token: the ambient WorkOS session already IS the one
 * authorization this artifact was ever generated for, and
 * `getAccountExportArtifact` re-verifies live ownership, status, and
 * expiry -- not merely a value carried forward from request time -- on
 * every call, satisfying the directive's own "rechecked at download"
 * wording. Step-up is required only to REQUEST an export (`actions.ts`'s
 * `requestLargeExportAction`, matching the existing synchronous export
 * route's own gating), not a second time here: re-authenticating a second
 * time just to receive a file already authorized minutes-to-hours earlier
 * would add friction without a corresponding new risk, since nothing about
 * possessing this exact job id grants access to any other account's data.
 *
 * Every outcome that is not a genuine, ready, still-owned artifact
 * (wrong account, not yet ready, expired, missing key management) collapses
 * to a plain 404 -- never a distinguishing error -- so a guessed or stale
 * job id learns nothing about why it failed.
 */
export const dynamic = 'force-dynamic';

/** Matches `/api/blob/[key]`'s own helper: a fresh, guaranteed-`ArrayBuffer`-backed copy, since `BodyInit` does not accept the wider `Uint8Array<ArrayBufferLike>` the decrypt path returns. */
function freshArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return body.buffer;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await params;

  const artifact = await withSession(async ({ db, accountId }) => {
    const ports = { blobStore: createStorage(db), keyManagement: createKeyManagementPort() };
    const result = await getAccountExportArtifact(db, ports, { actorAccountId: accountId, jobId });
    return result.ok ? result.value : null;
  });

  if (!artifact) return new Response('not found', { status: 404 });

  const stamp = artifact.readyAt.toISOString().slice(0, 10);
  return new Response(freshArrayBuffer(artifact.bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="visastack-large-export-${stamp}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
