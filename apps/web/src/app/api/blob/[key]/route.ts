import { verifyBlobToken } from '@visastack/adapters';
import { createNeonDb, resolveDatabaseUrl } from '@visastack/db';
import {
  readDocumentAccessToken,
  recheckDocumentAccess,
  verifyDocumentAccessToken,
} from '@visastack/services';
import { createStorage } from '../../../../lib/storage';
import { blobResponseHeaders } from './headers';

/**
 * Signed blob serving route (ADR-0011, extended Commercial V1 EVI-06/SEC-05).
 *
 * Streams a stored object's bytes only when presented with TWO valid,
 * unexpired tokens minted together by `accessDocument` (`previewDocument`/
 * `downloadDocument`) after the policy engine authorized the access:
 *
 * 1. The storage-generic blob token (`d`/`v`/`exp`/`sig`/`f`, unchanged from
 *    ADR-0011): proves this object key and disposition were authorized.
 * 2. The document access-context token (`adid`/`aak`/.../`asig`, its own
 *    query parameters, distinct from the blob token's above): proves WHICH
 *    authorization decision backed it, and lets this route replay that
 *    decision against
 *    LIVE state right now via `recheckDocumentAccess`: a grant revoked, a
 *    membership deactivated, or a document version erased between mint and
 *    redemption all fail redemption here, even though the blob token's own
 *    signature is still perfectly valid. This is the directive's explicit
 *    "redemption must recheck access" / "revoking a grant before redemption
 *    must make an already issued token fail" requirement (EVI-06 §10), a
 *    stateless signature+expiry check alone cannot satisfy it, since a
 *    signed token has nothing server-side left to revoke on its own.
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
  const filenameParam = url.searchParams.get('f');
  const fields = {
    objectKey: key,
    disposition: url.searchParams.get('d') ?? '',
    variant: url.searchParams.get('v') ?? '',
    exp: Number(url.searchParams.get('exp')),
    sig: url.searchParams.get('sig') ?? '',
    ...(filenameParam !== null ? { filename: filenameParam } : {}),
  };

  const secret = readEnv('BLOB_SIGNING_SECRET');
  const connectionString = resolveDatabaseUrl(process.env);
  if (!secret || !connectionString) {
    return new Response('storage not configured', { status: 503 });
  }
  if (!verifyBlobToken(secret, fields)) {
    return new Response('forbidden', { status: 403 });
  }

  // Second token, verified independently of the blob token above (EVI-06/
  // SEC-05, see this file's module doc comment). A request missing it, or
  // carrying one with a bad signature or past its own expiry, is refused
  // exactly like a bad blob token: a URL is not a valid delivery request
  // without both.
  const accessTokenFields = readDocumentAccessToken(url.searchParams);
  if (!accessTokenFields || !verifyDocumentAccessToken(secret, accessTokenFields)) {
    return new Response('forbidden', { status: 403 });
  }

  // Security boundary (Milestone 2 / ADR-0011 correction): this route serves the
  // stored ORIGINAL bytes. It may therefore only ever honour an `original`
  // variant token. A `redacted` (or any non-original) variant must NOT fall
  // through to the original bytes — until real generated renditions exist, a
  // redacted request fails closed rather than leaking the source document. The
  // variant is part of the signed token, so it cannot be tampered with.
  if (fields.variant !== 'original') {
    return new Response('redacted rendition not available', { status: 501 });
  }

  const db = createNeonDb(connectionString);

  // Replays the original authorization decision against live database
  // state right now, not the state that held when the token was minted
  // (EVI-06/SEC-05: "redemption must recheck access"). A grant revoked, a
  // membership deactivated, or a document version erased since mint all
  // fail here even though both tokens' own signatures remain valid.
  const recheck = await recheckDocumentAccess(db, accessTokenFields);
  if (!recheck.allowed) {
    return new Response('forbidden', { status: 403 });
  }

  const storage = createStorage(db);
  const object = await storage.getObject(key);
  if (!object) return new Response('not found', { status: 404 });

  // Copy into a fresh ArrayBuffer-backed body (a stable, non-generic BodyInit).
  const body = new Uint8Array(object.bytes.byteLength);
  body.set(object.bytes);

  return new Response(body.buffer, {
    status: 200,
    headers: blobResponseHeaders({
      contentType: object.contentType,
      dispositionKind: fields.disposition === 'download' ? 'attachment' : 'inline',
      filename: fields.filename,
    }),
  });
}
