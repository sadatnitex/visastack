import { NeonBlobStorage, verifyBlobToken } from '@visastack/adapters';
import { createNeonDb, resolveDatabaseUrl } from '@visastack/db';

/**
 * Signed blob serving route (ADR-0011).
 *
 * Streams a stored object's bytes ONLY when presented with a valid, unexpired
 * HMAC token. The token is minted by `NeonBlobStorage.issueReadRef` after the
 * policy engine has already authorized the access (in `previewDocument` /
 * `downloadDocument`), so this route re-checks the signature and expiry rather
 * than re-running authorization — the standard signed-URL capability pattern.
 */

export const dynamic = 'force-dynamic';

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await params;
  const url = new URL(request.url);
  const fields = {
    objectKey: key,
    disposition: url.searchParams.get('d') ?? '',
    variant: url.searchParams.get('v') ?? '',
    exp: Number(url.searchParams.get('exp')),
    sig: url.searchParams.get('sig') ?? '',
  };

  const secret = readEnv('BLOB_SIGNING_SECRET');
  const connectionString = resolveDatabaseUrl(process.env);
  if (!secret || !connectionString) {
    return new Response('storage not configured', { status: 503 });
  }
  if (!verifyBlobToken(secret, fields)) {
    return new Response('forbidden', { status: 403 });
  }

  const storage = new NeonBlobStorage({
    db: createNeonDb(connectionString),
    signingSecret: secret,
    baseUrl: url.origin,
  });
  const object = await storage.getObject(key);
  if (!object) return new Response('not found', { status: 404 });

  // Copy into a fresh ArrayBuffer-backed body (a stable, non-generic BodyInit).
  const body = new Uint8Array(object.bytes.byteLength);
  body.set(object.bytes);

  return new Response(body.buffer, {
    status: 200,
    headers: {
      'Content-Type': object.contentType,
      'Content-Disposition': fields.disposition === 'download' ? 'attachment' : 'inline',
      'Cache-Control': 'private, no-store',
    },
  });
}
