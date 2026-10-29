import { type Result, err, ok } from '@visastack/core';
import { and, eq, sql } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import {
  billingContacts,
  lockBillingAccount,
  readBillingStanding,
  recordSystemStatusChange,
  systemStatusAudit,
  systemStatusNotice,
} from './billing-cycle';
import { billingStatusCausePresent } from './billing-history';
import { type Db, first, required, schema } from './db';
import {
  cancelQueuedNotificationsForResource,
  enqueueNotificationBothChannels,
} from './notifications';
import { recordProductEvent } from './product-events';
import { type PaymentReceipt, issueReceiptForPayment } from './receipts';

/**
 * The cash ledger and the one recording function (Small Commercial V1 S10,
 * ADR 0020).
 *
 * Every way money can reach an invoice (an admin typing in a payment, an
 * approved manual claim, a gateway-verified online payment, a credit) goes
 * through `applyInvoiceCollection`, so the rules are written once:
 *
 * 1. The invoice row is locked (`FOR UPDATE`) for the whole check-then-write,
 *    so two recordings of the same balance can never both pass the check.
 * 2. A recording replayed with the same source key (or the same provider
 *    transaction) is a no-op that returns the first recording. The database
 *    enforces the same two keys as unique constraints, so even a bug here
 *    cannot count the same money twice.
 * 3. A void invoice, a different currency, or an amount above what is still
 *    outstanding is refused, never trimmed or silently added.
 * 4. One ledger row, the new invoice total and status, one audit event and one
 *    cash event are written in the caller's transaction, so they commit or
 *    roll back together.
 * 5. The same transaction issues the numbered receipt for the ledger row
 *    (receipts.ts, S12). A replay finds the first receipt; none is ever issued
 *    for anything but a recorded collection.
 *
 * The ledger is append-only (a database trigger refuses edits and deletes).
 * A correction is a new row with the opposite sign; `REFUND` rows are written
 * by the refund process (S18), not here. Amounts are whole numbers of minor
 * currency units, never fractions, and never above what the 32-bit column can
 * hold.
 *
 * Before migration 0094 the table does not exist. An admin recording
 * (`ADMIN_RECORDED`) then behaves exactly as it did before the ledger (the
 * invoice total moves and no ledger row is written; the migration's backfill
 * opens each such invoice's ledger with its collected total). Every other kind
 * is refused as "not available yet", because a provider-confirmed payment must
 * never be accepted without a ledger row to protect it from double counting.
 */

export type InvoicePaymentKind = (typeof schema.invoicePaymentKind.enumValues)[number];
export type InvoicePayment = typeof schema.invoicePayments.$inferSelect;
export type InvoiceStatus = (typeof schema.invoiceStatus.enumValues)[number];
export type Invoice = typeof schema.invoices.$inferSelect;

/** The kinds that bring money in. `REFUND` is the reversing kind and has its own process. */
export type CollectionKind = Exclude<InvoicePaymentKind, 'REFUND'>;

/** The largest amount the 32-bit amount columns can hold (about 21 million major units). */
export const MAX_MINOR_UNITS = 2_147_483_647;

const LEDGER_RELATION = 'invoice_payments';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID string (the shape of every source key). */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** An ISO currency code as the ledger compares it: trimmed and upper case. */
export function normalizeCurrency(raw: string): string {
  return raw.trim().toUpperCase();
}

/** True when the text is a three-letter currency code (before or after normalizing). */
export function isCurrencyCode(raw: string): boolean {
  return /^[A-Za-z]{3}$/.test(raw.trim());
}

/** A whole, positive number of minor units that the amount columns can hold. */
export function isValidMinorUnitAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_MINOR_UNITS;
}

/**
 * The money held by a set of ledger rows: the sum of their signed amounts.
 * Collections are positive and reversals (refunds) negative, so a reversal
 * lowers the balance without any row being edited.
 */
export function ledgerTotal(rows: readonly Pick<InvoicePayment, 'amountMinorUnits'>[]): number {
  return rows.reduce((sum, row) => sum + row.amountMinorUnits, 0);
}

/** What is still owed: invoiced minus collected, never below zero. */
export function outstandingMinorUnits(invoiced: number, collected: number): number {
  return Math.max(0, invoiced - collected);
}

/**
 * The status an invoice takes for a collected total. A void invoice stays
 * void. Nothing collected is open, everything collected is paid, anything in
 * between is partly paid (a reversal can move an invoice back down).
 */
export function invoiceStatusForTotals(
  current: InvoiceStatus,
  invoiced: number,
  collected: number,
): InvoiceStatus {
  if (current === 'VOID') return 'VOID';
  if (collected <= 0) return 'OPEN';
  return collected >= invoiced ? 'PAID' : 'PARTIALLY_PAID';
}

