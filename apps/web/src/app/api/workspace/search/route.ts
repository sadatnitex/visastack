import {
  type WorkspaceSearchScope,
  checkRateLimit,
  searchWorkspaceRecords,
} from '@visastack/services';
import { withSession } from '../../../../lib/session';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers });

/** Search terms stay in a bounded POST body, never the URL or a document-text index. */
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return response({ error: 'Request refused.' }, 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return response({ error: 'Use a JSON request.' }, 415);
  const reader = request.body?.getReader();
  if (!reader) return response({ error: 'Provide a search request.' }, 400);
  let body: unknown;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return response({ error: 'Search request is too large.' }, 413);
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return response({ error: 'Provide a valid search request.' }, 400);
  }
  if (
    !body ||
    typeof body !== 'object' ||
    !('query' in body) ||
    typeof body.query !== 'string' ||
    !('scope' in body) ||
    !body.scope ||
    typeof body.scope !== 'object' ||
    !('kind' in body.scope)
  )
    return response({ error: 'Choose a search workspace.' }, 400);
  const scope = body.scope;
  let selected: WorkspaceSearchScope;
  if (
    scope.kind === 'agency' &&
    'organizationId' in scope &&
    typeof scope.organizationId === 'string'
  )
    selected = { kind: 'agency', organizationId: scope.organizationId };
  else if (
    scope.kind === 'personal' &&
    (!('applicantId' in scope) || typeof scope.applicantId === 'string')
  )
    selected =
      'applicantId' in scope
        ? { kind: 'personal', applicantId: scope.applicantId as string }
        : { kind: 'personal' };
  else return response({ error: 'Choose a search workspace.' }, 400);
  const query = body.query;
  if (query.trim().length < 2 || query.trim().length > 80)
    return response({ error: 'Use between 2 and 80 characters.' }, 400);
  return withSession(async ({ db, accountId }) => {
    const allowed = await checkRateLimit(
      db,
      { subjectId: accountId, action: 'workspace.search', label: 'search' },
      { limit: 60, windowMs: 60_000 },
    );
    if (!allowed.allowed)
      return response({ error: 'Too many searches. Try again in a minute.' }, 429);
    const result = await searchWorkspaceRecords(db, accountId, selected, query);
    if (!result.ok)
      return response(
        { error: result.error.message },
        result.error.code === 'forbidden' ? 403 : 400,
      );
    return response({ results: result.value });
  });
}
