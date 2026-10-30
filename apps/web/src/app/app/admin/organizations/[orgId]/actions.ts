'use server';

import { isIsoCurrencyCode, normalizeCurrencyCode, parseMoney } from '@visastack/core';
import {
  type BillingStatus,
  MAX_MINOR_UNITS,
  activateSubscription,
  approveManualPaymentClaim,
  cancelScheduledDowngrade,
  createInvoice,
  endSubscription,
  formatReceiptNumber,
  grantCommercialOverride,
  openBillingAccount,
  recordInvoicePayment,
  rejectManualPaymentClaim,
  revokeCommercialOverride,
  scheduleDowngrade,
  transitionBillingStatus,
  voidInvoice,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { bootstrapAdminEmails, isPlatformOwnerAccount } from '../../../../../lib/admin';
import { triggerNotificationWorker } from '../../../../../lib/jobs';
import { invoiceStatusLabel } from '../../../../../lib/labels';
import { withSession } from '../../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../../lib/step-up';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

const DENIED: ActionState = { ok: false, message: 'Not authorized.' };

function returnPath(organizationId: string): string {
  return `/app/admin/organizations/${organizationId}`;
}

function parseDate(formData: FormData, field: string): Date | undefined {
  const raw = String(formData.get(field) ?? '').trim();
  if (raw.length === 0) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Manually assign an organization to a plan, immediately ending whatever is currently active. Platform-owner only, step-up gated. */
export async function activatePlanAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const planId = String(formData.get('planId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (organizationId.length === 0) return { ok: false, message: 'Missing organization id.' };
  if (planId.length === 0) return { ok: false, message: 'Choose a plan.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'SUBSCRIPTION_ACTIVATE', resourceId: organizationId },
      returnPath(organizationId),
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const activated = await activateSubscription(db, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      stepUpSatisfied: true,
      organizationId,
      planId,
      reason,
    });
    if (!activated.ok) return { ok: false, message: activated.error.message } satisfies ActionState;
    return { ok: true, message: 'Plan activated.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(returnPath(organizationId));
  return result;
}

/** Drops an organization back to "no plan assigned." Platform-owner only, step-up gated. */
export async function endSubscriptionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (organizationId.length === 0) return { ok: false, message: 'Missing organization id.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'SUBSCRIPTION_END', resourceId: organizationId },
      returnPath(organizationId),
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const ended = await endSubscription(db, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      stepUpSatisfied: true,
      organizationId,
      reason,
    });
    if (!ended.ok) return { ok: false, message: ended.error.message } satisfies ActionState;
    return {
      ok: true,
      message: ended.value.ended ? 'Subscription ended.' : 'No active subscription to end.',
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(returnPath(organizationId));
  return result;
}

/** Schedule a future, warned downgrade. Platform-owner only, step-up gated. */
export async function scheduleDowngradeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const toPlanId = String(formData.get('toPlanId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const effectiveAt = parseDate(formData, 'effectiveAt');
  if (organizationId.length === 0) return { ok: false, message: 'Missing organization id.' };
  if (toPlanId.length === 0) return { ok: false, message: 'Choose a target plan.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'DOWNGRADE_SCHEDULE', resourceId: organizationId },
      returnPath(organizationId),
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const scheduled = await scheduleDowngrade(db, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      stepUpSatisfied: true,
      organizationId,
      toPlanId,
      reason,
      ...(effectiveAt ? { effectiveAt } : {}),
    });
    if (!scheduled.ok) return { ok: false, message: scheduled.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `Downgrade scheduled for ${scheduled.value.effectiveAt.toDateString()}.`,
    } satisfies ActionState;
  });
  if (result.ok) {
    revalidatePath(returnPath(organizationId));
    // The agency's email about the plan change goes now, not at the next daily run.
    after(() => triggerNotificationWorker().then(() => undefined));
  }
  return result;
}

/** Cancel a still-pending scheduled downgrade. Platform-owner only, step-up gated. */
export async function cancelScheduledDowngradeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const downgradeId = String(formData.get('downgradeId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (downgradeId.length === 0) return { ok: false, message: 'Missing downgrade id.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'DOWNGRADE_CANCEL', resourceId: downgradeId },
      returnPath(organizationId),
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const cancelled = await cancelScheduledDowngrade(db, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      stepUpSatisfied: true,
      downgradeId,
      reason,
    });
    if (!cancelled.ok) return { ok: false, message: cancelled.error.message } satisfies ActionState;
    return { ok: true, message: 'Scheduled downgrade cancelled.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(returnPath(organizationId));
  return result;
}

/** Opens the one-and-only billing account for an organization. Platform-owner only, step-up gated. */
export async function openBillingAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const initialStatusRaw = String(formData.get('initialStatus') ?? '');
  const initialStatus = initialStatusRaw === 'ACTIVE' ? 'ACTIVE' : undefined;
  if (organizationId.length === 0) return { ok: false, message: 'Missing organization id.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'BILLING_ACCOUNT_OPEN', resourceId: organizationId },
      returnPath(organizationId),
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const opened = await openBillingAccount(db, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      stepUpSatisfied: true,
      organizationId,
      reason,
      ...(initialStatus ? { initialStatus } : {}),
    });
    if (!opened.ok) return { ok: false, message: opened.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `Billing account opened (${opened.value.status}).`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(returnPath(organizationId));
  return result;
}

const VALID_BILLING_STATUSES: readonly BillingStatus[] = [
  'TRIAL',
  'ACTIVE',
  'GRACE',
  'SUSPENDED',
  'CLOSED',
];

/** Moves an organization's billing account to a new (legal) status. Platform-owner only, step-up gated. */
export async function transitionBillingStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const toStatus = String(formData.get('toStatus') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (organizationId.length === 0) return { ok: false, message: 'Missing organization id.' };
  if (!VALID_BILLING_STATUSES.includes(toStatus as BillingStatus)) {
    return { ok: false, message: 'Choose a target status.' };
  }
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'BILLING_STATUS_TRANSITION', resourceId: organizationId },
      returnPath(organizationId),
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const transitioned = await transitionBillingStatus(db, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      stepUpSatisfied: true,
      organizationId,
      toStatus: toStatus as BillingStatus,
      reason,
    });
    if (!transitioned.ok) {
      return { ok: false, message: transitioned.error.message } satisfies ActionState;
    }
    return {
      ok: true,
      message: `Billing status is now ${transitioned.value.status}.`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(returnPath(organizationId));
  return result;
}

/** Issues a new invoice. Platform-owner only, step-up gated. */
export async function createInvoiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const planId = String(formData.get('planId') ?? '').trim();
  const invoiceRef = String(formData.get('invoiceRef') ?? '').trim();
  const currency = normalizeCurrencyCode(String(formData.get('currency') ?? ''));
  const invoicedAmountMinorUnits = parseMoney(
    String(formData.get('invoicedAmount') ?? ''),
    currency,
    MAX_MINOR_UNITS,
  );
  const periodStart = parseDate(formData, 'periodStart');
  const periodEnd = parseDate(formData, 'periodEnd');
  const dueDate = parseDate(formData, 'dueDate');
  if (organizationId.length === 0) return { ok: false, message: 'Missing organization id.' };
  if (planId.length === 0) return { ok: false, message: 'Choose a plan.' };
  if (invoiceRef.length === 0) return { ok: false, message: 'An invoice reference is required.' };
  if (!isIsoCurrencyCode(currency)) {
    return { ok: false, message: 'Enter a three-letter currency code, for example BDT.' };
  }
  if (invoicedAmountMinorUnits === null || invoicedAmountMinorUnits <= 0) {
    return { ok: false, message: 'Enter the invoiced amount above zero, for example 2,500.00.' };
  }
  if (!periodStart || !periodEnd || !dueDate) {
    return { ok: false, message: 'Period start, period end, and due date are all required.' };
  }

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'INVOICE_CREATE', resourceId: organizationId },
      returnPath(organizationId),
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const invoice = await createInvoice(db, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef,
      invoicedAmountMinorUnits,
      currency,
      dueDate,
    });
    if (!invoice.ok) return { ok: false, message: invoice.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `Invoice ${invoice.value.invoiceRef} created.`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(returnPath(organizationId));
  return result;
}

