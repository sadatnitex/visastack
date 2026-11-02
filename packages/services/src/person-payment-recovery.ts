import { type Result, err, ok } from '@visastack/core';
import type { StaffScope } from './access/principal';
import { staffScopeProblem } from './access/principal';
import type { Db } from './db';
import { type ServiceError, serviceError } from './errors';
import { isMerchantTranId, settlePaymentAttempt } from './payments';
import { prepareRecoveredPersonPayment } from './person-billing';
import type { PaymentPortResolver, PaymentValidation } from './ports';
import { personBillingPresent } from './traveller-billing';

/**
 * Owner decision (2 Nov 2026, "Owner tool", "Record the payment"): a traveller's purchase made
 * after a backup's restore point is lost by the restore, but the payment gateway still holds it.
 * The platform owner recovers it by its transaction id: VisaStack asks the gateway what was paid
 * (never trusting a typed amount), remakes the invoice and the payment attempt, and the usual
 * recording settles it (the gateway's answer checked again, the money recorded online, the
 * receipt, the plan period, the monthly accounting file). Refunds then work as for any purchase.
 * Owner only (BILLING_REFUND_MANAGE); works whether selling is switched on or not.
 */

export interface RecoverPersonPaymentInput {
  readonly accountId: string;
  readonly planId: string;
  /** VisaStack's transaction id (starts with VSP), as the gateway's merchant records show it. */
  readonly merchantTranId: string;
  readonly now?: Date;
}

export interface RecoveredPersonPayment {
  readonly invoiceId: string;
  readonly invoiceRef: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
}

const NOT_ALLOWED = 'Only the platform owner can recover a payment.';
const NOT_AVAILABLE = 'Recovering a payment is not available yet.';
const NO_GATEWAY = 'The payment gateway is not set up, so the payment cannot be checked.';
const BAD_ID = 'That is not a VisaStack transaction id. It starts with VSP.';
const GATEWAY_DOWN = 'The payment gateway did not answer. Try again in a few minutes.';
const NOT_PAID =
  'The payment gateway does not show this transaction as paid, so nothing was recorded.';
const ALREADY = 'This payment is already recorded.';
const COVERED = 'This traveller already has a paid plan now, so nothing was recorded.';
const NOT_TRAVELLER_PLAN = 'Choose a traveller plan.';
const NO_ACCOUNT = 'No traveller has that account.';
const NOT_SETTLED =
  'The payment was found but not recorded. It is waiting for a check on the Traveller Billing page.';

/** A gateway answer that proves this exact transaction was paid, for this store, in BDT. */
function paidAnswer(
  validation: PaymentValidation,
  merchantTranId: string,
  storeId: string | null,
): boolean {
  return (
    (validation.status === 'VALID' || validation.status === 'VALIDATED') &&
    validation.merchantTranId === merchantTranId &&
    validation.currency === 'BDT' &&
    typeof validation.amountMinorUnits === 'number' &&
    Number.isInteger(validation.amountMinorUnits) &&
    validation.amountMinorUnits > 0 &&
    (validation.storeId === null || storeId === null || validation.storeId === storeId)
  );
}

export async function recoverPersonPayment(
  db: Db,
  ports: PaymentPortResolver,
  staff: StaffScope<'BILLING_REFUND_MANAGE'>,
  input: RecoverPersonPaymentInput,
): Promise<Result<RecoveredPersonPayment, ServiceError>> {
  if (staffScopeProblem(staff, 'BILLING_REFUND_MANAGE')) {
    return err(serviceError('forbidden', NOT_ALLOWED));
  }
  if (!(await personBillingPresent(db))) return err(serviceError('invalid', NOT_AVAILABLE));
  const merchantTranId = input.merchantTranId.trim();
  if (!isMerchantTranId(merchantTranId)) return err(serviceError('invalid', BAD_ID));
  const port = ports.forCurrency('BDT');
  if (!port?.configured || port.mode === null) return err(serviceError('invalid', NO_GATEWAY));
  const now = input.now ?? new Date();

  let validation: PaymentValidation;
  try {
    validation = await port.queryByMerchantTranId(merchantTranId);
  } catch {
    return err(serviceError('invalid', GATEWAY_DOWN));
  }
  if (!paidAnswer(validation, merchantTranId, port.storeId)) {
    return err(serviceError('invalid', NOT_PAID));
  }
  const amountMinorUnits = validation.amountMinorUnits as number;

  const prepared = await prepareRecoveredPersonPayment(db, staff, {
    accountId: input.accountId,
    planId: input.planId,
    merchantTranId,
    amountMinorUnits,
    currency: 'BDT',
    provider: port.provider,
    mode: port.mode,
    now,
  });
  if (!prepared.ok) {
    const words = {
      not_found: NO_ACCOUNT,
      not_a_traveller_plan: NOT_TRAVELLER_PLAN,
      already_recorded: ALREADY,
      already_covered: COVERED,
    }[prepared.refusal];
    return err(serviceError(prepared.refusal === 'not_found' ? 'not_found' : 'invalid', words));
  }

  // The usual recording: it asks the gateway again, checks amount, store and currency, records the
  // money online under the person's locks, issues the receipt and starts the paid period.
  const settled = await settlePaymentAttempt(db, port, {
    merchantTranId,
    source: 'reconcile',
    now,
  });
  if (settled.code !== 'recorded' && settled.code !== 'already_recorded') {
    return err(serviceError('invalid', NOT_SETTLED));
  }
  return ok({
    invoiceId: prepared.invoiceId,
    invoiceRef: prepared.invoiceRef,
    amountMinorUnits,
    currency: 'BDT',
  });
}
