import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { invoiceLedgerReader } from './billing';
import { type Db, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import type { Invoice, InvoiceStatus } from './invoice-ledger';
import { outstandingMinorUnits } from './invoice-ledger';
import { type ManualClaimView, listManualClaims } from './manual-claims';
import { isMissingRelationError } from './missing-relation';
import { clampLimit } from './paging';
import {
  type PaymentAttempt,
  type PaymentAttemptView,
  attemptView,
  isRecentAttempt,
  isStrandedAttempt,
} from './payments';
import { attemptColumns } from './plans-schema';
import type { PaymentPortResolver } from './ports';
import { type ReceiptView, listReceipts } from './receipt-views';

/**
 * The agency's Invoices page (Small Commercial V1 S12, ADR 0020): every invoice of one agency with
 * where its payment stands, its recent online payments, its payment reports and its receipts.
 *
 * Only the agency's owners and admins (and platform staff) can read it; an ordinary member sees
 * nothing, because payment references and gateway state are not for every reviewer. Reading is
 * limited to the one named agency, so another agency's invoices cannot appear.
 *
 * The plain state comes from facts, never from a stored label:
 *
 * - Needs a Check: an online payment was confirmed by the gateway but not counted (risky, wrong
 *   amount, the invoice was settled another way). A platform admin looks at it. It outranks Paid.
 * - Paid: the ledger covers the invoice.
 * - Payment Reported: a payment report is waiting for a platform admin.
 * - Payment Started: an online payment page was opened a few minutes ago.
 * - Open: nothing is under way. Part paid is still open, with a smaller balance.
 * - Refunded, Partly Refunded (S18): money went back from this invoice. A refunded invoice is
 *   never owed again (ADR 0020 S18 amendment D2): no balance is shown and it cannot be paid.
 */

export type InvoicePaymentState =
  | 'OPEN'
  | 'PAYMENT_STARTED'
  | 'PAYMENT_REPORTED'
  | 'PAID'
  | 'NEEDS_CHECK'
  | 'REFUNDED'
  | 'PARTLY_REFUNDED'
  | 'VOID';

export interface StateFacts {
  readonly status: InvoiceStatus;
  readonly attempts: readonly Pick<PaymentAttempt, 'status' | 'createdAt' | 'redirectedAt'>[];
  readonly waitingClaim: boolean;
  readonly now: Date;
  /** What went back from this invoice (S18), in minor units. Zero when nothing did. */
  readonly refundedMinorUnits?: number;
}

/** The one place the plain state is decided. A void invoice ignores everything else; money held for a check outranks Paid. */
export function deriveInvoicePaymentState(facts: StateFacts): InvoicePaymentState {
  if (facts.status === 'VOID') return 'VOID';
  // Money the gateway confirmed but VisaStack did not count outranks Paid: an invoice paid another
  // way that also took an online payment has cash that needs sorting out, and the agency is told.
  if (facts.attempts.some((attempt) => attempt.status === 'HELD_FOR_REVIEW')) return 'NEEDS_CHECK';
  // A refund outranks every payment state: the invoice is never owed again (D2).
  if ((facts.refundedMinorUnits ?? 0) > 0) {
    return facts.status === 'OPEN' ? 'REFUNDED' : 'PARTLY_REFUNDED';
  }
  if (facts.status === 'PAID') return 'PAID';
  if (facts.waitingClaim) return 'PAYMENT_REPORTED';
  if (facts.attempts.some((attempt) => isRecentAttempt(attempt, facts.now))) {
    return 'PAYMENT_STARTED';
  }
  return 'OPEN';
}

export interface AgencyInvoiceView {
  readonly id: string;
  readonly invoiceRef: string;
  readonly currency: string;
  readonly status: InvoiceStatus;
  readonly state: InvoicePaymentState;
  readonly partlyPaid: boolean;
  readonly invoicedAmountMinorUnits: number;
  readonly collectedAmountMinorUnits: number;
  /** What is still owed. Zero for a refunded invoice, which is never owed again (D2). */
  readonly outstandingMinorUnits: number;
  /** What went back from this invoice (S18). */
  readonly refundedMinorUnits: number;
  /** What was counted from an earlier payment ("Credit from an earlier payment", S18). */
  readonly creditMinorUnits: number;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly dueDate: Date;
  /** When the payer was last sent to the payment page, if that was recent enough to check first. */
  readonly recentAttemptStartedAt: Date | null;
  /**
   * True when a payment of this invoice is stranded (`isStrandedAttempt`, S19 step 0 round 3): the
   * payer is told to contact VisaStack and is offered no new online payment. The same answer
   * `startOnlinePayment` and Check Status give.
   */
  readonly strandedPayment: boolean;
  /** Newest first, at most five. */
  readonly attempts: readonly PaymentAttemptView[];
  readonly claims: readonly ManualClaimView[];
  readonly receipts: readonly ReceiptView[];
}

const NOT_ALLOWED = 'Only owners and admins can see invoices.';
const INVOICE_LIMIT = 50;
const ATTEMPTS_SHOWN = 5;

function newestFirst<T extends { readonly createdAt: Date }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * The invoices of one agency for its Invoices page, newest first. A payment report, receipt or
 * online payment that cannot be read yet (its migration has not run) simply shows as none.
 */
export async function listAgencyInvoices(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly actorEmail?: string;
    readonly bootstrapEmails?: readonly string[];
    readonly now?: Date;
    /**
     * The payment providers configured now: the same resolver the payment services take (S19 step
     * 0 round 4), so the Invoices page and the services can never disagree about a stranded payment.
     */
    readonly payments: Pick<PaymentPortResolver, 'configured'>;
    /** WP-SB9: how many of the newest invoices to read (1 to 100); 50 when left out. */
    readonly limit?: number;
  },
): Promise<Result<AgencyInvoiceView[], ServiceError>> {
  const reader = await invoiceLedgerReader(db, input);
  if (reader === null) return err(serviceError('forbidden', NOT_ALLOWED));
  const now = input.now ?? new Date();
  const configuredProviders = input.payments.configured().map((port) => port.provider);

  const invoices: Invoice[] = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.organizationId, input.organizationId))
    .orderBy(desc(schema.invoices.createdAt), desc(schema.invoices.id))
    .limit(input.limit === undefined ? INVOICE_LIMIT : clampLimit(input.limit));
  if (invoices.length === 0) return ok([]);
  const ids = invoices.map((invoice) => invoice.id);

  let attempts: PaymentAttempt[] = [];
  try {
    attempts = await db
      .select(attemptColumns())
      .from(schema.paymentAttempts)
      .where(inArray(schema.paymentAttempts.invoiceId, ids))
      .orderBy(desc(schema.paymentAttempts.createdAt))
      .limit(500);
  } catch (error) {
    if (!isMissingRelationError(error)) throw error;
  }
  // Refunds and credits per invoice, from the ledger (since migration 0094).
  const refunded = new Map<string, number>();
  const credited = new Map<string, number>();
  try {
    const p = schema.invoicePayments;
    const rows = await db
      .select({ invoiceId: p.invoiceId, kind: p.kind, amountMinorUnits: p.amountMinorUnits })
      .from(p)
      .where(and(inArray(p.invoiceId, ids), inArray(p.kind, ['REFUND', 'CREDIT'])));
    for (const row of rows) {
      const into = row.kind === 'REFUND' ? refunded : credited;
      into.set(row.invoiceId, (into.get(row.invoiceId) ?? 0) + Math.abs(row.amountMinorUnits));
    }
  } catch (error) {
    if (!isMissingRelationError(error)) throw error;
  }
  const claims = await listManualClaims(db, input);
  const receipts = await listReceipts(db, { ...input, invoiceIds: ids });

  const platform = reader === 'platform';
  return ok(
    invoices.map((invoice) => {
      const mine = attempts.filter((attempt) => attempt.invoiceId === invoice.id);
      const myClaims = claims.ok ? claims.value.filter((c) => c.invoiceId === invoice.id) : [];
      const state = deriveInvoicePaymentState({
        status: invoice.status,
        attempts: mine,
        waitingClaim: myClaims.some((claim) => claim.status === 'SUBMITTED'),
        now,
        refundedMinorUnits: refunded.get(invoice.id) ?? 0,
      });
      const wasRefunded = (refunded.get(invoice.id) ?? 0) > 0;
      const recent = mine.find((attempt) => isRecentAttempt(attempt, now));
      return {
        id: invoice.id,
        invoiceRef: invoice.invoiceRef,
        currency: invoice.currency.trim().toUpperCase(),
        status: invoice.status,
        state,
        partlyPaid: invoice.status === 'PARTIALLY_PAID',
        invoicedAmountMinorUnits: invoice.invoicedAmountMinorUnits,
        collectedAmountMinorUnits: invoice.collectedAmountMinorUnits,
        outstandingMinorUnits: wasRefunded
          ? 0
          : outstandingMinorUnits(
              invoice.invoicedAmountMinorUnits,
              invoice.collectedAmountMinorUnits,
            ),
        refundedMinorUnits: refunded.get(invoice.id) ?? 0,
        creditMinorUnits: credited.get(invoice.id) ?? 0,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        dueDate: invoice.dueDate,
        recentAttemptStartedAt: recent ? (recent.redirectedAt ?? recent.createdAt) : null,
        strandedPayment: mine.some((attempt) =>
          isStrandedAttempt(attempt, configuredProviders, now),
        ),
        attempts: newestFirst(mine)
          .slice(0, ATTEMPTS_SHOWN)
          .map((attempt) => attemptView(attempt, platform)),
        claims: myClaims,
        receipts: receipts.ok ? receipts.value.filter((r) => r.invoiceId === invoice.id) : [],
      };
    }),
  );
}
