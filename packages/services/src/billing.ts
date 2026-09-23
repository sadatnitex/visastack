import { type Result, err, ok } from '@visastack/core';
import { eq } from 'drizzle-orm';
import { isActiveMember } from './agency';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { type PlatformAuthInput, isPlatformOwner } from './platform-roles';

/**
 * Manual billing (Commercial V1 COM-03, PRD §12 / master directive Part 5
 * §8): "This is subscription administration, not a full agency CRM." No
 * payment gateway, card handling, tax engine, or automated accounting
 * exists here, or is simulated to look like it does -- every amount below
 * was typed in by a platform owner after receiving it some other way (bank
 * transfer, cheque, whatever), well after the fact.
 *
 * "Never equate proposal/commitment/invoice with collected cash" is kept
 * structurally, not just by convention: `invoicedAmountMinorUnits` and
 * `collectedAmountMinorUnits` are two separate, independently-tracked
 * columns on `invoices`, and no function in this file ever infers one from
 * the other. Creating an invoice never touches `billingAccounts.status`;
 * recording a payment never touches it either -- a salesperson's
 * "committed" status, an issued invoice, and actual money received are
 * three genuinely different events, and this file keeps them that way.
 *
 * `billingAccounts` (one row per organization, for its entire lifetime) is
 * deliberately decoupled from `subscriptions` (COM-01, which plan is
 * assigned): an org's billing standing changes independently of its plan,
 * and a plan change must never itself be a billing-status transition. Every
 * transition `billingAccounts.status` ever went through is preserved in
 * `billingStatusHistory`, append-only, the same pattern this codebase
 * already uses for `auditEvents`/`missionDecisions`/`factVersions`.
 *
 * Legal transitions (`BILLING_TRANSITIONS` below) intentionally allow
 * CLOSED -> TRIAL/ACTIVE (a churned organization can restart) but never
 * allow re-entering TRIAL from anywhere except CLOSED -- you don't "un-pay"
 * back into a trial.
 *
 * Every write here is platform-owner-only and step-up gated, the same
 * sensitivity class as `grantPlatformRole`/COM-01's plan management. Reads
 * (`getBillingAccountForOrganization`, `listBillingStatusHistory`,
 * `listInvoicesForOrganization`) are active-member-readable, matching
 * `getUsageForOrganization`'s own gate -- an org's own staff can see their
 * real billing standing and invoice history (PRD UX-01's agency
 * "Usage/Billing" nav item), even though only a platform owner can change
 * any of it.
 *
 * Deliberately NOT hardened the same way COM-02's consumer-facing paths
 * are: no advisory lock, no `FOR UPDATE`, no concurrency test on
 * `recordInvoicePayment`/`transitionBillingStatus`. This is a reasoned,
 * documented choice, not an oversight -- these are low-frequency,
 * platform-owner-only manual actions (typing in that a payment arrived),
 * not a high-concurrency customer-facing race like a seat or upload
 * reservation; the worst case of two admins racing to record the same
 * payment is a visually obvious, easily-corrected lost update, not a
 * silent overselling of real capacity.
 *
 * Deliberately NOT in this chunk: wiring `isBillingSuspended` into COM-02's
 * `entitlement-enforcement.ts` ("Suspended billing blocks new paid work" --
 * PRD COM-02's own line) is a separate, immediately-following change, kept
 * out of this one so each stays independently reviewable; `isBillingSuspended`
 * is exported here specifically for that follow-up to consume.
 */

export type BillingStatus = (typeof schema.billingStatus.enumValues)[number];
export type BillingAccount = typeof schema.billingAccounts.$inferSelect;
export type BillingStatusHistoryEntry = typeof schema.billingStatusHistory.$inferSelect;
export type InvoiceStatus = (typeof schema.invoiceStatus.enumValues)[number];
export type Invoice = typeof schema.invoices.$inferSelect;

const BILLING_TRANSITIONS: Readonly<Record<BillingStatus, readonly BillingStatus[]>> = {
  TRIAL: ['ACTIVE', 'CLOSED'],
  ACTIVE: ['GRACE', 'SUSPENDED', 'CLOSED'],
  GRACE: ['ACTIVE', 'SUSPENDED', 'CLOSED'],
  SUSPENDED: ['ACTIVE', 'CLOSED'],
  CLOSED: ['TRIAL', 'ACTIVE'],
};

