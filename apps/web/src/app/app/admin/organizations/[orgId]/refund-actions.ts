'use server';

import {
  REFUNDS_UNAVAILABLE,
  type RefundOutcome,
  type RefundSource,
  type StaffScope,
  applyHeldPaymentCredit,
  cancelRefund,
  checkRefundsNow,
  formatAmountForCurrency,
  parseAmountForCurrency,
  recordManualRefund,
  requestRefund,
  retryRefund,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormResult } from '../../../../../components/form-feedback';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../../lib/admin';
import { createPaymentPort } from '../../../../../lib/providers';
import { withSession } from '../../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../../lib/step-up';

/**
 * Refunds and credits on the admin organization page (Small Commercial V1 S18). Platform owner
 * only (`BILLING_REFUND_MANAGE`), and every action that moves or releases money asks for a fresh
 * sign-in check first. Only "Check Now" does not: it records nothing but what the payment gateway
 * itself confirms, exactly as the daily check does.
 */

const DENIED: FormResult = {
  ok: false,
  message: 'Only the platform owner can refund or apply credits.',
};

const UNCONFIRMED =
  "We could not confirm the refund was sent. Check the payment gateway's merchant panel, then send it again or cancel it here.";

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

function returnPath(organizationId: string): string {
  return `/app/admin/organizations/${organizationId}`;
}

function sourceOf(formData: FormData): RefundSource | null {
  const id = text(formData, 'sourceId');
  if (id.length === 0) return null;
  const kind = text(formData, 'sourceKind');
  if (kind === 'entry') return { kind: 'entry', invoicePaymentId: id };
  if (kind === 'held') return { kind: 'held', paymentAttemptId: id };
  return null;
}

/** A day typed as YYYY-MM-DD, as UTC midnight of that day (how billing days are stored), or null. */
function dayOf(raw: string): Date | null {
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const at = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== raw ? null : at;
}

function outcomeMessage(outcome: RefundOutcome): FormResult {
  const amount = formatAmountForCurrency(
    outcome.request.amountMinorUnits,
    outcome.request.currency,
  );
  switch (outcome.code) {
    case 'sent':
      return {
        ok: true,
        message: `Refund of ${amount} sent to the payment gateway. It shows as Refunded once the gateway confirms it.`,
      };
    case 'refused':
      return {
        ok: false,
        message: 'The payment gateway refused this refund. Nothing was refunded.',
      };
    case 'unconfirmed':
      return { ok: false, message: UNCONFIRMED };
    case 'already_requested':
      return { ok: true, message: 'This refund was already asked for. Nothing new was sent.' };
    case 'recorded':
      return { ok: true, message: `Refund of ${amount} recorded. The invoice now shows it.` };
  }
}

type SessionDb = Parameters<Parameters<typeof withSession>[0]>[0]['db'];

/**
 * The shared shape of every action: the platform owner's scope, then (for money) the fresh
 * sign-in check, which sends the person to confirm it is them and back to this page.
 */
async function asOwner(
  organizationId: string,
  stepUp: { readonly action: string; readonly resourceId: string } | null,
  work: (ctx: {
    readonly db: SessionDb;
    readonly staff: StaffScope<'BILLING_REFUND_MANAGE'>;
  }) => Promise<FormResult>,
): Promise<FormResult> {
  const result = await withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'BILLING_REFUND_MANAGE',
    );
    if (!staff.ok) return DENIED;
    if (stepUp) {
      const checked = await tryEstablishStepUp(
        { accountId, action: stepUp.action, resourceId: stepUp.resourceId },
        returnPath(organizationId),
      );
      if (checked.kind === 'not_configured') {
        return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies FormResult;
      }
      if (checked.kind === 'reauth_required') redirect(checked.reauthUrl);
    }
    return work({ db, staff: staff.value });
  });
  if (result.ok) revalidatePath(returnPath(organizationId));
  return result;
}

function refusal(message: string, code: string): FormResult {
  if (code === 'forbidden') return DENIED;
  return { ok: false, message };
}

/** Asks the payment gateway to refund part or all of one payment. */
export async function requestRefundAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const organizationId = text(formData, 'organizationId');
  const source = sourceOf(formData);
  const currency = text(formData, 'currency');
  const amount = parseAmountForCurrency(text(formData, 'amount'), currency);
  const reason = text(formData, 'reason');
  const idempotencyKey = text(formData, 'idempotencyKey');
  if (!source) return { ok: false, message: 'This page is out of date. Reload it and try again.' };
  if (amount === null || amount <= 0) {
    return {
      ok: false,
      message: 'Enter the amount to refund, for example 1500.00.',
      field: 'amount',
    };
  }
  if (reason.length === 0 || reason.length > 500) {
    return { ok: false, message: 'Give a reason, up to 500 characters.', field: 'reason' };
  }
  return asOwner(
    organizationId,
    { action: 'INVOICE_REFUND_REQUEST', resourceId: text(formData, 'sourceId') },
    async ({ db, staff }) => {
      const done = await requestRefund(db, createPaymentPort(), staff, {
        organizationId,
        source,
        amountMinorUnits: amount,
        reason,
        idempotencyKey,
        stepUpSatisfied: true,
      });
      if (!done.ok) return refusal(done.error.message, done.error.code);
      return outcomeMessage(done.value);
    },
  );
}

