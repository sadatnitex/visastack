'use server';

import { randomUUID } from 'node:crypto';
import {
  REFUNDS_UNAVAILABLE,
  RETRY_REFUSED_CODE,
  type RefundOutcome,
  type RefundRequestView,
  type RefundSource,
  type StaffScope,
  applyHeldPaymentCredit,
  cancelRefund,
  checkRefundsNow,
  confirmUnsentRefund,
  formatAmountForCurrency,
  parseAmountForCurrency,
  recordManualRefund,
  requestRefund,
  retryRefund,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../../lib/admin';
import {
  REFUNDS_IN_PANEL,
  refundCheckPort,
  refundSendPort,
} from '../../../../../lib/refund-gateway';
import { withSession } from '../../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../../lib/step-up';
import type { RefundFormState } from './refund-state';

/**
 * Refunds and credits on the admin organization page (Small Commercial V1 S18). Platform owner
 * only (`BILLING_REFUND_MANAGE`), and every action that moves or releases money asks for a fresh
 * sign-in check first. Only "Check Now" does not: it records nothing but what the payment gateway
 * itself confirms, exactly as the daily check does.
 *
 * Every reply carries the values as typed (so nothing is lost when a form is drawn again), a fresh
 * idempotency key for the next send, and, after a refund, the id of its line in the Refunds list so
 * focus can move there. The page is refreshed whenever an action ran, whatever its answer, because
 * a refused or unconfirmed send still wrote a refund request.
 */

const DENIED_MESSAGE = 'Only the platform owner can refund or apply credits.';
const STALE = 'This page is out of date. Reload it and try again.';

const UNCONFIRMED =
  "We could not confirm the refund was sent. Check the payment gateway's merchant panel, then choose It Went Through or It Did Not Go Through on the refund below.";
const RETRY_REFUSED =
  'The payment gateway answered "failed" to the second send. That can mean the first send already went through, so the amount stays blocked. Check the payment gateway\'s merchant panel, then choose It Went Through or It Did Not Go Through.';

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

function returnPath(organizationId: string): string {
  return `/app/admin/organizations/${organizationId}`;
}

/** The line a refund has in the Refunds list, which focus moves to after an action. */
function lineId(requestId: string): string {
  return `refund-line-${requestId}`;
}

/** The typed values sent back with every reply, so a form drawn again keeps them. */
function typed(formData: FormData, names: readonly string[]): Readonly<Record<string, string>> {
  return Object.fromEntries(names.map((name) => [name, text(formData, name)]));
}

/** One typed value (a variable key, so it satisfies both the compiler and the linter). */
function typedValue(values: Readonly<Record<string, string>>, name: string): string {
  return values[name] ?? '';
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

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What an earlier request that this same form already made stands at, in plain words. */
function replayMessage(request: RefundRequestView): Omit<RefundFormState, 'nextKey'> {
  switch (request.status) {
    case 'REQUESTED':
      return { ok: false, message: `This refund was already asked for. ${UNCONFIRMED}` };
    case 'SUBMITTED':
      return {
        ok: true,
        message: 'This refund was already sent. It shows as Refunded once the gateway confirms it.',
      };
    case 'CONFIRMED':
      return { ok: true, message: 'This refund was already made. Nothing new was sent.' };
    case 'FAILED':
      return {
        ok: false,
        message:
          'This form was already used for a refund that did not go through. Nothing new was sent. Fill it in again to try once more.',
      };
    case 'CANCELLED':
      return {
        ok: false,
        message:
          'This form was already used for a refund that was cancelled. Nothing new was sent. Fill it in again to try once more.',
      };
  }
}

function outcomeMessage(outcome: RefundOutcome): Omit<RefundFormState, 'nextKey'> {
  const amount = formatAmountForCurrency(
    outcome.request.amountMinorUnits,
    outcome.request.currency,
  );
  const focusId = lineId(outcome.request.id);
  switch (outcome.code) {
    case 'sent':
      return {
        ok: true,
        focusId,
        message: `Refund of ${amount} sent to the payment gateway. It shows as Refunded once the gateway confirms it.`,
      };
    case 'refused':
      return {
        ok: false,
        focusId,
        message: 'The payment gateway refused this refund. Nothing was refunded.',
      };
    case 'unconfirmed':
      return {
        ok: false,
        focusId,
        message: outcome.request.failureCode === RETRY_REFUSED_CODE ? RETRY_REFUSED : UNCONFIRMED,
      };
    case 'already_requested':
      return { ...replayMessage(outcome.request), focusId };
    case 'recorded':
      return {
        ok: true,
        focusId,
        message: `Refund of ${amount} recorded. The invoice now shows it.`,
      };
  }
}

type SessionDb = Parameters<Parameters<typeof withSession>[0]>[0]['db'];

/**
 * The shared shape of every action: the platform owner's scope, then (for money) the fresh
 * sign-in check, which sends the person to confirm it is them and back to this page.
 */
async function asOwner(
  organizationId: string,
  values: Readonly<Record<string, string>>,
  stepUp: { readonly action: string; readonly resourceId: string } | null,
  work: (ctx: {
    readonly db: SessionDb;
    readonly staff: StaffScope<'BILLING_REFUND_MANAGE'>;
  }) => Promise<Omit<RefundFormState, 'nextKey'>>,
): Promise<RefundFormState> {
  let ran = false;
  const result = await withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'BILLING_REFUND_MANAGE',
    );
    if (!staff.ok) return { ok: false, message: DENIED_MESSAGE };
    if (stepUp) {
      const checked = await tryEstablishStepUp(
        { accountId, action: stepUp.action, resourceId: stepUp.resourceId },
        returnPath(organizationId),
      );
      if (checked.kind === 'not_configured') {
        return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE };
      }
      if (checked.kind === 'reauth_required') redirect(checked.reauthUrl);
    }
    ran = true;
    return work({ db, staff: staff.value });
  });
  // Refused and unconfirmed sends write a request too, so the page is drawn again either way.
  if (ran) revalidatePath(returnPath(organizationId));
  return reply(result, values);
}

