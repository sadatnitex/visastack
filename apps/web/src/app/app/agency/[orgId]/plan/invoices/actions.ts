'use server';

import {
  PROOF_FILE_MAX_BYTES,
  formatAmountForCurrency,
  parseAmountForCurrency,
  refreshInvoicePaymentAttempts,
  startOnlinePayment,
  submitManualPaymentClaim,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { resolveBaseUrl } from '../../../../../../lib/base-url';
import { paymentUrlFor } from '../../../../../../lib/payment-urls';
import { createMalwareScanner, createPaymentPort } from '../../../../../../lib/providers';
import { withSession } from '../../../../../../lib/session';
import { createStorage } from '../../../../../../lib/storage';

/** What an Invoices form gets back. `field` names the input a problem is about. */
export interface InvoiceActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly field?: string;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND: InvoiceActionState = { ok: false, message: 'We could not find this invoice.' };
const UNAVAILABLE: InvoiceActionState = {
  ok: false,
  message: 'Online payment is not available yet. Please try again later.',
};

function invoicesPath(organizationId: string): string {
  return `/app/agency/${organizationId}/plan/invoices`;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function ids(formData: FormData): { organizationId: string; invoiceId: string } | null {
  const organizationId = text(formData, 'organizationId');
  const invoiceId = text(formData, 'invoiceId');
  return ID.test(organizationId) && ID.test(invoiceId) ? { organizationId, invoiceId } : null;
}

/**
 * Starts paying the whole balance of one invoice online and sends the person to the payment page.
 * Owners and admins of the agency only (the service decides; anyone else is told the invoice was
 * not found). When a payment for the invoice was started a few minutes ago the person is shown it
 * first and must ask for another on purpose.
 */
export async function startPaymentAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const found = ids(formData);
  if (!found) return NOT_FOUND;
  const startAnother = text(formData, 'startAnother') === 'yes';

  const outcome = await withSession(
    async ({ db, accountId }): Promise<InvoiceActionState | { readonly redirectUrl: string }> => {
      let port: ReturnType<typeof createPaymentPort>;
      try {
        port = createPaymentPort();
      } catch {
        return UNAVAILABLE;
      }
      const started = await startOnlinePayment(db, port, {
        actorAccountId: accountId,
        invoiceId: found.invoiceId,
        urlFor: paymentUrlFor(resolveBaseUrl()),
        startAnother,
      });
      if (!started.ok) return { ok: false, message: started.error.message };
      if (started.value.kind === 'recent_attempt') {
        return {
          ok: true,
          message:
            'A payment for this invoice was started a few minutes ago. Check it before paying again.',
        };
      }
      return { redirectUrl: started.value.redirectUrl };
    },
  );
  if ('redirectUrl' in outcome) redirect(outcome.redirectUrl);
  revalidatePath(invoicesPath(found.organizationId));
  return outcome;
}

/** Asks the payment gateway about this invoice's open payments now ("Check Status"). */
export async function checkPaymentAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const found = ids(formData);
  if (!found) return NOT_FOUND;
  const result = await withSession(async ({ db, accountId }): Promise<InvoiceActionState> => {
    let port: ReturnType<typeof createPaymentPort>;
    try {
      port = createPaymentPort();
    } catch {
      return UNAVAILABLE;
    }
    const checked = await refreshInvoicePaymentAttempts(db, port, {
      actorAccountId: accountId,
      organizationId: found.organizationId,
      invoiceId: found.invoiceId,
      minAgeMs: 0,
    });
    if (!checked.ok) return { ok: false, message: 'We could not find this invoice.' };
    const summary = checked.value;
    if (!summary.configured || !summary.available) return UNAVAILABLE;
    if (summary.recorded > 0) return { ok: true, message: 'Your payment was received. Thank you.' };
    if (summary.held > 0) {
      return {
        ok: true,
        message: 'Your payment needs a check. VisaStack will contact you.',
      };
    }
    if (summary.unavailable > 0 || summary.stillPending > 0) {
      return {
        ok: true,
        message: 'We are still confirming your payment. Check again in a few minutes.',
      };
    }
    if (summary.closed > 0) {
      return { ok: true, message: 'That payment was not completed. Nothing was charged.' };
    }
    return { ok: true, message: 'There is no open payment to check.' };
  });
  revalidatePath(invoicesPath(found.organizationId));
  return result;
}

function paidOnFrom(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * "I Paid Another Way": reports a payment made outside VisaStack, with an optional proof file.
 * Records nothing: the invoice shows Payment Reported until VisaStack confirms it.
 */
export async function submitClaimAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const found = ids(formData);
  if (!found) return NOT_FOUND;
  const currency = text(formData, 'currency');
  const amountText = text(formData, 'amount');
  const amountMinorUnits = parseAmountForCurrency(amountText, currency);
  if (amountMinorUnits === null || amountMinorUnits <= 0) {
    return {
      ok: false,
      message: 'Enter the amount you paid as a plain number, for example 1250.50.',
      field: 'amount',
    };
  }
  const paidOn = paidOnFrom(text(formData, 'paidOn'));
  if (!paidOn) return { ok: false, message: 'Enter the date you paid.', field: 'paidOn' };

  const proof = formData.get('proof');
  const hasFile = proof instanceof File && proof.size > 0;
  if (hasFile && proof.size > PROOF_FILE_MAX_BYTES) {
    return { ok: false, message: 'Attach a file smaller than 5 MB.', field: 'proof' };
  }

  const note = text(formData, 'note');
  const result = await withSession(async ({ db, accountId }): Promise<InvoiceActionState> => {
    const storage = createStorage(db);
    const submitted = await submitManualPaymentClaim(
      db,
      { storage, scanner: createMalwareScanner(storage) },
      {
        actorAccountId: accountId,
        invoiceId: found.invoiceId,
        method: text(formData, 'method'),
        reference: text(formData, 'reference'),
        amountMinorUnits,
        currency,
        paidOn,
        ...(note.length > 0 ? { note } : {}),
        ...(hasFile
          ? {
              proofFile: {
                contentType: proof.type,
                bytes: new Uint8Array(await proof.arrayBuffer()),
              },
            }
          : {}),
      },
    );
    if (!submitted.ok) return { ok: false, message: submitted.error.message };
    return {
      ok: true,
      message: `Thank you. We have your report of ${formatAmountForCurrency(submitted.value.amountMinorUnits, submitted.value.currency)}. It is waiting for confirmation, and nothing is counted until VisaStack confirms it.`,
    };
  });
  if (result.ok) revalidatePath(invoicesPath(found.organizationId));
  return result;
}