/** Records a real payment received against an invoice. Platform-owner only, step-up gated. */
export async function recordInvoicePaymentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const invoiceId = String(formData.get('invoiceId') ?? '').trim();
  const amountMinorUnits = parseMoney(
    String(formData.get('amount') ?? ''),
    String(formData.get('invoiceCurrency') ?? ''),
    MAX_MINOR_UNITS,
  );
  const paymentReference = String(formData.get('paymentReference') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const currency = String(formData.get('currency') ?? '').trim();
  const idempotencyKey = String(formData.get('idempotencyKey') ?? '').trim();
  const collectedDate = parseDate(formData, 'collectedDate') ?? new Date();
  if (invoiceId.length === 0) return { ok: false, message: 'Missing invoice id.' };
  if (idempotencyKey.length === 0) {
    return { ok: false, message: 'This page is out of date. Reload it and try again.' };
  }
  if (amountMinorUnits === null || amountMinorUnits <= 0) {
    return { ok: false, message: 'Enter the amount received above zero, for example 2,500.00.' };
  }
  if (paymentReference.length === 0)
    return { ok: false, message: 'A payment reference is required.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'INVOICE_PAYMENT_RECORD', resourceId: invoiceId },
      returnPath(organizationId),
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const recorded = await recordInvoicePayment(db, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      stepUpSatisfied: true,
      invoiceId,
      amountMinorUnits,
      collectedDate,
      paymentReference,
      reason,
      ...(currency.length > 0 ? { currency } : {}),
      idempotencyKey,
    });
    if (!recorded.ok) return { ok: false, message: recorded.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `Payment recorded. The invoice is now ${invoiceStatusLabel(recorded.value.status)}.`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(returnPath(organizationId));
  return result;
}

/** Voids an invoice issued in error. Platform-owner only, step-up gated. */
export async function voidInvoiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const invoiceId = String(formData.get('invoiceId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (invoiceId.length === 0) return { ok: false, message: 'Missing invoice id.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'INVOICE_VOID', resourceId: invoiceId },
      returnPath(organizationId),
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const voided = await voidInvoice(db, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      stepUpSatisfied: true,
      invoiceId,
      reason,
    });
    if (!voided.ok) return { ok: false, message: voided.error.message } satisfies ActionState;
    return { ok: true, message: 'Invoice voided.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(returnPath(organizationId));
  return result;
}

/** Grant a time-limited commercial override. Platform-owner only, step-up gated. */
export async function grantOverrideAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const durationDays = Number(String(formData.get('durationDays') ?? ''));
  if (organizationId.length === 0) return { ok: false, message: 'Missing organization id.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };
  if (!Number.isFinite(durationDays) || durationDays <= 0) {
    return { ok: false, message: 'Duration must be a positive number of days.' };
  }

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'COMMERCIAL_OVERRIDE_GRANT', resourceId: organizationId },
      returnPath(organizationId),
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const granted = await grantCommercialOverride(db, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      stepUpSatisfied: true,
      organizationId,
      reason,
      durationDays,
    });
    if (!granted.ok) return { ok: false, message: granted.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `Override granted until ${granted.value.expiryAt.toDateString()}.`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(returnPath(organizationId));
  return result;
}

