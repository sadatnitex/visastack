import { type Result, err, ok } from '@visastack/core';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { type SelfScope, selfScopeProblem } from './access/principal';
import {
  type BillingDocument,
  type BillingDocumentTone,
  type InvoiceDocumentPayment,
  PERSON_NOT_PAID_LABEL,
  type PersonPayer,
  buildPersonInvoiceDocument,
  buildPersonReceiptDocument,
  personInvoiceDocumentStamp,
} from './billing-documents';
import { invoiceHasRefundSql } from './billing-standing';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { isUuid, normalizeCurrency } from './invoice-ledger';
import { IN_FLIGHT_ATTEMPTS, personInvoiceInTime, referenceCode } from './person-billing';
import {
  personInvoices,
  personPaymentAttempts,
  personPaymentReceipts,
} from './person-billing-tables';
import { formatReceiptNumber } from './receipts';
import { personBillingPresent } from './traveller-billing';

/**
 * A person's own Billing History (ADR 0025, T5): their purchase invoices, the receipts for them,
 * and the Invoice and Receipt PDFs. Read only.
 *
 * - Every function takes the signed-in person's `SelfScope`, checks it first, and reads only rows
 *   whose payer is that person. Another person's invoice or receipt reads as not found, exactly as
 *   an unknown id does, so nothing about it is revealed.
 * - Nothing is read before migrations 0110 and 0111 (`personBillingPresent`): before them nobody
 *   has bought anything, so the history is empty and every document is not found.
 * - The selling switch (`TRAVELLER_PLANS_ENABLED`) is not consulted here: a purchase made while it
 *   was on stays the person's record. The page decides what to show while it is off.
 * - The documents name the payer by reference code and their own sign-in address, read when the
 *   document is made (ADR 0025 D14 and section 7). Never a name, a traveller record or a case.
 */

/** How long after paying a person can ask for a full refund (ADR 0025 D8). */
export const PERSON_REFUND_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_FOUND = 'document not found';

/** Where a purchase stands, in the words the page and the PDF both use. */
export type OwnPurchaseStatus = 'paid' | 'waiting' | 'not_paid' | 'cancelled' | 'refunded';

export interface OwnReceiptView {
  readonly id: string;
  readonly receiptNumber: number;
  /** As people read it (R-000001), in the person's own series. */
  readonly number: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly issuedAt: Date;
  /** TEST for a payment made in the gateway's test mode (not money received). */
  readonly mode: 'TEST' | 'LIVE';
}

export interface OwnPurchaseView {
  readonly id: string;
  readonly invoiceRef: string;
  readonly planName: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly status: OwnPurchaseStatus;
  /** Paid, Waiting for Payment, Not Paid, Cancelled, Refunded or Partly Refunded. */
  readonly statusLabel: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  /** When it was paid, for a paid purchase. */
  readonly paidAt: Date | null;
  /** True when every payment on it was made in the gateway's test mode. */
  readonly testPayment: boolean;
  /**
   * The last moment a full refund can be asked for (paid date + 7 days), while that is still
   * ahead; null for anything that is not a real, paid, unrefunded purchase inside the window.
   */
  readonly refundableUntil: Date | null;
  /** Its receipts, lowest number first. */
  readonly receipts: readonly OwnReceiptView[];
}

function statusOf(tone: BillingDocumentTone): OwnPurchaseStatus {
  if (tone === 'paid') return 'paid';
  if (tone === 'refunded') return 'refunded';
  if (tone === 'cancelled') return 'cancelled';
  return 'waiting';
}

const refundedSql = () => sql<boolean>`${invoiceHasRefundSql(sql`${personInvoices.id}`)}`;

/**
 * Which of these unpaid invoices of the person can still be paid, or have a payment on the way
 * (a confirmation can arrive days later): those still read "Waiting for Payment", the rest "Not
 * Paid". The same rule as paying (`personInvoiceInTime`).
 */
