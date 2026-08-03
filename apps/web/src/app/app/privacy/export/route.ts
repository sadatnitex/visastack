import { exportAccount } from '@visastack/services';
import { withSession } from '../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../lib/step-up';

/**
 * Self-service data export (Build Spec §13; PRD §2 — data portability).
 *
 * Streams the signed-in account's complete, structured snapshot as a JSON
 * attachment. Authorization is enforced by `exportAccount` (self-only) after
 * `withSession` establishes the account from the WorkOS session.
 *
 * A full account snapshot (every applicant, document, profile fact, and the
 * audit trail) is exactly the kind of bulk, silent-exfiltration target a
 * hijacked session could otherwise abuse with no further check ever
 * required — so it is step-up gated (master directive §7 "PR 5"), same
 * mechanism as agency bulk export.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const outcome = await withSession(async ({ db, accountId }) => {
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'ACCOUNT_EXPORT', resourceId: accountId },
      request.url,
    );
    if (stepUp.kind === 'not_configured') return { notConfigured: true } as const;
    if (stepUp.kind === 'reauth_required') return { redirect: stepUp.reauthUrl } as const;
    const result = await exportAccount(db, { actorAccountId: accountId, accountId });
    return { snapshot: result.ok ? result.value : null } as const;
  });

  if ('notConfigured' in outcome) {
    return new Response(STEP_UP_NOT_CONFIGURED_MESSAGE, {
      status: 503,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  if ('redirect' in outcome) return Response.redirect(outcome.redirect, 302);
  const snapshot = outcome.snapshot;
  if (!snapshot) return new Response('export failed', { status: 403 });

  const body = JSON.stringify(snapshot, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="visastack-export-${stamp}.json"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