/** The legal next statuses from a given billing status (for UI affordances). */
export function legalBillingTransitions(from: BillingStatus): readonly BillingStatus[] {
  return BILLING_TRANSITIONS[from] ?? [];
}

export interface OpenBillingAccountInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly organizationId: string;
  /** Defaults to TRIAL. ACTIVE is also a legal starting status, for an org whose payment terms were already agreed before this system tracked them. */
  readonly initialStatus?: 'TRIAL' | 'ACTIVE';
  readonly reason: string;
}

/** Opens the one-and-only billing account an organization will ever have. Refuses if one already exists (use `transitionBillingStatus` to change its status). */
export async function openBillingAccount(
  db: Db,
  input: OpenBillingAccountInput,
): Promise<Result<BillingAccount, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can open a billing account'));
  }
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'opening a billing account requires reauthentication'),
    );
  }
  const reason = input.reason.trim();
  if (reason.length === 0) return err(serviceError('invalid', 'a reason is required'));

  const org = first(
    await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, input.organizationId))
      .limit(1),
  );
  if (!org) return err(serviceError('not_found', 'organization not found'));

  const existing = first(
    await db
      .select({ id: schema.billingAccounts.id })
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, input.organizationId))
      .limit(1),
  );
  if (existing) {
    return err(serviceError('invalid', 'this organization already has a billing account'));
  }

  const initialStatus = input.initialStatus ?? 'TRIAL';

  return db.transaction(async (tx) => {
    const account = required(
      first(
        await tx
          .insert(schema.billingAccounts)
          .values({ organizationId: input.organizationId, status: initialStatus })
          .returning(),
      ),
      'billing account',
    );
    await tx.insert(schema.billingStatusHistory).values({
      billingAccountId: account.id,
      fromStatus: null,
      toStatus: initialStatus,
      actorAccountId: input.actor.accountId,
      reason,
    });
    await appendAuditEvent(tx, {
      eventType: 'BILLING_ACCOUNT_OPENED',
      actorAccountId: input.actor.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'billing_account',
      resourceId: account.id,
      reason,
      metadata: { organizationId: input.organizationId, initialStatus },
    });
    return ok(account);
  });
}

export interface TransitionBillingStatusInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly organizationId: string;
  readonly toStatus: BillingStatus;
  readonly reason: string;
}

/** Moves an organization's billing account to a new status, refusing an illegal transition. Every change is recorded in `billingStatusHistory`, in addition to the general audit log. */
export async function transitionBillingStatus(
  db: Db,
  input: TransitionBillingStatusInput,
): Promise<Result<BillingAccount, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can change billing status'));
  }
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'changing billing status requires reauthentication'),
    );
  }
  const reason = input.reason.trim();
  if (reason.length === 0) return err(serviceError('invalid', 'a reason is required'));

  const account = first(
    await db
      .select()
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, input.organizationId))
      .limit(1),
  );
  if (!account) {
    return err(serviceError('not_found', 'this organization has no billing account yet'));
  }
  if (account.status === input.toStatus) {
    return err(serviceError('invalid', `this billing account is already ${input.toStatus}`));
  }
  const legal = BILLING_TRANSITIONS[account.status];
  if (!legal.includes(input.toStatus)) {
    return err(
      serviceError(
        'invalid',
        `cannot transition billing status from ${account.status} to ${input.toStatus}`,
      ),
    );
  }

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.billingAccounts)
          .set({ status: input.toStatus, updatedAt: new Date() })
          .where(eq(schema.billingAccounts.id, account.id))
          .returning(),
      ),
      'billing account',
    );
    await tx.insert(schema.billingStatusHistory).values({
      billingAccountId: account.id,
      fromStatus: account.status,
      toStatus: input.toStatus,
      actorAccountId: input.actor.accountId,
      reason,
    });
    await appendAuditEvent(tx, {
      eventType: 'BILLING_STATUS_CHANGED',
      actorAccountId: input.actor.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'billing_account',
      resourceId: account.id,
      reason,
      metadata: {
        organizationId: input.organizationId,
        fromStatus: account.status,
        toStatus: input.toStatus,
      },
    });
    return ok(updated);
  });
}

