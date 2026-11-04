import { UPLOAD_PROBLEM_REASONS } from '../../../../lib/document-upload-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A report is a few small fields; anything bigger is not one. */
const MAX_BYTES = 400;

const reply = (status: number) =>
  new Response(null, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });

const whole = (value: unknown, most: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= most;

/**
 * The upload form tells the server, once, when a file ended with no usable answer: which route,
 * why (no answer, timed out, a server error, an answer that was not ours), the HTTP status, whether
 * it was redirected, and how long it took. The server writes one line to its log and keeps
 * nothing else. Only these fixed fields are read, so no file name, id or value can reach the log.
 * Same-origin only; it needs no sign-in, because a lost sign-in is one of the things it reports.
 */
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply(403);
  const length = Number(request.headers.get('content-length'));
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_BYTES) return reply(413);
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return reply(400);
  }
  if (typeof body !== 'object' || body === null) return reply(400);
  const { route, reason, status, redirected, ms } = body as Record<string, unknown>;
  if (
    (route !== 'upload' && route !== 'hold') ||
    typeof reason !== 'string' ||
    !(UPLOAD_PROBLEM_REASONS as readonly string[]).includes(reason) ||
    !whole(status, 599) ||
    typeof redirected !== 'boolean' ||
    !whole(ms, 600_000)
  ) {
    return reply(400);
  }
  console.warn(
    `upload client problem route=${route} reason=${reason} status=${status} redirected=${redirected} ms=${ms}`,
  );
  return reply(204);
}