function reply(
  result: Omit<RefundFormState, 'nextKey'>,
  values: Readonly<Record<string, string>>,
): RefundFormState {
  // Once a refund request was written (it has a line to focus), the form starts empty again, so a
  // second send is always a deliberate new refund.
  const written = result.ok || result.focusId !== undefined;
  return { ...result, values: written ? {} : values, nextKey: randomUUID() };
}

function refusal(message: string, code: string, field?: string): Omit<RefundFormState, 'nextKey'> {
  if (code === 'forbidden') return { ok: false, message: DENIED_MESSAGE };
  return field === undefined ? { ok: false, message } : { ok: false, message, field };
}

/** Which field a service's day or reference refusal is about. */
function fieldOf(message: string): string | undefined {
  if (message.includes('refund day') || message.includes('day the refund')) return 'refundedOn';
  if (message.includes('refund reference')) return 'reference';
  if (message.includes('more than') || message.includes('amount')) return 'amount';
  return undefined;
}

const REFUND_FIELDS = ['amount', 'reason'] as const;
const MANUAL_FIELDS = ['amount', 'reference', 'refundedOn', 'reason'] as const;

/** Asks the payment gateway to refund part or all of one payment. */
export async function requestRefundAction(
  _prev: RefundFormState,
  formData: FormData,
): Promise<RefundFormState> {
  const values = typed(formData, REFUND_FIELDS);
  const organizationId = text(formData, 'organizationId');
  const source = sourceOf(formData);
  const amount = parseAmountForCurrency(typedValue(values, 'amount'), text(formData, 'currency'));
  const reason = typedValue(values, 'reason');
  if (!source) return reply({ ok: false, message: STALE }, values);
  if (amount === null || amount <= 0) {
    return reply(
      { ok: false, message: 'Enter the amount to refund, for example 1500.00.', field: 'amount' },
      values,
    );
  }
  if (reason.length === 0 || reason.length > 500) {
    return reply(
      { ok: false, message: 'Give a reason, up to 500 characters.', field: 'reason' },
      values,
    );
  }
  const gateway = refundSendPort();
  if (!gateway) return reply({ ok: false, message: REFUNDS_IN_PANEL }, values);
  return asOwner(
    organizationId,
    values,
    { action: 'INVOICE_REFUND_REQUEST', resourceId: text(formData, 'sourceId') },
    async ({ db, staff }) => {
      const done = await requestRefund(db, gateway, staff, {
        organizationId,
        source,
        amountMinorUnits: amount,
        reason,
        idempotencyKey: text(formData, 'idempotencyKey'),
        stepUpSatisfied: true,
      });
      if (!done.ok)
        return refusal(done.error.message, done.error.code, fieldOf(done.error.message));
      return outcomeMessage(done.value);
    },
  );
}

