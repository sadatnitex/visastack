'use server';

import {
  type ServiceError,
  setPlanRenewal,
  startPersonCheckout,
  startPersonPayment,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormResult } from '../../../../components/form-feedback';
import { bootstrapAdminEmails } from '../../../../lib/admin-emails';
import { resolveBaseUrl } from '../../../../lib/base-url';
import { paymentUrlFor } from '../../../../lib/payment-urls';
import { paymentPorts } from '../../../../lib/providers';
import { withSession } from '../../../../lib/session';

/**
 * Buying a paid traveller plan from Plan & Usage (ADR 0025 T3c). Both steps take the signed-in
 * person's own scope from the session, so they only ever buy or pay for that person. The services
 * refuse while selling is switched off, whatever this page shows.
 */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAN_PATH = '/app/account/plan';
const NOT_FOUND: FormResult = { ok: false, message: 'This plan is not for sale.' };
const NO_PURCHASE: FormResult = {
  ok: false,
  message: 'We could not find this purchase. Start it again below.',
};

/** What a Pay form gets back: `recent` offers Start Another Payment. */
export interface PayPurchaseState extends FormResult {
  readonly recent?: true;
}

/** The refusals whose own words are written for a traveller (person-billing.ts, payments.ts). */
const PERSON_REASONS = new Set([
  'selling_off',
  'already_covered',
  'plan_not_for_sale',
  'purchase_expired',
  'currency_not_offered',
  'provider_not_configured',
]);

/**
 * A refusal in a traveller's words. The refusals written for them pass through; the rest (the
 * shared payment opening words some for agency invoices) are put plainly.
 */
function personWords(error: ServiceError): FormResult {
  if (error.reason !== undefined && PERSON_REASONS.has(error.reason)) {
    return { ok: false, message: error.message };
  }
  if (error.reason === 'test_mode_owner_only') {
    return {
      ok: false,
      message:
        'Paying for a plan is still being tested, so it is not open yet. Nothing was charged, and your plan stays as it is.',
    };
  }
  if (error.code === 'rate_limited') return { ok: false, message: error.message };
  if (error.code === 'not_found') return NO_PURCHASE;
  if (/already paid/i.test(error.message)) {
    return { ok: false, message: 'This purchase is already paid.' };
  }
  return {
    ok: false,
    message: 'This purchase cannot be paid right now. Please try again in a few minutes.',
  };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** "Get Traveller Plus": makes the purchase and shows it to confirm, with nothing charged yet. */
export async function buyPlanAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const planId = text(formData, 'planId');
  if (!ID.test(planId)) return NOT_FOUND;
  const outcome = await withSession(
    async ({ db, self }): Promise<FormResult | { readonly invoiceId: string }> => {
      const made = await startPersonCheckout(db, self, { planId });
      if (!made.ok) return made.error.code === 'not_found' ? NOT_FOUND : personWords(made.error);
      return { invoiceId: made.value.invoiceId };
    },
  );
  if ('invoiceId' in outcome) {
    // The heading itself: the router moves focus to the element the address names.
    redirect(`${PLAN_PATH}?purchase=${outcome.invoiceId}#confirm-purchase-title`);
  }
  return outcome;
}

/** "Pay with bKash, Nagad, Rocket or Card": opens the payment page for the confirmed purchase. */
export async function payPurchaseAction(
  _prev: PayPurchaseState,
  formData: FormData,
): Promise<PayPurchaseState> {
  const invoiceId = text(formData, 'invoiceId');
  if (!ID.test(invoiceId)) return NO_PURCHASE;
  const startAnother = text(formData, 'startAnother') === 'yes';
  const outcome = await withSession(
    async ({ db, self, email }): Promise<PayPurchaseState | { readonly redirectUrl: string }> => {
      const started = await startPersonPayment(db, paymentPorts(), self, {
        invoiceId,
        urlFor: paymentUrlFor(resolveBaseUrl()),
        startAnother,
        // In the gateway's test mode only the platform owner may pay (ADR 0025 D9).
        actorEmail: email,
        bootstrapEmails: bootstrapAdminEmails(),
      });
      if (!started.ok) return personWords(started.error);
      if (started.value.kind === 'recent_attempt') {
        return {
          ok: true,
          recent: true,
          message:
            'You started paying for this a few minutes ago. If you were charged, you do not need to pay again: it shows here within a few minutes. If the payment page did not open or you closed it, start another payment.',
        };
      }
      return { redirectUrl: started.value.redirectUrl };
    },
  );
  if ('redirectUrl' in outcome) redirect(outcome.redirectUrl);
  return outcome;
}

/**
 * "Stop Renewing" or "Keep Renewing" the person's own paid plan (ADR 0025 T4). Stopping cancels the
 * renewal waiting to be paid and its reminders; the paid period still covers them until it ends.
 */
export async function setRenewalAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const choice = text(formData, 'renews');
  if (choice !== 'yes' && choice !== 'no') {
    return { ok: false, message: 'Choose Stop Renewing or Keep Renewing.' };
  }
  const renews = choice === 'yes';
  const outcome = await withSession(({ db, self }) => setPlanRenewal(db, self, { renews }));
  if (!outcome.ok) {
    return {
      ok: false,
      message:
        outcome.error.code === 'not_found'
          ? 'You have no paid plan to renew.'
          : 'This could not be changed right now. Please try again in a few minutes.',
    };
  }
  revalidatePath(PLAN_PATH);
  return {
    ok: true,
    message: renews
      ? 'Renewing is on again. We remind you 7 days before your plan ends.'
      : 'Renewing is off. Your plan still covers you until it ends, and nothing is charged.',
  };
}