/** Revoke a commercial override before its natural expiry. Platform-owner only, step-up gated. */
export async function revokeOverrideAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const overrideId = String(formData.get('overrideId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (overrideId.length === 0) return { ok: false, message: 'Missing override id.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'COMMERCIAL_OVERRIDE_REVOKE', resourceId: overrideId },
      returnPath(organizationId),
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const revoked = await revokeCommercialOverride(db, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      stepUpSatisfied: true,
      overrideId,
      reason,
    });
    if (!revoked.ok) return { ok: false, message: revoked.error.message } satisfies ActionState;
    return { ok: true, message: 'Override revoked.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(returnPath(organizationId));
  return result;
}

/** Confirms a payment an agency reported (S12). Platform-owner only, step-up gated; records the money once and issues the receipt. */
export async function approveClaimAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const claimId = String(formData.get('claimId') ?? '').trim();
  if (claimId.length === 0) return { ok: false, message: 'Missing payment report.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'MANUAL_CLAIM_APPROVE', resourceId: claimId },
      returnPath(organizationId),
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const approved = await approveManualPaymentClaim(db, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      stepUpSatisfied: true,
      claimId,
    });
    if (!approved.ok) return { ok: false, message: approved.error.message } satisfies ActionState;
    const receipt = approved.value.receipt
      ? ` Receipt ${formatReceiptNumber(approved.value.receipt.receiptNumber)} was issued.`
      : '';
    return {
      ok: true,
      message: approved.value.alreadyApproved
        ? `This report was already confirmed.${receipt}`
        : `Payment confirmed and recorded.${receipt}`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(returnPath(organizationId));
  return result;
}

/** Rejects a payment an agency reported, with a reason the agency can read (S12). Platform-owner only; records no money. */
export async function rejectClaimAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const claimId = String(formData.get('claimId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (claimId.length === 0) return { ok: false, message: 'Missing payment report.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const rejected = await rejectManualPaymentClaim(db, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      claimId,
      reason,
    });
    if (!rejected.ok) return { ok: false, message: rejected.error.message } satisfies ActionState;
    return {
      ok: true,
      message: 'Report rejected. The agency can see your reason.',
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(returnPath(organizationId));
  return result;
}