export type CollectionRefusalCode =
  | 'not_found'
  | 'invalid'
  | 'void_invoice'
  | 'currency_mismatch'
  | 'exceeds_outstanding'
  | 'key_conflict'
  | 'unavailable';

export interface CollectionRefusal {
  readonly code: CollectionRefusalCode;
  readonly message: string;
}

function refuse(code: CollectionRefusalCode, message: string): Result<never, CollectionRefusal> {
  return err({ code, message });
}

export interface ApplyInvoiceCollectionInput {
  readonly invoiceId: string;
  /** Whole minor currency units, greater than zero. */
  readonly amountMinorUnits: number;
  /** Must equal the invoice currency (case-insensitive). */
  readonly currency: string;
  readonly kind: CollectionKind;
  /**
   * What this money came from: the attempt, the approved claim, the held
   * attempt a credit settles, or the caller's idempotency key for an admin
   * recording. Required for every kind except `ADMIN_RECORDED`. Unique per
   * kind: the same source is recorded once.
   */
  readonly sourceId?: string | null;
  readonly provider?: string | null;
  readonly providerTransactionId?: string | null;
  /** A short outside reference (a transfer id, a gateway transaction). Never personal data. */
  readonly reference: string;
  readonly collectedDate: Date;
  /** Null when a provider confirmed the money. */
  readonly recordedByAccountId?: string | null;
  /** Why, in the person's words, for the audit record. */
  readonly reason?: string | null;
}

export interface InvoiceCollectionOutcome {
  readonly invoice: Invoice;
  /** The ledger row. Null only while the ledger table does not exist yet. */
  readonly payment: InvoicePayment | null;
  /** True when this exact recording had already been made and nothing changed. */
  readonly alreadyRecorded: boolean;
  /** The numbered receipt for the ledger row. Null while the ledger or the receipt tables do not exist yet. */
  readonly receipt: PaymentReceipt | null;
  /**
   * True when this recording left the agency with nothing overdue and so ended a Grace or
   * Suspended status that VisaStack had set (S17), in this same transaction. Never true for a
   * status a person set, for a replay, or before migration 0103.
   */
  readonly reactivated: boolean;
}

/**
 * The recording writes the new invoice total as a value worked out under the
 * row lock, which only holds inside a transaction. Handed the bare database
 * handle, two recordings could both read the old total and the later write
 * would erase the earlier one. A programmer fault, so it throws.
 */
function assertInTransaction(tx: Db): void {
  if (typeof (tx as unknown as { rollback?: unknown }).rollback !== 'function') {
    throw new Error('applyInvoiceCollection must run inside a database transaction');
  }
}

/** Whether migration 0094 has created the ledger on this database. Never raises, so a surrounding transaction is never aborted. */
export async function invoiceLedgerPresent(db: Db): Promise<boolean> {
  const rows = await db
    .select({ present: sql<boolean>`to_regclass(${LEDGER_RELATION}::text) is not null` })
    .from(sql`(select 1) as probe`);
  return rows[0]?.present === true;
}

function auditMethod(kind: CollectionKind): 'MANUAL' | 'API' | 'SYSTEM' {
  if (kind === 'ONLINE') return 'API';
  if (kind === 'CREDIT') return 'SYSTEM';
  return 'MANUAL';
}

/** The kinds that bring money in: every ledger kind except the reversing one. Read when called, never at load. */
function collectionKinds(): readonly string[] {
  return schema.invoicePaymentKind.enumValues.filter((kind) => kind !== 'REFUND');
}

function validate(input: ApplyInvoiceCollectionInput): CollectionRefusal | null {
  // The type already excludes a refund; this holds for a caller that bypasses it.
  if (!collectionKinds().includes(input.kind)) {
    return { code: 'invalid', message: 'this kind of entry is not a collection' };
  }
  if (!isValidMinorUnitAmount(input.amountMinorUnits)) {
    return {
      code: 'invalid',
      message: 'payment amount must be a whole, positive number of minor units',
    };
  }
  if (normalizeCurrency(input.currency).length === 0) {
    return { code: 'invalid', message: 'a currency is required' };
  }
  if (input.reference.trim().length === 0) {
    return { code: 'invalid', message: 'a payment reference is required' };
  }
  if (Number.isNaN(input.collectedDate.getTime())) {
    return { code: 'invalid', message: 'the collected date is not a valid date' };
  }
  const sourceId = input.sourceId ?? null;
  if (sourceId !== null && !isUuid(sourceId)) {
    return { code: 'invalid', message: 'the payment source key must be a UUID' };
  }
  if (input.kind !== 'ADMIN_RECORDED' && sourceId === null) {
    return { code: 'invalid', message: 'this kind of payment needs a source key' };
  }
  const hasProvider = (input.provider ?? null) !== null;
  const hasTransaction = (input.providerTransactionId ?? null) !== null;
  if (hasProvider !== hasTransaction) {
    return { code: 'invalid', message: 'a provider and its transaction id go together' };
  }
  if (input.kind === 'ONLINE' && !hasProvider) {
    return { code: 'invalid', message: 'an online payment needs its provider transaction' };
  }
  // NULL means "a provider confirmed this money" (ADR 0020). A person-confirmed kind must name
  // the person, and a provider-confirmed one must not, or the two could not be told apart later.
  const hasRecorder = (input.recordedByAccountId ?? null) !== null;
  if ((input.kind === 'ADMIN_RECORDED' || input.kind === 'MANUAL_CLAIM') && !hasRecorder) {
    return { code: 'invalid', message: 'a payment confirmed by a person needs that person' };
  }
  if (input.kind === 'ONLINE' && hasRecorder) {
    return { code: 'invalid', message: 'a provider-confirmed payment has no recording person' };
  }
  return null;
}