async function stillPayable(
  db: Db,
  accountId: string,
  invoices: readonly {
    readonly id: string;
    readonly subscriptionId: string | null;
    readonly periodStart: Date;
  }[],
  now: Date,
): Promise<ReadonlySet<string>> {
  const payable = new Set(
    invoices.filter((row) => personInvoiceInTime(row, now)).map((row) => row.id),
  );
  const others = invoices.filter((row) => !payable.has(row.id)).map((row) => row.id);
  if (others.length === 0) return payable;
  const a = personPaymentAttempts;
  const confirming = await db
    .select({ invoiceId: a.invoiceId })
    .from(a)
    .where(
      and(
        eq(a.payerAccountId, accountId),
        inArray(a.invoiceId, others),
        inArray(a.status, [...IN_FLIGHT_ATTEMPTS]),
      ),
    );
  for (const row of confirming) payable.add(row.invoiceId);
  return payable;
}

/**
 * Whether the signed-in person has any purchase invoice at all. One small read, so a page can
 * decide whether to show billing while selling is switched off. False before migration 0110 and
 * for a scope that is not genuine.
 */
export async function hasOwnBilling(db: Db, self: SelfScope): Promise<boolean> {
  if (selfScopeProblem(self)) return false;
  if (!(await personBillingPresent(db))) return false;
  const row = first(
    await db
      .select({ id: personInvoices.id })
      .from(personInvoices)
      .where(eq(personInvoices.payerAccountId, self.accountId))
      .limit(1),
  );
  return row !== undefined;
}

/**
 * The signed-in person's own purchases, newest first, each with its plan, amount, status in plain
 * words, period, paid date, refund window and receipts. Only rows whose payer is this person.
 * Empty before migrations 0110 and 0111.
 */
