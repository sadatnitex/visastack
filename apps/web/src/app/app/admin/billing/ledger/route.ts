import { exportLedgerMonth } from '@visastack/services';
import { redirect } from 'next/navigation';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../../lib/admin';
import { withSession } from '../../../../../lib/session';
import { tryEstablishStepUp } from '../../../../../lib/step-up';

/**
 * The monthly accounting file (Small Commercial V1 S18): the cash ledger rows written in one
 * Bangladesh calendar month, as CSV. Platform owner only (`BILLING_LEDGER_EXPORT`), with a fresh
 * sign-in check (a stale session is sent to confirm it is them and back to Billing Rules, where
 * the download is asked for again). Never cached. A refusal goes back to the Billing Rules page
 * with a plain reason; nothing about the ledger is ever in the address.
 */

export const dynamic = 'force-dynamic';

const BILLING_PATH = '/app/admin/billing';

function back(reason: 'denied' | 'month' | 'too_many' | 'not_configured'): never {
  redirect(`${BILLING_PATH}?ledger=${reason}#ledger`);
}

export async function GET(request: Request): Promise<Response> {
  const month = new URL(request.url).searchParams.get('month')?.trim() ?? '';
  return withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'BILLING_LEDGER_EXPORT',
    );
    if (!staff.ok) back('denied');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) back('month');
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'BILLING_LEDGER_EXPORT', resourceId: month },
      `${BILLING_PATH}#ledger`,
    );
    if (stepUp.kind === 'not_configured') back('not_configured');
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const exported = await exportLedgerMonth(db, staff.value, { month, stepUpSatisfied: true });
    if (!exported.ok) {
      if (exported.error.code === 'forbidden') back('denied');
      back(
        exported.error.code === 'invalid' && exported.error.message.includes('more than')
          ? 'too_many'
          : 'month',
      );
    }
    return new Response(exported.value.csv, {
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exported.value.filename}"`,
      },
    });
  });
}