/**
 * Records money against an invoice, once. Call inside the transaction that
 * also does the caller's own work (approving a claim, settling an attempt), so
 * the caller's state change and the ledger row commit together.
 *
 * A refusal is returned, not thrown, so the caller decides what it means (an
 * online payment that exceeds the outstanding balance is held for review, an
 * admin recording is shown the message). Nothing has been written when a
 * refusal comes back.
 */
export async function applyInvoiceCollection(
  tx: Db,
  input: ApplyInvoiceCollectionInput,
): Promise<Result<InvoiceCollectionOutcome, CollectionRefusal>> {
  assertInTransaction(tx);
  const invalid = validate(input);
  if (invalid) return err(invalid);

  // The lock comes first and the ledger probe second. Migration 0094 locks the same invoice rows
  // while it opens each ledger, so a recording is either wholly before it (and the migration
  // counts it) or wholly after it (and sees the table): none can straddle it.
  const invoice = first(
    await tx
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, input.invoiceId))
      .limit(1)
      .for('update'),
  );
  if (!invoice) return refuse('not_found', 'invoice not found');

  const ledgerPresent = await invoiceLedgerPresent(tx);
  if (!ledgerPresent && input.kind !== 'ADMIN_RECORDED') {
    return refuse('unavailable', 'payments are not available yet');
  }

  const sourceId = input.sourceId ?? null;
  const provider = input.provider ?? null;
  const providerTransactionId = input.providerTransactionId ?? null;
  const payments = schema.invoicePayments;

  if (ledgerPresent) {
    // A replay is answered from the first recording, before any other check:
    // the invoice may be fully paid by now, and that is exactly what a replay
    // of the payment that paid it should find.
    const existing = await findExisting(tx, input.kind, sourceId, provider, providerTransactionId);
    if (existing) {
      if (
        existing.invoiceId !== invoice.id ||
        existing.amountMinorUnits !== input.amountMinorUnits
      ) {
        return refuse('key_conflict', 'this payment key was already used for a different payment');
      }
      // A recording made before the receipt tables existed gets its receipt on its first replay.
      const issued = await issueReceiptForPayment(tx, {
        payment: existing,
        organizationId: invoice.organizationId,
      });
      return ok({
        invoice,
        payment: existing,
        alreadyRecorded: true,
        receipt: issued?.receipt ?? null,
        reactivated: false,
      });
    }
  }

  if (invoice.status === 'VOID') {
    return refuse('void_invoice', 'cannot record a payment against a void invoice');
  }
  if (normalizeCurrency(invoice.currency) !== normalizeCurrency(input.currency)) {
    return refuse('currency_mismatch', 'this payment is in a different currency from the invoice');
  }
  const newCollected = invoice.collectedAmountMinorUnits + input.amountMinorUnits;
  if (newCollected > invoice.invoicedAmountMinorUnits) {
    return refuse('exceeds_outstanding', 'this payment would exceed the invoiced amount');
  }
  const newStatus = invoiceStatusForTotals(
    invoice.status,
    invoice.invoicedAmountMinorUnits,
    newCollected,
  );

  let payment: InvoicePayment | null = null;
  if (ledgerPresent) {
    const inserted = await tx
      .insert(payments)
      .values({
        invoiceId: invoice.id,
        amountMinorUnits: input.amountMinorUnits,
        currency: normalizeCurrency(invoice.currency),
        kind: input.kind,
        sourceId,
        provider,
        providerTransactionId,
        reference: input.reference.trim(),
        collectedDate: input.collectedDate,
        recordedByAccountId: input.recordedByAccountId ?? null,
      })
      .onConflictDoNothing()
      .returning();
    payment = first(inserted) ?? null;
    if (payment === null) {
      // Another transaction recorded the same key an instant ago, against a different
      // invoice (so our invoice lock did not order us). Nothing has been written.
      return refuse('key_conflict', 'this payment key was already used for a different payment');
    }
  }

  const updated = required(
    first(
      await tx
        .update(schema.invoices)
        .set({
          collectedAmountMinorUnits: newCollected,
          collectedDate: input.collectedDate,
          paymentReference: input.reference.trim(),
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
    actorAccountId: input.recordedByAccountId ?? null,
    action: 'MANAGE',
    method: auditMethod(input.kind),
    result: 'ALLOWED',
    resourceType: 'invoice',
    resourceId: invoice.id,
    reason: input.reason ?? null,
    metadata: {
      organizationId: invoice.organizationId,
      amountMinorUnits: input.amountMinorUnits,
      newCollectedAmountMinorUnits: newCollected,
      newStatus,
      kind: input.kind,
      currency: normalizeCurrency(invoice.currency),
      ledgerEntryId: payment?.id ?? null,
    },
  });
  // OPS-04 cash collection: money actually received, as currency and amount
  // only (the reference and the reason stay in the audit record). A credit
  // settles a held online payment that was never counted, so it is cash too.
  await recordProductEvent(tx, {
    eventType: 'CASH_COLLECTED',
    accountId: null,
    organizationId: invoice.organizationId,
    dimension: invoice.currency.trim().toUpperCase(),
    metricValue: input.amountMinorUnits,
  });
  const issued = payment
    ? await issueReceiptForPayment(tx, { payment, organizationId: invoice.organizationId })
    : null;
  // S17: a paid invoice's queued reminders never go out, and paying everything that was overdue
  // ends a Grace or Suspended status VisaStack set, in this same transaction (so a rollback undoes
  // both). The invoice is locked first and the billing account second, the one order every path
  // uses.
  if (newStatus === 'PAID') await cancelQueuedNotificationsForResource(tx, invoice.id);
  const reactivated = await restoreBillingAfterPayment(
    tx,
    invoice.organizationId,
    payment?.id ?? `${invoice.id}:${newCollected}`,
  );
  return ok({
    invoice: updated,
    payment,
    alreadyRecorded: false,
    receipt: issued?.receipt ?? null,
    reactivated,
  });
}

async function findExisting(
  tx: Db,
  kind: CollectionKind,
  sourceId: string | null,
  provider: string | null,
  providerTransactionId: string | null,
): Promise<InvoicePayment | undefined> {
  const payments = schema.invoicePayments;
  if (sourceId !== null) {
    const bySource = first(
      await tx
        .select()
        .from(payments)
        .where(and(eq(payments.kind, kind), eq(payments.sourceId, sourceId)))
        .limit(1),
    );
    if (bySource) return bySource;
  }
  if (provider !== null && providerTransactionId !== null) {
    return first(
      await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.provider, provider),
            eq(payments.providerTransactionId, providerTransactionId),
          ),
        )
        .limit(1),
    );
  }
  return undefined;
}

