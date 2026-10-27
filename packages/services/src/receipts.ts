import { eq, sql } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';

/**
 * Numbered receipts for recorded money (Small Commercial V1 S12, ADR 0020).
 *
 * A receipt is a plain record that VisaStack counted a payment against an invoice. It is issued
 * by `applyInvoiceCollection`, in the same transaction as the ledger row, and by nothing else:
 *
 * - A receipt exists only for a recorded collection. The receipt row points at the ledger row
 *   with a unique foreign key, so a receipt without money, or two receipts for one payment, are
 *   impossible at the database level. A replay of the same recording finds the first receipt.
 * - Numbers run 1, 2, 3 ... per agency with no gaps and no repeats. The next number is taken from
 *   the agency's counter row inside the recording's own transaction: a recording that rolls back
 *   gives its number back, and two recordings at once take turns on the counter row's lock.
 * - Receipts are append-only (a database trigger refuses edits and deletes). A correction is a
 *   refund and a new receipt, never an edit.
 * - A receipt holds an amount, a currency and ids. No reference text, no names, no documents.
 *
 * Before migration 0097 the tables do not exist: nothing is issued and nothing is listed, and the
 * recording itself is unaffected.
 */

export type PaymentReceipt = typeof schema.paymentReceipts.$inferSelect;

const RECEIPTS_RELATION = 'payment_receipts';

/** The number as people read it: R-000042. Six digits, then more only when an agency passes a million. */
export function formatReceiptNumber(receiptNumber: number): string {
  return `R-${String(receiptNumber).padStart(6, '0')}`;
}

/** Whether migration 0097 has created the receipt tables. Never raises, so a surrounding transaction is never aborted. */
export async function receiptsPresent(db: Db): Promise<boolean> {
  const rows = await db
    .select({ present: sql<boolean>`to_regclass(${RECEIPTS_RELATION}::text) is not null` })
    .from(sql`(select 1) as probe`);
  return rows[0]?.present === true;
}

export interface IssuedReceipt {
  readonly receipt: PaymentReceipt;
  /** False when the payment already had its receipt (a replay) and nothing was written. */
  readonly created: boolean;
}

/**
 * The receipt for one ledger row, issued now if it has none. Call inside the transaction that
 * holds the invoice's row lock (`applyInvoiceCollection` does), so two callers can never issue
 * two receipts for one payment. Returns null for a reversal (a refund is not a receipt) and while
 * the receipt tables do not exist yet.
 */
export async function issueReceiptForPayment(
  tx: Db,
  input: {
    readonly payment: {
      readonly id: string;
      readonly invoiceId: string;
      readonly amountMinorUnits: number;
      readonly currency: string;
    };
    readonly organizationId: string;
  },
): Promise<IssuedReceipt | null> {
  if (input.payment.amountMinorUnits <= 0) return null;
  if (!(await receiptsPresent(tx))) return null;
  const receipts = schema.paymentReceipts;

  const existing = first(
    await tx.select().from(receipts).where(eq(receipts.invoicePaymentId, input.payment.id)),
  );
  if (existing) return { receipt: existing, created: false };

  // The counter row is the turnstile: the first recording for an agency creates it at 1, every
  // later one adds 1 while holding its lock until the transaction ends.
  const counters = schema.paymentReceiptCounters;
  const counter = required(
    first(
      await tx
        .insert(counters)
        .values({ organizationId: input.organizationId, lastNumber: 1 })
        .onConflictDoUpdate({
          target: counters.organizationId,
          set: { lastNumber: sql`${counters.lastNumber} + 1` },
        })
        .returning({ lastNumber: counters.lastNumber }),
    ),
    'receipt counter',
  );
  const receipt = required(
    first(
      await tx
        .insert(receipts)
        .values({
          organizationId: input.organizationId,
          invoiceId: input.payment.invoiceId,
          invoicePaymentId: input.payment.id,
          receiptNumber: counter.lastNumber,
          amountMinorUnits: input.payment.amountMinorUnits,
          currency: input.payment.currency,
        })
        .returning(),
    ),
    'receipt',
  );
  // Ids, the number, the amount and the currency only.
  await appendAuditEvent(tx, {
    eventType: 'PAYMENT_RECEIPT_ISSUED',
    actorAccountId: null,
    action: 'MANAGE',
    method: 'SYSTEM',
    result: 'ALLOWED',
    resourceType: 'payment_receipt',
    resourceId: receipt.id,
    metadata: {
      organizationId: input.organizationId,
      invoiceId: input.payment.invoiceId,
      invoicePaymentId: input.payment.id,
      receiptNumber: receipt.receiptNumber,
      amountMinorUnits: receipt.amountMinorUnits,
      currency: receipt.currency,
    },
  });
  return { receipt, created: true };
}