/** An organization's billing account, or `undefined` if none has been opened yet. Active-member-readable. */
export async function getBillingAccountForOrganization(
  db: Db,
  input: { readonly actorAccountId: string; readonly organizationId: string },
): Promise<Result<BillingAccount | undefined, ServiceError>> {
  if (!(await isActiveMember(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'not an active member of this organization'));
  }
  const account = first(
    await db
      .select()
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, input.organizationId))
      .limit(1),
  );
  return ok(account);
}

/** Full billing-status transition history for an organization, newest first. Empty (not an error) if no billing account has been opened yet. */
export async function listBillingStatusHistory(
  db: Db,
  input: { readonly actorAccountId: string; readonly organizationId: string },
): Promise<Result<BillingStatusHistoryEntry[], ServiceError>> {
  if (!(await isActiveMember(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'not an active member of this organization'));
  }
  const account = first(
    await db
      .select({ id: schema.billingAccounts.id })
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, input.organizationId))
      .limit(1),
  );
  if (!account) return ok([]);
  const rows = await db
    .select()
    .from(schema.billingStatusHistory)
    .where(eq(schema.billingStatusHistory.billingAccountId, account.id));
  return ok([...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
}

/** True if this organization's billing account currently reads SUSPENDED. An organization with no billing account at all is never suspended -- absence of billing tracking is not itself a billing problem. */
export async function isBillingSuspended(db: Db, organizationId: string): Promise<boolean> {
  const account = first(
    await db
      .select({ status: schema.billingAccounts.status })
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, organizationId))
      .limit(1),
  );
  return account?.status === 'SUSPENDED';
}

export interface CreateInvoiceInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly organizationId: string;
  readonly planId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly invoiceRef: string;
  readonly invoicedAmountMinorUnits: number;
  readonly currency: string;
  readonly dueDate: Date;
}

/** Issues a new invoice. `invoicedAmountMinorUnits`/`currency` are this invoice's own immutable record -- never a live read of `plans.priceMinorUnits`, which can change later via `updatePlan` without retroactively altering a historical invoice. */
export async function createInvoice(
  db: Db,
  input: CreateInvoiceInput,
): Promise<Result<Invoice, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can create an invoice'));
  }
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'creating an invoice requires reauthentication'));
  }
  const invoiceRef = input.invoiceRef.trim();
  if (invoiceRef.length === 0)
    return err(serviceError('invalid', 'an invoice reference is required'));
  const currency = input.currency.trim();
  if (currency.length === 0) return err(serviceError('invalid', 'a currency is required'));
  if (!Number.isFinite(input.invoicedAmountMinorUnits) || input.invoicedAmountMinorUnits < 0) {
    return err(serviceError('invalid', 'invoiced amount must be a non-negative number'));
  }
  if (input.periodEnd.getTime() <= input.periodStart.getTime()) {
    return err(serviceError('invalid', 'periodEnd must be after periodStart'));
  }

  const org = first(
    await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, input.organizationId))
      .limit(1),
  );
  if (!org) return err(serviceError('not_found', 'organization not found'));
  const plan = first(
    await db
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(eq(schema.plans.id, input.planId))
      .limit(1),
  );
  if (!plan) return err(serviceError('not_found', 'plan not found'));

  const existingRef = first(
    await db
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(eq(schema.invoices.invoiceRef, invoiceRef))
      .limit(1),
  );
  if (existingRef) {
    return err(serviceError('invalid', 'an invoice with this reference already exists'));
  }

  return db.transaction(async (tx) => {
    const invoice = required(
      first(
        await tx
          .insert(schema.invoices)
          .values({
            organizationId: input.organizationId,
            planId: input.planId,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            invoiceRef,
            invoicedAmountMinorUnits: input.invoicedAmountMinorUnits,
            currency,
            dueDate: input.dueDate,
          })
          .returning(),
      ),
      'invoice',
    );
    await appendAuditEvent(tx, {
      eventType: 'INVOICE_CREATED',
      actorAccountId: input.actor.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'invoice',
      resourceId: invoice.id,
      metadata: {
        organizationId: input.organizationId,
        invoiceRef,
        invoicedAmountMinorUnits: input.invoicedAmountMinorUnits,
        currency,
      },
    });
    return ok(invoice);
  });
}

export interface RecordInvoicePaymentInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly invoiceId: string;
  /** Added to whatever has already been collected on this invoice -- a running total, not a replacement, so multiple partial payments over time accumulate correctly. */
  readonly amountMinorUnits: number;
  readonly collectedDate: Date;
  readonly paymentReference: string;
  readonly reason: string;
}