/**
 * After a new payment was recorded, in the same transaction: when the agency now owes nothing
 * overdue and its Grace or Suspended status was set by VisaStack, it returns to Active
 * ("system: paid"), with a history row, an audit record and a notice to its owners and admins.
 * A status a person set is never changed, a partial payment that leaves anything overdue changes
 * nothing, and before migration 0103 nothing happens. The invoice row is already locked; the
 * billing account is locked here, always in that order (the daily run never locks invoices).
 * Module-private on purpose: only the one recording function can end a suspension.
 */
async function restoreBillingAfterPayment(
  tx: Db,
  organizationId: string,
  paymentKey: string,
): Promise<boolean> {
  if (!(await billingStatusCausePresent(tx))) return false;
  const account = await lockBillingAccount(tx, organizationId);
  if (!account || (account.status !== 'GRACE' && account.status !== 'SUSPENDED')) return false;
  const standing = await readBillingStanding(tx, account, null);
  if (standing.cause !== 'NONPAYMENT' || standing.overdue.length > 0) return false;
  const change = {
    toStatus: 'ACTIVE' as const,
    reason: 'system: paid',
    invoice: null,
    daysOverdue: null,
  };
  await recordSystemStatusChange(tx, account, change);
  await appendAuditEvent(tx, systemStatusAudit(account, change));
  const notice = systemStatusNotice(account, change, paymentKey);
  if (notice) {
    for (const recipientAccountId of await billingContacts(tx, organizationId)) {
      await enqueueNotificationBothChannels(tx, { ...notice, recipientAccountId });
    }
  }
  return true;
}
