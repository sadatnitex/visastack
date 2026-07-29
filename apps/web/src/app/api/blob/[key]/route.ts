import { verifyBlobToken } from '@visastack/adapters';
import { createNeonDb, resolveDatabaseUrl } from '@visastack/db';
import { createStorage } from '../../../../lib/storage';

/**
 * Signed blob serving route (ADR-0011).
 *
 * Streams a stored object's bytes ONLY when presented with a valid, unexpired
 * HMAC token. The token is minted by `issueReadRef` (Neon-bytea or Vercel
 * Private Blob, whichever backend is active — see `createStorage`) after the
 * policy engine has already authorized the access (in `previewDocument` /
 * `downloadDocument`), so this route re-checks the signature and expiry
 * rather than re-running authorization — the standard signed-URL capability
 * pattern.
 */

export const dynamic = 'force-dynamic';

/** Variable-keyed env read (satisfies both TS index-signature and Biome rules). */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * Build a safe `Content-Disposition` value from an untrusted display filename
 * (master directive §10/§18/§21E: the approved filename, never the opaque
 * object key). Strips control characters and quotes to keep the classic
 * `filename="..."` form unambiguous, and always adds the RFC 5987
 * `filename*=UTF-8''...` form so non-ASCII/legal names round-trip correctly
 * in modern browsers.
 */
function contentDisposition(kind: 'inline' | 'attachment', filename: string | undefined): string {
  if (!filename) return kind;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally stripping control chars from an untrusted header value.
  const cleaned = filename.replace(/[\x00-\x1f\x7f"\\]/g, '').slice(0, 255);
  const encoded = encodeURIComponent(filename).slice(0, 512);
  return `${kind}; filename="${cleaned || 'document'}"; filename*=UTF-8''${encoded}`;
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

  // Security boundary (Milestone 2 / ADR-0011 correction): this route serves the
  // stored ORIGINAL bytes. It may therefore only ever honour an `original`
  // variant token. A `redacted` (or any non-original) variant must NOT fall
  // through to the original bytes — until real generated renditions exist, a
  // redacted request fails closed rather than leaking the source document. The
  // variant is part of the signed token, so it cannot be tampered with.
  if (fields.variant !== 'original') {
    return new Response('redacted rendition not available', { status: 501 });
  }

  const storage = createStorage(createNeonDb(connectionString));
  const object = await storage.getObject(key);
  if (!object) return new Response('not found', { status: 404 });

  // Copy into a fresh ArrayBuffer-backed body (a stable, non-generic BodyInit).
  const body = new Uint8Array(object.bytes.byteLength);
  body.set(object.bytes);

  return new Response(body.buffer, {
    status: 200,
    headers: {
      'Content-Type': object.contentType,
      'Content-Disposition': contentDisposition(
        fields.disposition === 'download' ? 'attachment' : 'inline',
        fields.filename,
      ),
      'Cache-Control': 'private, no-store',
      // Defense in depth alongside the scanner's declared-content-type gate
      // (packages/adapters/src/scanner.ts): never let a browser MIME-sniff
      // stored bytes into an executable type regardless of what Content-Type
      // ended up being served.
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
