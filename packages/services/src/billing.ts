import { type Result, err, ok } from '@visastack/core';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { isActiveMember } from './agency';
import { appendAuditEvent } from './audit';
import {
  type BillingStatusHistoryEntry,
  billingStatusCausePresent,
  insertBillingStatusHistory,
  newestBillingStatusChange,
  readBillingStatusHistory,
} from './billing-history';
import {
  invoiceNotRefundedSql,
  invoicePeriodOverlaps,
  lockBillingAccount,
  timestampSql,
} from './billing-standing';
import { type Db, first, isUniqueViolation, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import {
  type CollectionRefusal,
  type InvoicePayment,
  applyInvoiceCollection,
  invoiceLedgerPresent,
  isCurrencyCode,
  isUuid,
  isValidMinorUnitAmount,
  ledgerTotal,
} from './invoice-ledger';
import { cancelQueuedNotificationsForResource } from './notifications';
import { isOrgAdmin } from './organizations';
import { parseAmountForCurrency } from './payment-amounts';
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
 * `transitionBillingStatus` is deliberately NOT hardened the same way
 * COM-02's consumer-facing paths are: no advisory lock, no `FOR UPDATE`. This
 * is a reasoned, documented choice, not an oversight -- it is a
 * low-frequency, platform-owner-only manual action, not a high-concurrency
 * customer-facing race. Recording a payment is different (S10, ADR 0020):
 * money must never be counted twice, so `recordInvoicePayment` goes through
 * `applyInvoiceCollection` (invoice-ledger.ts), which locks the invoice row,
 * writes an append-only cash ledger row and refuses a replay.
 *
 * Deliberately NOT in this chunk: wiring `isBillingSuspended` into COM-02's
 * `entitlement-enforcement.ts` ("Suspended billing blocks new paid work" --
 * PRD COM-02's own line) is a separate, immediately-following change, kept
 * out of this one so each stays independently reviewable; `isBillingSuspended`
 * is exported here specifically for that follow-up to consume.
 */

export type BillingStatus = (typeof schema.billingStatus.enumValues)[number];
export type BillingAccount = typeof schema.billingAccounts.$inferSelect;
export type { BillingStatusHistoryEntry } from './billing-history';
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
    await insertBillingStatusHistory(tx, {
      billingAccountId: account.id,
      fromStatus: null,
      toStatus: initialStatus,
      actorAccountId: input.actor.accountId,
      reason,
      cause: 'MANUAL',
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

  return db.transaction(async (tx) => {
    // Lock order (billing-standing.ts): the billing account row first, then the audit chain. The
    // move is judged against the locked status, so two changes at once cannot both start from
    // the same old status, and the history row names the status it really left.
    const account = first(
      await tx
        .select()
        .from(schema.billingAccounts)
        .where(eq(schema.billingAccounts.organizationId, input.organizationId))
        .limit(1)
        .for('update'),
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
    await insertBillingStatusHistory(tx, {
      billingAccountId: account.id,
      fromStatus: account.status,
      toStatus: input.toStatus,
      actorAccountId: input.actor.accountId,
      reason,
      cause: 'MANUAL',
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

/**
 * Read access to an organization's billing/invoice data: an active member of
 * the organization, or a platform owner (or bootstrap-eligible) acting
 * without membership. This is the read-side counterpart to this file's
 * platform-owner-only write gates -- a platform owner who can already
 * transition billing status or create an invoice for any organization must
 * also be able to read what they would be changing. `actorEmail`/
 * `bootstrapEmails` are optional so every existing member-facing call site
 * keeps its exact prior behavior (refused unless an active member) when it
 * doesn't pass them.
 */
async function organizationBillingReader(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly actorEmail?: string;
    readonly bootstrapEmails?: readonly string[];
  },
): Promise<'member' | 'platform' | null> {
  if (await isActiveMember(db, input.actorAccountId, input.organizationId)) return 'member';
  if (input.actorEmail === undefined) return null;
  const owner = await isPlatformOwner(db, {
    accountId: input.actorAccountId,
    email: input.actorEmail,
    bootstrapEmails: input.bootstrapEmails ?? [],
  });
  return owner ? 'platform' : null;
}

async function canReadOrganizationBilling(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly actorEmail?: string;
    readonly bootstrapEmails?: readonly string[];
  },
): Promise<boolean> {
  return (await organizationBillingReader(db, input)) !== null;
}

/** What the Grace and Suspended notice needs to know (S30): never an amount. */
export interface AgencyBillingNotice {
  readonly status: 'GRACE' | 'SUSPENDED';
  /** True when a person set the current status (cause MANUAL), not the overdue rules. */
  readonly setByPerson: boolean;
  /** True when an invoice is still owed (open or part paid, not cancelled or refunded). */
  readonly invoiceOwed: boolean;
}

/**
 * The agency's Grace or Suspended standing for its notice, or null for any other status or no
 * billing account. Readable by anyone who belongs to the agency (the same readers as the status
 * itself); the notice decides what each person is told.
 */
export async function getAgencyBillingNotice(
  db: Db,
  input: { readonly actorAccountId: string; readonly organizationId: string },
): Promise<Result<AgencyBillingNotice | null, ServiceError>> {
  if (!(await canReadOrganizationBilling(db, input))) {
    return err(serviceError('forbidden', 'not an active member of this organization'));
  }
  const account = first(
    await db
      .select({ id: schema.billingAccounts.id, status: schema.billingAccounts.status })
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.organizationId, input.organizationId))
      .limit(1),
  );
  if (!account || (account.status !== 'GRACE' && account.status !== 'SUSPENDED')) return ok(null);
  // Before migration 0103 every status change was a person's.
  const newest = (await billingStatusCausePresent(db))
    ? await newestBillingStatusChange(db, account.id)
    : undefined;
  const i = schema.invoices;
  const owed = first(
    await db
      .select({ id: i.id })
      .from(i)
      .where(
        and(
          eq(i.organizationId, input.organizationId),
          inArray(i.status, ['OPEN', 'PARTIALLY_PAID']),
          invoiceNotRefundedSql(sql`${i.id}`),
        ),
      )
      .limit(1),
  );
  return ok({
    status: account.status,
    setByPerson: newest?.cause !== 'NONPAYMENT',
    invoiceOwed: owed !== undefined,
  });
}

/** An organization's billing account, or `undefined` if none has been opened yet. Active-member-readable, or platform-owner-readable for any organization. */
export async function getBillingAccountForOrganization(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly actorEmail?: string;
    readonly bootstrapEmails?: readonly string[];
  },
): Promise<Result<BillingAccount | undefined, ServiceError>> {
  if (!(await canReadOrganizationBilling(db, input))) {
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

/** Full billing-status transition history for an organization, newest first. Empty (not an error) if no billing account has been opened yet. Active-member-readable, or platform-owner-readable for any organization. */
export async function listBillingStatusHistory(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly actorEmail?: string;
    readonly bootstrapEmails?: readonly string[];
  },
): Promise<Result<BillingStatusHistoryEntry[], ServiceError>> {
  if (!(await canReadOrganizationBilling(db, input))) {
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
  return ok(await readBillingStatusHistory(db, account.id));
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
  if (
    input.invoicedAmountMinorUnits !== 0 &&
    !isValidMinorUnitAmount(input.invoicedAmountMinorUnits)
  ) {
    return err(
      serviceError('invalid', 'invoiced amount must be a whole number of minor units in range'),
    );
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
  try {
    return await insertInvoice(db, input, invoiceRef, currency);
  } catch (error) {
    // Another invoice with this reference or for this period was saved an instant ago.
    if (isUniqueViolation(error)) return err(serviceError('invalid', SAME_PERIOD_MESSAGE));
    throw error;
  }
}

const SAME_PERIOD_MESSAGE =
  'an invoice with this reference, or for this plan and an overlapping period, already exists';

async function insertInvoice(
  db: Db,
  input: CreateInvoiceInput,
  invoiceRef: string,
  currency: string,
): Promise<Result<Invoice, ServiceError>> {
  return db.transaction(async (tx) => {
    // One live invoice per organization, plan and period (S17): a hand-made invoice whose period
    // overlaps a live one for the same plan is refused, by the same overlap rule the daily billing
    // run uses (`invoicePeriodOverlaps`), so a date typed as midnight cannot bill again a period
    // the run billed at another time of day. Invoice creation is serialised per agency on its
    // billing account row (the run's invoice step takes the same lock), and the check runs under
    // that lock, so an admin save and the run cannot both pass it. An organization without a
    // billing account is never billed by the run; the database's unique index on the period
    // start is the second layer. Lock order: billing account, then the audit chain.
    await lockBillingAccount(tx, input.organizationId);
    const samePeriod = first(
      await tx
        .select({ id: schema.invoices.id })
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.organizationId, input.organizationId),
            eq(schema.invoices.planId, input.planId),
            ne(schema.invoices.status, 'VOID'),
            invoicePeriodOverlaps(timestampSql(input.periodStart), timestampSql(input.periodEnd)),
          ),
        )
        .limit(1),
    );
    if (samePeriod) return err(serviceError('invalid', SAME_PERIOD_MESSAGE));
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

/** Why a typed payment amount was refused, as one sentence the form can tie to its amount field. */
export const RECORD_AMOUNT_PROBLEM = 'Enter the amount received above zero, for example 2,500.00.';

export interface RecordInvoicePaymentInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly invoiceId: string;
  /** Added to whatever has already been collected on this invoice -- a running total, not a replacement, so multiple partial payments over time accumulate correctly. A whole number of minor units. Give this or `amountText`. */
  readonly amountMinorUnits?: number;
  /**
   * The amount as a person typed it ("2,500.00"), read in the stored invoice's own currency (its
   * decimal places come from the invoice row, never from the form; S30). Give this or
   * `amountMinorUnits`.
   */
  readonly amountText?: string;
  readonly collectedDate: Date;
  readonly paymentReference: string;
  readonly reason: string;
  /** The currency the payment was received in. Optional: when given it must equal the invoice currency, otherwise the recording is refused. Left out, the invoice's own currency is assumed (the behaviour before the ledger existed). */
  readonly currency?: string;
  /** A UUID the caller makes once per intended payment (for example one per open form). Sending the same key again records nothing new and returns the invoice as it is. Left out, every call is a new payment, as before. */
  readonly idempotencyKey?: string;
}

/**
 * Records a real payment received against an invoice by hand, refusing to let
 * the running collected total exceed the invoiced amount. Sets status to
 * PARTIALLY_PAID or PAID accordingly. Platform owner and step-up only; the
 * recording itself is `applyInvoiceCollection` (kind ADMIN_RECORDED), the one
 * function every payment path shares.
 */
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
  if ((input.amountMinorUnits === undefined) === (input.amountText === undefined)) {
    return err(serviceError('invalid', 'give the payment amount once'));
  }
  if (input.amountMinorUnits !== undefined) {
    if (!Number.isFinite(input.amountMinorUnits) || input.amountMinorUnits <= 0) {
      return err(serviceError('invalid', 'payment amount must be a positive number'));
    }
    if (!isValidMinorUnitAmount(input.amountMinorUnits)) {
      return err(
        serviceError('invalid', 'payment amount must be a whole number of minor units in range'),
      );
    }
  }
  const paymentReference = input.paymentReference.trim();
  if (paymentReference.length === 0) {
    return err(serviceError('invalid', 'a payment reference is required'));
  }
  const reason = input.reason.trim();
  if (reason.length === 0) return err(serviceError('invalid', 'a reason is required'));
  if (input.currency !== undefined && !isCurrencyCode(input.currency)) {
    return err(serviceError('invalid', 'the currency must be a three-letter code'));
  }
  if (input.idempotencyKey !== undefined && !isUuid(input.idempotencyKey)) {
    return err(serviceError('invalid', 'the idempotency key must be a UUID'));
  }

  return db.transaction(async (tx) => {
    const invoice = first(
      await tx
        .select({ currency: schema.invoices.currency })
        .from(schema.invoices)
        .where(eq(schema.invoices.id, input.invoiceId))
        .limit(1),
    );
    if (!invoice) return err(serviceError('not_found', 'invoice not found'));
    const amountMinorUnits =
      input.amountText !== undefined
        ? parseAmountForCurrency(input.amountText, invoice.currency)
        : (input.amountMinorUnits ?? null);
    if (amountMinorUnits === null || amountMinorUnits <= 0) {
      return err(serviceError('invalid', RECORD_AMOUNT_PROBLEM));
    }
    const applied = await applyInvoiceCollection(tx, {
      invoiceId: input.invoiceId,
      amountMinorUnits,
      // Left out, the invoice's own currency is assumed (as before the ledger).
      currency: input.currency ?? invoice.currency,
      kind: 'ADMIN_RECORDED',
      sourceId: input.idempotencyKey ?? null,
      reference: paymentReference,
      collectedDate: input.collectedDate,
      recordedByAccountId: input.actor.accountId,
      reason,
    });
    if (!applied.ok) return err(refusalToServiceError(applied.error));
    return ok(applied.value.invoice);
  });
}

/** The recording function's refusals as the service errors callers already handle (not found stays not found; everything else is an `invalid` request with a plain message). */
/** What platform staff are told when they record a payment on a refunded invoice (S18, D2). */
export const REFUNDED_INVOICE_STAFF_MESSAGE =
  'This invoice has a refund, so a new payment cannot be recorded on it. Issue a new invoice for any amount still owed.';

function refusalToServiceError(refusal: CollectionRefusal): ServiceError {
  if (refusal.code === 'refunded_invoice') {
    return serviceError('invalid', REFUNDED_INVOICE_STAFF_MESSAGE);
  }
  return serviceError(refusal.code === 'not_found' ? 'not_found' : 'invalid', refusal.message);
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

  return db.transaction(async (tx) => {
    // Read under the same row lock a payment takes, so an invoice cannot be voided in the
    // instant after money was recorded against it.
    const invoice = first(
      await tx
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, input.invoiceId))
        .limit(1)
        .for('update'),
    );
    if (!invoice) return err(serviceError('not_found', 'invoice not found'));
    if (invoice.status === 'VOID') return ok(invoice);
    if (invoice.collectedAmountMinorUnits > 0) {
      return err(
        serviceError('invalid', 'cannot void an invoice with any amount already collected'),
      );
    }
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
    // Reminders still waiting to be sent about this invoice never go out.
    await cancelQueuedNotificationsForResource(tx, invoice.id);
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

/** Every invoice for an organization, newest first. Active-member-readable, or platform-owner-readable for any organization. */
export async function listInvoicesForOrganization(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly actorEmail?: string;
    readonly bootstrapEmails?: readonly string[];
  },
): Promise<Result<Invoice[], ServiceError>> {
  if (!(await canReadOrganizationBilling(db, input))) {
    return err(serviceError('forbidden', 'not an active member of this organization'));
  }
  const rows = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.organizationId, input.organizationId));
  return ok([...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
}

export interface InvoiceLedger {
  /** False while the ledger table does not exist yet (before migration 0094): nothing can be listed, which is not the same as nothing having been paid. */
  readonly available: boolean;
  /** Oldest first. Reversals (refunds) appear as their own negative rows. */
  readonly entries: readonly InvoicePayment[];
  /** The sum of the entries: the money the ledger says was received, less reversals. */
  readonly totalMinorUnits: number;
}

/**
 * Who may read an invoice's cash ledger. Platform staff first (they see
 * everything, including who recorded each payment), then the agency's own
 * owners and admins: payment references and gateway transaction ids are not for
 * every reviewer or case manager in the agency.
 */
export async function invoiceLedgerReader(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly actorEmail?: string;
    readonly bootstrapEmails?: readonly string[];
  },
): Promise<'member' | 'platform' | null> {
  if (input.actorEmail !== undefined) {
    const owner = await isPlatformOwner(db, {
      accountId: input.actorAccountId,
      email: input.actorEmail,
      bootstrapEmails: input.bootstrapEmails ?? [],
    });
    if (owner) return 'platform';
  }
  return (await isOrgAdmin(db, input.actorAccountId, input.organizationId)) ? 'member' : null;
}

/**
 * The cash ledger of one invoice. Readable by the owners and admins of the
 * organization the invoice belongs to, or by a platform owner. An invoice is
 * looked up inside the named organization only, so another agency's invoice
 * looks exactly like a missing one. The staff account that typed a payment in
 * is shown to platform staff only, never to the agency.
 */
export async function getInvoiceLedger(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly invoiceId: string;
    readonly actorEmail?: string;
    readonly bootstrapEmails?: readonly string[];
  },
): Promise<Result<InvoiceLedger, ServiceError>> {
  const reader = await invoiceLedgerReader(db, input);
  if (reader === null) {
    return err(serviceError('forbidden', 'not allowed to see this ledger'));
  }
  const invoice = first(
    await db
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.id, input.invoiceId),
          eq(schema.invoices.organizationId, input.organizationId),
        ),
      )
      .limit(1),
  );
  if (!invoice) return err(serviceError('not_found', 'invoice not found'));
  if (!(await invoiceLedgerPresent(db))) {
    return ok({ available: false, entries: [], totalMinorUnits: 0 });
  }
  const rows = await db
    .select()
    .from(schema.invoicePayments)
    .where(eq(schema.invoicePayments.invoiceId, invoice.id))
    .orderBy(asc(schema.invoicePayments.seq));
  const entries =
    reader === 'platform' ? rows : rows.map((row) => ({ ...row, recordedByAccountId: null }));
  return ok({ available: true, entries, totalMinorUnits: ledgerTotal(rows) });
}
