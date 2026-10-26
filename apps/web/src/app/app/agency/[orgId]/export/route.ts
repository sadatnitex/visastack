import { bulkExport, referenceCodesFor } from '@visastack/services';
import {
  capabilityUnavailableMessage,
  getPlatformCapabilities,
} from '../../../../../lib/capabilities';
import { withSession } from '../../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../../lib/step-up';

/**
 * Permissioned bulk export for an organization (Build Spec §2; PRD §5).
 *
 * Streams a JSON attachment containing ONLY applicants who granted this org an
 * accepted EXPORT_PROFILE grant for the given purpose. Authorization (org
 * OWNER/ADMIN, real membership role) and per-applicant policy checks are
 * enforced by `bulkExport` (rebuilt from first principles in PR 2 — see
 * docs/audits/commercial-readiness-recovery-baseline.md §7).
 *
 * `EXPORT_PROFILE` is a step-up action (Build Spec §14): `establishStepUp`
 * checks the real WorkOS session recency server-side and, if stale, sends
 * the browser through a genuine WorkOS reauthentication challenge rather
 * than denying outright — completing it redirects back to this exact URL,
 * which retries and this time succeeds. Never a client-supplied boolean.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<Response> {
  const { orgId } = await params;
  const purpose = new URL(request.url).searchParams.get('purpose')?.trim() || 'agency_review';

  if (getPlatformCapabilities().bulkExport !== 'available') {
    return new Response(capabilityUnavailableMessage('bulkExport'), {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  const outcome = await withSession(async ({ db, accountId }) => {
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'EXPORT_PROFILE', resourceId: orgId },
      request.url,
    );
    if (stepUp.kind === 'not_configured') return { notConfigured: true } as const;
    if (stepUp.kind === 'reauth_required') return { redirect: stepUp.reauthUrl } as const;
    const result = await bulkExport(db, {
      actorAccountId: accountId,
      organizationId: orgId,
      purpose,
      stepUpSatisfied: true,
    });
    if (!result.ok) return { result } as const;
    // Each exported person's visible code (`P-7K2Q9M`, ADR 0018), read in one call
    // for exactly the people already in this export and nobody else.
    const codes = await referenceCodesFor(
      db,
      'P',
      result.value.map((row) => row.applicantId),
    );
    const applicants = result.value.map((row) => {
      const referenceCode = codes.get(row.applicantId);
      return referenceCode ? { ...row, referenceCode } : row;
    });
    return { result, applicants } as const;
  });

  if ('notConfigured' in outcome) {
    return new Response(STEP_UP_NOT_CONFIGURED_MESSAGE, {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  if ('redirect' in outcome) return Response.redirect(outcome.redirect, 302);
  const result = outcome.result;
  if (!result.ok) {
    // See the account export route: a rate-limit refusal is a 429, not a 403.
    if (result.error.code === 'rate_limited') {
      return new Response(result.error.message, {
        status: 429,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    return new Response(`export failed: ${result.error.message}`, { status: 403 });
  }

  const applicants = 'applicants' in outcome ? outcome.applicants : result.value;
  const body = JSON.stringify({ organizationId: orgId, purpose, applicants }, null, 2);
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
