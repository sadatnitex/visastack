import { createLogThrottle, parseCspReport } from '../../../lib/csp-report';

/**
 * Receives the Content-Security-Policy violation reports browsers post here
 * (`report-uri` in the policy built by `lib/csp.ts`) and writes one structured
 * line per violation to the runtime log, where a blocked resource on a real
 * page can be found by searching for `[csp-violation]`. This is how a policy
 * mistake is noticed in production, and what makes `CSP_MODE=report-only`
 * useful as a rollback.
 *
 * Public and unauthenticated by necessity (browsers send reports without a
 * session), so it does the least that can be useful: it reads a small bounded
 * body, keeps only the fields `lib/csp-report.ts` allows (never the full URL,
 * the script sample or the policy), writes at most a fixed number of lines per
 * minute per instance, and always answers 204 so it reveals nothing. It
 * touches no database and no secret.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const MAX_BODY_BYTES = 16 * 1024;
const ACCEPTED_TYPES: ReadonlySet<string> = new Set([
  'application/csp-report',
  'application/json',
  'application/reports+json',
]);
const HEADERS = { 'Cache-Control': 'private, no-store' };

const admit = createLogThrottle(30, 60_000);

/** Reads at most `maxBytes` of the body, or returns null if there is more. */
async function readBounded(request: Request, maxBytes: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  let chunk = await reader.read();
  while (!chunk.done) {
    received += chunk.value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(chunk.value, { stream: true });
    chunk = await reader.read();
  }
  return text + decoder.decode();
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (!contentType || !ACCEPTED_TYPES.has(contentType)) {
    return new Response(null, { status: 415, headers: HEADERS });
  }

  const text = await readBounded(request, MAX_BODY_BYTES);
  if (text === null) return new Response(null, { status: 413, headers: HEADERS });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400, headers: HEADERS });
  }

  const summary = parseCspReport(body);
  if (summary) {
    const admission = admit(Date.now());
    if (admission.suppressedBefore > 0) {
      console.warn(
        `[csp-violation] ${admission.suppressedBefore} reports were not logged in the previous minute`,
      );
    }
    if (admission.log) console.warn('[csp-violation]', JSON.stringify(summary));
  }
  return new Response(null, { status: 204, headers: HEADERS });
}