export async function listOwnBilling(
  db: Db,
  self: SelfScope,
  input: { readonly now?: Date } = {},
): Promise<Result<readonly OwnPurchaseView[], ServiceError>> {
  const denied = selfScopeProblem(self);
  if (denied) return err(denied);
  if (!(await personBillingPresent(db))) return ok([]);
  const now = input.now ?? new Date();
  const accountId = self.accountId;
  const i = personInvoices;

  const invoices = await db
    .select({
      id: i.id,
      invoiceRef: i.invoiceRef,
      planName: schema.plans.name,
      amountMinorUnits: i.invoicedAmountMinorUnits,
      collectedAmountMinorUnits: i.collectedAmountMinorUnits,
      currency: i.currency,
      status: i.status,
      subscriptionId: i.subscriptionId,
      periodStart: i.periodStart,
      periodEnd: i.periodEnd,
      collectedDate: i.collectedDate,
      refunded: refundedSql(),
    })
    .from(i)
    .innerJoin(schema.plans, eq(schema.plans.id, i.planId))
    .where(eq(i.payerAccountId, accountId))
    .orderBy(desc(i.createdAt), desc(i.periodStart), desc(i.id));
  if (invoices.length === 0) return ok([]);
  const ids = invoices.map((row) => row.id);
  const payable = await stillPayable(db, accountId, invoices, now);

  // How each invoice was paid (test or real money). The ledger has no payer column; it is read
  // only for invoices already proven to be this person's.
  const p = schema.invoicePayments;
  const ledger = await db
    .select({ invoiceId: p.invoiceId, kind: p.kind, mode: p.mode })
    .from(p)
    .where(inArray(p.invoiceId, ids));

  const r = personPaymentReceipts;
  const receiptRows = await db
    .select({
      id: r.id,
      invoiceId: r.invoiceId,
      receiptNumber: r.receiptNumber,
      amountMinorUnits: r.amountMinorUnits,
      currency: r.currency,
      issuedAt: r.issuedAt,
      mode: p.mode,
    })
    .from(r)
    .innerJoin(p, eq(p.id, r.invoicePaymentId))
    .where(and(eq(r.payerAccountId, accountId), inArray(r.invoiceId, ids)))
    .orderBy(asc(r.receiptNumber));

  const receiptsByInvoice = new Map<string, OwnReceiptView[]>();
  for (const row of receiptRows) {
    const list = receiptsByInvoice.get(row.invoiceId) ?? [];
    list.push({
      id: row.id,
      receiptNumber: row.receiptNumber,
      number: formatReceiptNumber(row.receiptNumber),
      amountMinorUnits: row.amountMinorUnits,
      currency: normalizeCurrency(row.currency),
      issuedAt: row.issuedAt,
      mode: row.mode,
    });
    receiptsByInvoice.set(row.invoiceId, list);
  }

  return ok(
    invoices.map((row): OwnPurchaseView => {
      const refunded = row.refunded === true;
      const stamp = personInvoiceDocumentStamp({
        status: row.status,
        collectedAmountMinorUnits: row.collectedAmountMinorUnits,
        refunded,
        stillPayable: payable.has(row.id),
      });
      const status = stamp.label === PERSON_NOT_PAID_LABEL ? 'not_paid' : statusOf(stamp.tone);
      const money = ledger.filter((entry) => entry.invoiceId === row.id && entry.kind !== 'REFUND');
      const testPayment = money.length > 0 && money.every((entry) => entry.mode === 'TEST');
      // The day it was paid stays after a refund (a refunded invoice is no longer PAID).
      const paidAt = status === 'paid' || status === 'refunded' ? row.collectedDate : null;
      const windowEnd =
        status !== 'paid' || paidAt === null
          ? null
          : new Date(paidAt.getTime() + PERSON_REFUND_WINDOW_DAYS * DAY_MS);
      const refundableUntil =
        windowEnd !== null && !testPayment && windowEnd.getTime() > now.getTime()
          ? windowEnd
          : null;
      return {
        id: row.id,
        invoiceRef: row.invoiceRef,
        planName: row.planName,
        amountMinorUnits: row.amountMinorUnits,
        currency: normalizeCurrency(row.currency),
        status,
        statusLabel: stamp.label,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        paidAt,
        testPayment,
        refundableUntil,
        receipts: receiptsByInvoice.get(row.id) ?? [],
      };
    }),
  );
}

/** The person as their own documents show them: reference code and sign-in address, read now. */
async function payerOf(db: Db, accountId: string): Promise<PersonPayer> {
  const row = first(
    await db
      .select({ email: schema.accounts.email })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1),
  );
  return { referenceCode: referenceCode(accountId), email: row?.email ?? null };
}

/**
 * The Invoice PDF's content for one of the signed-in person's own invoices. Another person's
 * invoice, an agency's invoice, an unknown id and any id before migration 0110 are all "not found".
 */
