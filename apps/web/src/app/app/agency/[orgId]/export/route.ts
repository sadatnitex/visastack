import { bulkExport } from '@visastack/services';
import { withSession } from '../../../../../lib/session';

/**
 * Permissioned bulk export for an organization (Build Spec §2; PRD §5).
 *
 * Streams a JSON attachment containing ONLY applicants who granted this org an
 * accepted EXPORT_PROFILE grant for the given purpose. Authorization (org
 * OWNER/ADMIN) and per-applicant policy checks are enforced by `bulkExport`.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<Response> {
  const { orgId } = await params;
  const purpose = new URL(request.url).searchParams.get('purpose')?.trim() || 'agency_review';

  const result = await withSession(async ({ db, accountId }) =>
    bulkExport(db, { actorAccountId: accountId, organizationId: orgId, purpose }),
  );

  if (!result.ok) return new Response(`export failed: ${result.error.message}`, { status: 403 });

  const body = JSON.stringify(
    { organizationId: orgId, purpose, applicants: result.value },
    null,
    2,
  );
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="agency-export-${stamp}.json"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
