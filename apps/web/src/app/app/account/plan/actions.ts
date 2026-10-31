'use server';

import { startPersonCheckout, startPersonPayment } from '@visastack/services';
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
      if (!made.ok) return { ok: false, message: made.error.message };
      return { invoiceId: made.value.invoiceId };
    },
  );
  if ('invoiceId' in outcome) {
    redirect(`${PLAN_PATH}?purchase=${outcome.invoiceId}#confirm-purchase`);
  }
  return outcome;
}

/** "Pay with bKash, Nagad, Rocket or Card": opens the payment page for the confirmed purchase. */
export async function payPurchaseAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const invoiceId = text(formData, 'invoiceId');
  if (!ID.test(invoiceId)) return NO_PURCHASE;
  const startAnother = text(formData, 'startAnother') === 'yes';
  const outcome = await withSession(
    async ({ db, self, email }): Promise<FormResult | { readonly redirectUrl: string }> => {
      const started = await startPersonPayment(db, paymentPorts(), self, {
        invoiceId,
        urlFor: paymentUrlFor(resolveBaseUrl()),
        startAnother,
        // In the gateway's test mode only the platform owner may pay (ADR 0025 D9).
        actorEmail: email,
        bootstrapEmails: bootstrapAdminEmails(),
      });
      if (!started.ok) {
        return started.error.code === 'not_found'
          ? NO_PURCHASE
          : { ok: false, message: started.error.message };
      }
      if (started.value.kind === 'recent_attempt') {
        return {
          ok: true,
          message:
            'You started paying for this a few minutes ago. If you were charged, you do not need to pay again. Wait a minute, then reload this page.',
        };
      }
      return { redirectUrl: started.value.redirectUrl };
    },
  );
  if ('redirectUrl' in outcome) redirect(outcome.redirectUrl);
  return outcome;
}