/** Records a real payment received against an invoice, refusing to let the running collected total exceed the invoiced amount. Sets status to PARTIALLY_PAID or PAID accordingly. */
export async function recordInvoicePayment(
  db: Db,
  input: RecordInvoicePaymentInput,
): Promise<Result<Invoice, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can record a payment'));
  }
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'recording a payment requires reauthentication'));
  }
  if (!Number.isFinite(input.amountMinorUnits) || input.amountMinorUnits <= 0) {
    return err(serviceError('invalid', 'payment amount must be a positive number'));
  }
  const paymentReference = input.paymentReference.trim();
  if (paymentReference.length === 0) {
    return err(serviceError('invalid', 'a payment reference is required'));
  }
  const reason = input.reason.trim();
  if (reason.length === 0) return err(serviceError('invalid', 'a reason is required'));

  const invoice = first(
    await db.select().from(schema.invoices).where(eq(schema.invoices.id, input.invoiceId)).limit(1),
  );
  if (!invoice) return err(serviceError('not_found', 'invoice not found'));
  if (invoice.status === 'VOID') {
    return err(serviceError('invalid', 'cannot record a payment against a void invoice'));
  }
  const newCollected = invoice.collectedAmountMinorUnits + input.amountMinorUnits;
  if (newCollected > invoice.invoicedAmountMinorUnits) {
    return err(serviceError('invalid', 'this payment would exceed the invoiced amount'));
  }
  const newStatus: InvoiceStatus =
    newCollected >= invoice.invoicedAmountMinorUnits ? 'PAID' : 'PARTIALLY_PAID';

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.invoices)
          .set({
            collectedAmountMinorUnits: newCollected,
            collectedDate: input.collectedDate,
            paymentReference,
            status: newStatus,
            updatedAt: new Date(),
          })
          .where(eq(schema.invoices.id, invoice.id))
          .returning(),
      ),
      'invoice',
    );
    await appendAuditEvent(tx, {
      eventType: 'INVOICE_PAYMENT_RECORDED',
      actorAccountId: input.actor.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'invoice',
      resourceId: invoice.id,
      reason,
      metadata: {
        organizationId: invoice.organizationId,
        amountMinorUnits: input.amountMinorUnits,
        newCollectedAmountMinorUnits: newCollected,
        newStatus,
      },
    });
    return ok(updated);
  });
}

export interface VoidInvoiceInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly invoiceId: string;
  readonly reason: string;
}

/** Voids an invoice that was issued in error. Idempotent (voiding an already-void invoice is a no-op success). Refuses if any amount has already been collected against it -- voiding must never make real, received cash disappear from the record; that needs a correction, not a void. */
export async function voidInvoice(
  db: Db,
  input: VoidInvoiceInput,
): Promise<Result<Invoice, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can void an invoice'));
  }
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'voiding an invoice requires reauthentication'));
  }
  const reason = input.reason.trim();
  if (reason.length === 0) return err(serviceError('invalid', 'a reason is required'));

  const invoice = first(
    await db.select().from(schema.invoices).where(eq(schema.invoices.id, input.invoiceId)).limit(1),
  );
  if (!invoice) return err(serviceError('not_found', 'invoice not found'));
  if (invoice.status === 'VOID') return ok(invoice);
  if (invoice.collectedAmountMinorUnits > 0) {
    return err(serviceError('invalid', 'cannot void an invoice with any amount already collected'));
  }

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.invoices)
          .set({ status: 'VOID', updatedAt: new Date() })
          .where(eq(schema.invoices.id, invoice.id))
          .returning(),
      ),
      'invoice',
    );
    await appendAuditEvent(tx, {
      eventType: 'INVOICE_VOIDED',
      actorAccountId: input.actor.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'invoice',
      resourceId: invoice.id,
      reason,
      metadata: { organizationId: invoice.organizationId },
    });
    return ok(updated);
  });
}

/** Every invoice for an organization, newest first. Active-member-readable. */
export async function listInvoicesForOrganization(
  db: Db,
  input: { readonly actorAccountId: string; readonly organizationId: string },
): Promise<Result<Invoice[], ServiceError>> {
  if (!(await isActiveMember(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'not an active member of this organization'));
  }
  const rows = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.organizationId, input.organizationId));
  return ok([...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
}
