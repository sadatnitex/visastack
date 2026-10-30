'use server';

import { looksLikeMoney } from '@visastack/core';
import {
  CLAIM_AMOUNT_PROBLEM,
  type Db,
  PROOF_FILE_MAX_BYTES,
  type ProofFilePorts,
  formatAmountForCurrency,
  refreshInvoicePaymentAttempts,
  startOnlinePayment,
  submitManualPaymentClaim,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { bootstrapAdminEmails } from '../../../../../../lib/admin-emails';
import { resolveBaseUrl } from '../../../../../../lib/base-url';
import { moneyFieldOf } from '../../../../../../lib/money-fields';
import { paymentUrlFor } from '../../../../../../lib/payment-urls';
import {
  createImageSanitizer,
  createMalwareScanner,
  paymentPorts,
} from '../../../../../../lib/providers';
import { reportServerError } from '../../../../../../lib/server-error';
import { withSession } from '../../../../../../lib/session';
import { createStorage } from '../../../../../../lib/storage';

/** What an Invoices form gets back. `field` names the input a problem is about. */
/** What was typed into the report form, kept across a refusal. */
export interface ClaimValues {
  readonly method: string;
  readonly reference: string;
  readonly amount: string;
  readonly paidOn: string;
  readonly note: string;
}

export interface InvoiceActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly field?: string;
  /** What was typed into a refused report (never the file), so the form can keep it. */
  readonly values?: ClaimValues;
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
    async ({
      db,
      accountId,
      email,
    }): Promise<InvoiceActionState | { readonly redirectUrl: string }> => {
      // S19 step 0: the service starts the payment on the provider that takes this invoice's
      // currency, so nothing here names a provider or a currency.
      let payments: ReturnType<typeof paymentPorts>;
      try {
        payments = paymentPorts();
      } catch {
        return UNAVAILABLE;
      }
      const started = await startOnlinePayment(db, payments, {
        actorAccountId: accountId,
        // S29: in the gateway's test mode only the platform owner may start a payment.
        actorEmail: email,
        bootstrapEmails: bootstrapAdminEmails(),
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
    let payments: ReturnType<typeof paymentPorts>;
    try {
      payments = paymentPorts();
    } catch {
      return UNAVAILABLE;
    }
    const checked = await refreshInvoicePaymentAttempts(db, payments, {
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

/** Storage, the safety scanner and the image re-encoder, only built when a file is attached. Null when they are not set up here. */
function proofPorts(db: Db): ProofFilePorts | null {
  try {
    const storage = createStorage(db);
    return { storage, scanner: createMalwareScanner(storage), images: createImageSanitizer() };
  } catch (error) {
    reportServerError('agencyInvoices', error, { step: 'setting up proof file storage' });
    return null;
  }
}

/**
 * "I Paid Another Way": reports a payment made outside VisaStack, with an optional proof file.
 * Records nothing: the invoice shows Payment Reported until VisaStack confirms it. A refusal gives
 * back what was typed (not the file) so the person does not retype it.
 */
export async function submitClaimAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const found = ids(formData);
  if (!found) return NOT_FOUND;
  const values: ClaimValues = {
    method: text(formData, 'method'),
    reference: text(formData, 'reference'),
    amount: text(formData, 'amount'),
    paidOn: text(formData, 'paidOn'),
    note: text(formData, 'note'),
  };
  const refuse = (message: string, field?: string): InvoiceActionState => ({
    ok: false,
    message,
    ...(field ? { field } : {}),
    values,
  });

  // A cheap shape check before any work; the service reads the amount in the invoice's own
  // stored currency (S30), never in one a form names.
  if (!looksLikeMoney(values.amount)) return refuse(CLAIM_AMOUNT_PROBLEM, 'amount');
  const paidOn = paidOnFrom(values.paidOn);
  if (!paidOn) return refuse('Enter the date you paid.', 'paidOn');

  const proof = formData.get('proof');
  const hasFile = proof instanceof File && proof.size > 0;
  if (hasFile && proof.size > PROOF_FILE_MAX_BYTES) {
    return refuse('Attach a file smaller than 4 MB.', 'proof');
  }

  const result = await withSession(async ({ db, accountId }): Promise<InvoiceActionState> => {
    const submitted = await submitManualPaymentClaim(db, hasFile ? proofPorts(db) : null, {
      actorAccountId: accountId,
      invoiceId: found.invoiceId,
      method: values.method,
      reference: values.reference,
      amountText: values.amount,
      paidOn,
      ...(values.note.length > 0 ? { note: values.note } : {}),
      ...(hasFile
        ? {
            proofFile: {
              contentType: proof.type,
              bytes: new Uint8Array(await proof.arrayBuffer()),
            },
          }
        : {}),
    });
    if (!submitted.ok) {
      return refuse(submitted.error.message, moneyFieldOf(submitted.error.reason));
    }
    return {
      ok: true,
      message: `Thank you. We have your report of ${formatAmountForCurrency(submitted.value.amountMinorUnits, submitted.value.currency)}. It is waiting for confirmation, and nothing is counted until VisaStack confirms it.`,
    };
  });
  if (result.ok) revalidatePath(invoicesPath(found.organizationId));
  return result;
}
