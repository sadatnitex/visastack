/** A fresh, exactly-sized copy, so a view over a larger pooled buffer never leaks bytes beyond the image. */
function freshArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return body.buffer;
}

/**
 * An agency's logo as a response, for the signed-in logo route and the public invitation one: an
 * inline picture of the type the upload check already passed, and never something a browser may run
 * (nosniff, a sandboxing policy, no cross-site use). One place, so both serve it the same way.
 */
export function logoResponse(
  logo: { readonly bytes: Uint8Array; readonly contentType: string },
  cacheControl: string,
): Response {
  return new Response(freshArrayBuffer(logo.bytes), {
    status: 200,
    headers: {
      'Content-Type': logo.contentType,
      'Content-Length': String(logo.bytes.byteLength),
      'Content-Disposition': 'inline; filename="logo"',
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}
