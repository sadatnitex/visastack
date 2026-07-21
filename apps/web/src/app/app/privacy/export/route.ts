import { exportAccount } from '@visastack/services';
import { withSession } from '../../../../lib/session';

/**
 * Self-service data export (Build Spec §13; PRD §2 — data portability).
 *
 * Streams the signed-in account's complete, structured snapshot as a JSON
 * attachment. Authorization is enforced by `exportAccount` (self-only) after
 * `withSession` establishes the account from the WorkOS session.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const snapshot = await withSession(async ({ db, accountId }) => {
    const result = await exportAccount(db, { actorAccountId: accountId, accountId });
    return result.ok ? result.value : null;
  });

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