export async function ownInvoiceDocument(
  db: Db,
  self: SelfScope,
  invoiceId: string,
  now: Date = new Date(),
): Promise<Result<BillingDocument, ServiceError>> {
  const denied = selfScopeProblem(self);
  if (denied) return err(denied);
  if (!isUuid(invoiceId) || !(await personBillingPresent(db))) {
    return err(serviceError('not_found', NOT_FOUND));
  }
  const i = personInvoices;
  const row = first(
    await db
      .select({
        invoiceRef: i.invoiceRef,
        status: i.status,
        currency: i.currency,
        invoicedAmountMinorUnits: i.invoicedAmountMinorUnits,
        collectedAmountMinorUnits: i.collectedAmountMinorUnits,
        issuedAt: i.createdAt,
        periodStart: i.periodStart,
        periodEnd: i.periodEnd,
        collectedDate: i.collectedDate,
        subscriptionId: i.subscriptionId,
        planName: schema.plans.name,
      })
      .from(i)
      .innerJoin(schema.plans, eq(schema.plans.id, i.planId))
      .where(and(eq(i.id, invoiceId), eq(i.payerAccountId, self.accountId)))
      .limit(1),
  );
  if (!row) return err(serviceError('not_found', NOT_FOUND));

  const p = schema.invoicePayments;
  const r = personPaymentReceipts;
  const entries = await db
    .select({
      id: p.id,
      kind: p.kind,
      mode: p.mode,
      amountMinorUnits: p.amountMinorUnits,
      collectedDate: p.collectedDate,
      reference: p.reference,
      receiptNumber: r.receiptNumber,
    })
    .from(p)
    .leftJoin(r, and(eq(r.invoicePaymentId, p.id), eq(r.payerAccountId, self.accountId)))
    .where(eq(p.invoiceId, invoiceId))
    .orderBy(asc(p.collectedDate), asc(p.seq));
  const payments: InvoiceDocumentPayment[] = entries.map((entry) => ({
    kind: entry.kind,
    mode: entry.mode,
    amountMinorUnits: entry.amountMinorUnits,
    collectedDate: entry.collectedDate,
    reference: entry.reference,
    receiptNumber: entry.receiptNumber ?? null,
  }));

  return ok(
    buildPersonInvoiceDocument(
      {
        invoiceRef: row.invoiceRef,
        status: row.status,
        currency: normalizeCurrency(row.currency),
        invoicedAmountMinorUnits: row.invoicedAmountMinorUnits,
        collectedAmountMinorUnits: row.collectedAmountMinorUnits,
        issuedAt: row.issuedAt,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        planName: row.planName,
        paidAt:
          row.status === 'PAID' || payments.some((entry) => entry.kind === 'REFUND')
            ? row.collectedDate
            : null,
        stillPayable: (
          await stillPayable(db, self.accountId, [{ id: invoiceId, ...row }], now)
        ).has(invoiceId),
        payer: await payerOf(db, self.accountId),
        payments,
      },
      now,
    ),
  );
}

/**
 * The Receipt PDF's content for one of the signed-in person's own receipts. Another person's
 * receipt, an agency's receipt, an unknown id and any id before migration 0110 are "not found".
 */
export async function ownReceiptDocument(
  db: Db,
  self: SelfScope,
  receiptId: string,
  now: Date = new Date(),
): Promise<Result<BillingDocument, ServiceError>> {
  const denied = selfScopeProblem(self);
  if (denied) return err(denied);
  if (!isUuid(receiptId) || !(await personBillingPresent(db))) {
    return err(serviceError('not_found', NOT_FOUND));
  }
  const r = personPaymentReceipts;
  const i = personInvoices;
  const p = schema.invoicePayments;
  const row = first(
    await db
      .select({
        receiptNumber: r.receiptNumber,
        kind: p.kind,
        mode: p.mode,
        amountMinorUnits: r.amountMinorUnits,
        currency: r.currency,
        collectedDate: p.collectedDate,
        issuedAt: r.issuedAt,
        reference: p.reference,
        invoiceRef: i.invoiceRef,
        invoicedAmountMinorUnits: i.invoicedAmountMinorUnits,
        periodStart: i.periodStart,
        periodEnd: i.periodEnd,
        planName: schema.plans.name,
      })
      .from(r)
      .innerJoin(i, and(eq(i.id, r.invoiceId), eq(i.payerAccountId, self.accountId)))
      .innerJoin(p, eq(p.id, r.invoicePaymentId))
      .innerJoin(schema.plans, eq(schema.plans.id, i.planId))
      .where(and(eq(r.id, receiptId), eq(r.payerAccountId, self.accountId)))
      .limit(1),
  );
  if (!row) return err(serviceError('not_found', NOT_FOUND));
  return ok(
    buildPersonReceiptDocument(
      {
        ...row,
        currency: normalizeCurrency(row.currency),
        payer: await payerOf(db, self.accountId),
      },
      now,
    ),
  );
}