/** Records a refund already made outside VisaStack (a bank transfer back, or in the gateway panel). */
export async function recordManualRefundAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const organizationId = text(formData, 'organizationId');
  const source = sourceOf(formData);
  const currency = text(formData, 'currency');
  const amount = parseAmountForCurrency(text(formData, 'amount'), currency);
  const reference = text(formData, 'reference');
  const refundedOn = dayOf(text(formData, 'refundedOn'));
  const reason = text(formData, 'reason');
  const idempotencyKey = text(formData, 'idempotencyKey');
  if (!source) return { ok: false, message: 'This page is out of date. Reload it and try again.' };
  if (amount === null || amount <= 0) {
    return {
      ok: false,
      message: 'Enter the amount refunded, for example 1500.00.',
      field: 'amount',
    };
  }
  if (reference.length === 0 || reference.length > 120) {
    return {
      ok: false,
      message: 'Enter the refund reference, up to 120 characters.',
      field: 'reference',
    };
  }
  if (!refundedOn) {
    return { ok: false, message: 'Enter the day the refund was made.', field: 'refundedOn' };
  }
  if (reason.length === 0 || reason.length > 500) {
    return { ok: false, message: 'Give a reason, up to 500 characters.', field: 'reason' };
  }
  return asOwner(
    organizationId,
    { action: 'INVOICE_REFUND_RECORD', resourceId: text(formData, 'sourceId') },
    async ({ db, staff }) => {
      const done = await recordManualRefund(db, staff, {
        organizationId,
        source,
        amountMinorUnits: amount,
        reference,
        refundedOn,
        reason,
        idempotencyKey,
        stepUpSatisfied: true,
      });
      if (!done.ok) return refusal(done.error.message, done.error.code);
      return outcomeMessage(done.value);
    },
  );
}

/** Counts held money towards an open invoice of the same agency, once. */
export async function applyCreditAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const organizationId = text(formData, 'organizationId');
  const paymentAttemptId = text(formData, 'paymentAttemptId');
  const target = text(formData, 'targetInvoiceId');
  return asOwner(
    organizationId,
    { action: 'INVOICE_CREDIT_APPLY', resourceId: paymentAttemptId },
    async ({ db, staff }) => {
      const done = await applyHeldPaymentCredit(db, staff, {
        organizationId,
        paymentAttemptId,
        targetInvoiceId: target.length > 0 ? target : null,
        stepUpSatisfied: true,
      });
      if (!done.ok) return refusal(done.error.message, done.error.code);
      const credited = done.value;
      if (credited.alreadyApplied) {
        return {
          ok: true,
          message: `This payment was already applied to invoice ${credited.invoiceRef}.`,
        };
      }
      return {
        ok: true,
        message:
          credited.remainingMinorUnits > 0
            ? `Credit applied to invoice ${credited.invoiceRef}. What is left of this payment can only be refunded.`
            : `Credit applied to invoice ${credited.invoiceRef}.`,
      };
    },
  );
}

/** Asks the payment gateway about this agency's sent refunds now. Records only what the gateway confirms. */
export async function checkRefundsAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const organizationId = text(formData, 'organizationId');
  return asOwner(organizationId, null, async ({ db, staff }) => {
    const checked = await checkRefundsNow(db, createPaymentPort(), staff, { organizationId });
    if (!checked.ok) return refusal(checked.error.message, checked.error.code);
    const summary = checked.value;
    if (!summary.available) return { ok: false, message: REFUNDS_UNAVAILABLE };
    if (!summary.configured) {
      return { ok: false, message: 'The payment gateway is not available here.' };
    }
    if (summary.checked === 0) return { ok: true, message: 'No sent refund is waiting.' };
    if (summary.unavailable > 0 && summary.unavailable === summary.checked) {
      return { ok: false, message: 'The payment gateway could not be reached. Try again later.' };
    }
    const parts = [
      summary.confirmed > 0 ? `${summary.confirmed} refunded` : null,
      summary.failed > 0 ? `${summary.failed} not completed` : null,
      summary.stillProcessing > 0 ? `${summary.stillProcessing} still on the way` : null,
      summary.needsCheck > 0 ? `${summary.needsCheck} need a check` : null,
    ].filter((part): part is string => part !== null);
    return { ok: true, message: `Checked with the payment gateway: ${parts.join(', ')}.` };
  });
}

/** Sends again, with the same refund id, a refund whose sending could not be confirmed. */
export async function retryRefundAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const organizationId = text(formData, 'organizationId');
  const refundRequestId = text(formData, 'refundRequestId');
  return asOwner(
    organizationId,
    { action: 'INVOICE_REFUND_REQUEST', resourceId: refundRequestId },
    async ({ db, staff }) => {
      const done = await retryRefund(db, createPaymentPort(), staff, {
        organizationId,
        refundRequestId,
        stepUpSatisfied: true,
      });
      if (!done.ok) return refusal(done.error.message, done.error.code);
      return outcomeMessage(done.value);
    },
  );
}

/** Cancels a refund whose sending could not be confirmed, after checking the gateway panel. */
export async function cancelRefundAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const organizationId = text(formData, 'organizationId');
  const refundRequestId = text(formData, 'refundRequestId');
  const reason = text(formData, 'reason');
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };
  return asOwner(
    organizationId,
    { action: 'INVOICE_REFUND_CANCEL', resourceId: refundRequestId },
    async ({ db, staff }) => {
      const done = await cancelRefund(db, staff, {
        organizationId,
        refundRequestId,
        reason,
        stepUpSatisfied: true,
      });
      if (!done.ok) return refusal(done.error.message, done.error.code);
      return { ok: true, message: 'Refund cancelled. Its amount can be refunded again.' };
    },
  );
}
