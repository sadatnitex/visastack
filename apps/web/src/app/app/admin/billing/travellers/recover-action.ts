'use server';

import { randomUUID } from 'node:crypto';
import { formatAmountForCurrency, recoverPersonPayment } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../../lib/admin';
import { paymentPorts } from '../../../../../lib/providers';
import { withSession } from '../../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../../lib/step-up';
import { RECOVER_FIELDS, type RecoverFormState } from './recover-state';

/**
 * Recovers a traveller's payment lost in a restore (owner decision, 2 Nov 2026). Platform owner
 * only (`BILLING_REFUND_MANAGE`), with a fresh sign-in check first, as a refund is. The amount is
 * never typed: the service asks the payment provider what was paid for this transaction and records
 * exactly that, the usual way. No reply names the traveller: only the purchase reference.
 */

const PAGE = '/app/admin/billing/travellers';
const DENIED_MESSAGE = 'Only the platform owner can recover a payment.';
const STEP_UP_AGAIN = 'Confirm it is you again, then recover the payment once more.';

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

/** A traveller's full code (their account id, with or without dashes) as an account id, or null. */
function accountIdOf(raw: string): string | null {
  const hex = raw.replace(/[\s-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Which box a service refusal is about, from its reason (never from its wording). */
const FIELD_BY_REASON: Readonly<Record<string, string>> = {
  recovery_account: 'code',
  recovery_plan: 'planKey',
  recovery_transaction: 'transactionId',
};

export async function recoverTravellerPaymentAction(
  _prev: RecoverFormState,
  formData: FormData,
): Promise<RecoverFormState> {
  const values = Object.fromEntries(RECOVER_FIELDS.map((name) => [name, text(formData, name)]));
  const fail = (message: string, field?: string): RecoverFormState => ({
    ok: false,
    message,
    values,
    replyId: randomUUID(),
    ...(field === undefined ? {} : { field }),
  });
  const accountId = accountIdOf(text(formData, 'code'));
  if (!accountId) {
    return fail("Enter the traveller's account id from the restore report.", 'code');
  }
  const planKey = text(formData, 'planKey');
  if (!/^[a-z0-9_]{1,64}$/.test(planKey)) return fail('Choose the plan they paid for.', 'planKey');
  const transactionId = text(formData, 'transactionId');
  if (!/^VSP[0-9a-f]{26}$/i.test(transactionId)) {
    return fail(
      'Enter the payment code from the payment provider. It starts with VSP.',
      'transactionId',
    );
  }

  let ran = false;
  const result = await withSession(async ({ db, accountId: actor, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId: actor, email, bootstrapEmails: bootstrapAdminEmails() },
      'BILLING_REFUND_MANAGE',
    );
    if (!staff.ok) return fail(DENIED_MESSAGE);
    const checked = await tryEstablishStepUp(
      { accountId: actor, action: 'TRAVELLER_PAYMENT_RECOVER', resourceId: transactionId },
      PAGE,
    );
    if (checked.kind === 'not_configured') return fail(STEP_UP_NOT_CONFIGURED_MESSAGE);
    if (checked.kind === 'reauth_required') redirect(checked.reauthUrl);
    ran = true;
    const done = await recoverPersonPayment(db, paymentPorts(), staff.value, {
      accountId,
      planKey,
      merchantTranId: transactionId,
      stepUpSatisfied: true,
    });
    if (!done.ok) {
      if (done.error.code === 'forbidden') return fail(DENIED_MESSAGE);
      if (done.error.code === 'step_up_required') return fail(STEP_UP_AGAIN);
      return fail(done.error.message, FIELD_BY_REASON[done.error.reason ?? '']);
    }
    const amount = formatAmountForCurrency(done.value.amountMinorUnits, done.value.currency);
    const what = done.value.renewal ? 'their renewal' : 'their plan';
    return {
      ok: true,
      message: `Payment recovered: ${amount} for ${done.value.invoiceRef}. The traveller has ${what}, and their receipt is ready.`,
      values: {},
    } satisfies RecoverFormState;
  });
  if (ran) revalidatePath(PAGE);
  return { ...result, replyId: randomUUID() };
}