/** Records a refund already made outside VisaStack (a bank transfer back, or in the gateway panel). */
export async function recordManualRefundAction(
  _prev: RefundFormState,
  formData: FormData,
): Promise<RefundFormState> {
  const values = typed(formData, MANUAL_FIELDS);
  const organizationId = text(formData, 'organizationId');
  const source = sourceOf(formData);
  const amount = parseAmountForCurrency(typedValue(values, 'amount'), text(formData, 'currency'));
  const reference = typedValue(values, 'reference');
  const refundedOn = dayOf(typedValue(values, 'refundedOn'));
  const reason = typedValue(values, 'reason');
  if (!source) return reply({ ok: false, message: STALE }, values);
  if (amount === null || amount <= 0) {
    return reply(
      { ok: false, message: 'Enter the amount refunded, for example 1500.00.', field: 'amount' },
      values,
    );
  }
  if (reference.length === 0 || reference.length > 120) {
    return reply(
      {
        ok: false,
        message: 'Enter the refund reference, up to 120 characters.',
        field: 'reference',
      },
      values,
    );
  }
  if (!refundedOn) {
    return reply(
      { ok: false, message: 'Enter the day the refund was made.', field: 'refundedOn' },
      values,
    );
  }
  if (reason.length === 0 || reason.length > 500) {
    return reply(
      { ok: false, message: 'Give a reason, up to 500 characters.', field: 'reason' },
      values,
    );
  }
  return asOwner(
    organizationId,
    values,
    { action: 'INVOICE_REFUND_RECORD', resourceId: text(formData, 'sourceId') },
    async ({ db, staff }) => {
      const done = await recordManualRefund(db, staff, {
        organizationId,
        source,
        amountMinorUnits: amount,
        reference,
        refundedOn,
        reason,
        idempotencyKey: text(formData, 'idempotencyKey'),
        stepUpSatisfied: true,
      });
      if (!done.ok)
        return refusal(done.error.message, done.error.code, fieldOf(done.error.message));
      return outcomeMessage(done.value);
    },
  );
}

