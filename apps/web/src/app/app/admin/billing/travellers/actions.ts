'use server';

import { randomUUID } from 'node:crypto';
import {
  type PersonRefundSource,
  formatAmountForCurrency,
  recordPersonRefund,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../../lib/admin';
import { withSession } from '../../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../../lib/step-up';
import type { RefundFormState } from '../../organizations/[orgId]/refund-state';

/**
 * Records a traveller's full refund made in the gateway panel (ADR 0025 D8, T6b). Platform owner
 * only (`BILLING_REFUND_MANAGE`), with a fresh sign-in check first, exactly as an agency's refund
 * recorded outside VisaStack. The amount is never typed: the form carries what the page showed
 * would go back, and the service records only when that is still all that is left.
 *
 * Every reply carries the values as typed (empty once a refund was recorded) and a fresh
 * idempotency key for the next send. No reply names the person: only the purchase reference.
 */

const PAGE = '/app/admin/billing/travellers';
const DENIED_MESSAGE = 'Only the platform owner can record a refund for a traveller.';
const STALE = 'This page is out of date. Reload it and try again.';
const NOT_FOUND = 'We could not find this payment. Reload the page.';
const STEP_UP_AGAIN = 'Confirm it is you again, then record the refund once more.';
const FIELDS = ['reference', 'refundedOn', 'reason'] as const;

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

function typed(formData: FormData): Readonly<Record<string, string>> {
  return Object.fromEntries(FIELDS.map((name) => [name, text(formData, name)]));
}

/** One typed value (a variable key, so it satisfies both the compiler and the linter). */
function typedValue(values: Readonly<Record<string, string>>, name: string): string {
  return values[name] ?? '';
}

function sourceOf(formData: FormData): PersonRefundSource | null {
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

/** A whole, positive number of minor units as the page wrote it, or null. */
function minorUnitsOf(raw: string): number | null {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function reply(
  result: Omit<RefundFormState, 'nextKey'>,
  values: Readonly<Record<string, string>>,
): RefundFormState {
  // Once a refund was recorded the form starts empty, so a second send is a deliberate new one.
  return { ...result, values: result.ok ? {} : values, nextKey: randomUUID() };
}

/** Which field a service refusal is about, when it is about one. */
function fieldOf(message: string): string | undefined {
  if (message.includes('refund day') || message.includes('day the refund')) return 'refundedOn';
  if (message.includes('refund reference')) return 'reference';
  if (message.includes('reason')) return 'reason';
  return undefined;
}

/** Records a traveller's refund made in the gateway panel: all that is left of one payment. */
export async function recordTravellerRefundAction(
  _prev: RefundFormState,
  formData: FormData,
): Promise<RefundFormState> {
  const values = typed(formData);
  const source = sourceOf(formData);
  const expected = minorUnitsOf(text(formData, 'expectedAmountMinorUnits'));
  const invoiceRef = text(formData, 'invoiceRef');
  const reference = typedValue(values, 'reference');
  const refundedOn = dayOf(typedValue(values, 'refundedOn'));
  const reason = typedValue(values, 'reason');
  if (!source || expected === null) return reply({ ok: false, message: STALE }, values);
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

  let ran = false;
  const result = await withSession(
    async ({ db, accountId, email }): Promise<Omit<RefundFormState, 'nextKey'>> => {
      const staff = await staffPrincipal(
        db,
        { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
        'BILLING_REFUND_MANAGE',
      );
      if (!staff.ok) return { ok: false, message: DENIED_MESSAGE };
      const checked = await tryEstablishStepUp(
        { accountId, action: 'INVOICE_REFUND_RECORD', resourceId: text(formData, 'sourceId') },
        PAGE,
      );
      if (checked.kind === 'not_configured') {
        return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE };
      }
      if (checked.kind === 'reauth_required') redirect(checked.reauthUrl);
      ran = true;
      const done = await recordPersonRefund(db, staff.value, {
        source,
        expectedAmountMinorUnits: expected,
        reference,
        refundedOn,
        reason,
        idempotencyKey: text(formData, 'idempotencyKey'),
        stepUpSatisfied: true,
      });
      if (!done.ok) {
        const { code, message } = done.error;
        if (code === 'forbidden') return { ok: false, message: DENIED_MESSAGE };
        if (code === 'not_found') return { ok: false, message: NOT_FOUND };
        if (code === 'step_up_required') return { ok: false, message: STEP_UP_AGAIN };
        const field = fieldOf(message);
        return field === undefined ? { ok: false, message } : { ok: false, message, field };
      }
      const outcome = done.value;
      const amount = formatAmountForCurrency(outcome.amountMinorUnits, outcome.currency);
      const recorded =
        outcome.code === 'already_recorded'
          ? `This refund was already recorded: ${amount} for ${invoiceRef}. Nothing new was recorded.`
          : `Refund recorded: ${amount} for ${invoiceRef}.`;
      return {
        ok: true,
        message: outcome.outsideWindow ? `${recorded} It was outside the 7 days.` : recorded,
      };
    },
  );
  if (ran) revalidatePath(PAGE);
  return reply(result, values);
}