/** Counts held money towards an open invoice of the same agency, once. */
export async function applyCreditAction(
  _prev: RefundFormState,
  formData: FormData,
): Promise<RefundFormState> {
  const values = typed(formData, ['targetInvoiceId']);
  const organizationId = text(formData, 'organizationId');
  const paymentAttemptId = text(formData, 'paymentAttemptId');
  const target = typedValue(values, 'targetInvoiceId');
  return asOwner(
    organizationId,
    values,
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
  _prev: RefundFormState,
  formData: FormData,
): Promise<RefundFormState> {
  const organizationId = text(formData, 'organizationId');
  const gateway = refundCheckPort();
  if (!gateway) {
    return reply({ ok: false, message: 'The payment gateway is not set up here.' }, {});
  }
  return asOwner(organizationId, {}, null, async ({ db, staff }) => {
    const checked = await checkRefundsNow(db, gateway, staff, { organizationId });
    if (!checked.ok) return refusal(checked.error.message, checked.error.code);
    const summary = checked.value;
    if (!summary.available) return { ok: false, message: REFUNDS_UNAVAILABLE };
    if (!summary.configured)
      return { ok: false, message: 'The payment gateway is not set up here.' };
    if (summary.checked === 0 && summary.leftForLater === 0) {
      return { ok: true, message: 'No sent refund is waiting.' };
    }
    if (summary.unavailable > 0 && summary.unavailable === summary.checked) {
      return {
        ok: false,
        message: `The payment gateway could not be reached, so ${plural(summary.unavailable, 'refund was', 'refunds were')} not asked about. Try again later.`,
      };
    }
    const parts = [
      summary.confirmed > 0 ? `${summary.confirmed} refunded` : null,
      summary.failed > 0 ? `${summary.failed} not completed` : null,
      summary.stillProcessing > 0 ? `${summary.stillProcessing} still on the way` : null,
      summary.needsCheck > 0 ? `${plural(summary.needsCheck, 'needs', 'need')} a check` : null,
      summary.unavailable > 0 ? `${summary.unavailable} could not be asked` : null,
      summary.leftForLater > 0 ? `${summary.leftForLater} left for the next check` : null,
    ].filter((part): part is string => part !== null);
    return { ok: true, message: `Checked with the payment gateway: ${parts.join(', ')}.` };
  });
}

/** Sends again, with the same refund id, a refund whose sending could not be confirmed. */
export async function retryRefundAction(
  _prev: RefundFormState,
  formData: FormData,
): Promise<RefundFormState> {
  const organizationId = text(formData, 'organizationId');
  const refundRequestId = text(formData, 'refundRequestId');
  const gateway = refundSendPort();
  if (!gateway) return reply({ ok: false, message: REFUNDS_IN_PANEL }, {});
  return asOwner(
    organizationId,
    {},
    { action: 'INVOICE_REFUND_REQUEST', resourceId: refundRequestId },
    async ({ db, staff }) => {
      const done = await retryRefund(db, gateway, staff, {
        organizationId,
        refundRequestId,
        stepUpSatisfied: true,
      });
      if (!done.ok) return refusal(done.error.message, done.error.code);
      return outcomeMessage(done.value);
    },
  );
}

/** "It Went Through": records a refund found in the gateway panel, with the panel's reference and day. */
export async function confirmUnsentRefundAction(
  _prev: RefundFormState,
  formData: FormData,
): Promise<RefundFormState> {
  const values = typed(formData, ['amount', 'reference', 'refundedOn']);
  const organizationId = text(formData, 'organizationId');
  const refundRequestId = text(formData, 'refundRequestId');
  const reference = typedValue(values, 'reference');
  const refundedOn = dayOf(typedValue(values, 'refundedOn'));
  const amount = parseAmountForCurrency(typedValue(values, 'amount'), text(formData, 'currency'));
  if (amount === null || amount <= 0) {
    return reply(
      {
        ok: false,
        message: 'Enter the amount the merchant panel shows, for example 1500.00.',
        field: 'amount',
      },
      values,
    );
  }
  if (reference.length === 0 || reference.length > 120) {
    return reply(
      {
        ok: false,
        message: 'Enter the refund reference the merchant panel shows, up to 120 characters.',
        field: 'reference',
      },
      values,
    );
  }
  if (!refundedOn) {
    return reply(
      { ok: false, message: 'Enter the day the refund was made.', field: 'refundedOn' },
      values,
    );
  }
  return asOwner(
    organizationId,
    values,
    { action: 'INVOICE_REFUND_CONFIRM', resourceId: refundRequestId },
    async ({ db, staff }) => {
      const done = await confirmUnsentRefund(db, staff, {
        organizationId,
        refundRequestId,
        reference,
        amountMinorUnits: amount,
        refundedOn,
        stepUpSatisfied: true,
      });
      if (!done.ok)
        return refusal(done.error.message, done.error.code, fieldOf(done.error.message));
      return {
        ok: true,
        focusId: lineId(done.value.id),
        message: 'Refund recorded as made. The invoice now shows it.',
      };
    },
  );
}

/** "It Did Not Go Through": cancels a refund the gateway panel does not show, with a reason. */
export async function cancelRefundAction(
  _prev: RefundFormState,
  formData: FormData,
): Promise<RefundFormState> {
  const values = typed(formData, ['reason']);
  const organizationId = text(formData, 'organizationId');
  const refundRequestId = text(formData, 'refundRequestId');
  const reason = typedValue(values, 'reason');
  if (reason.length === 0 || reason.length > 500) {
    return reply(
      { ok: false, message: 'Give a reason, up to 500 characters.', field: 'reason' },
      values,
    );
  }
  return asOwner(
    organizationId,
    values,
    { action: 'INVOICE_REFUND_CANCEL', resourceId: refundRequestId },
    async ({ db, staff }) => {
      const done = await cancelRefund(db, staff, {
        organizationId,
        refundRequestId,
        reason,
        stepUpSatisfied: true,
      });
      if (!done.ok) return refusal(done.error.message, done.error.code);
      return {
        ok: true,
        focusId: lineId(done.value.id),
        message: 'Refund cancelled. Its amount can be refunded again.',
      };
    },
  );
}
