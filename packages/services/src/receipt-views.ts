import { type Result, err, ok } from '@visastack/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { invoiceLedgerReader } from './billing';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { isMissingRelationError } from './missing-relation';
import { formatReceiptNumber } from './receipts';

/**
 * Reading receipts (Small Commercial V1 S12, ADR 0020). Issuing lives in `receipts.ts`, called
 * only by the one recording function; this file only reads, and only for the agency's owners and
 * admins and for platform staff (the same readers as the cash ledger).
 */

// --- Reading ----------------------------------------------------------------------------------

/** Who is asking: the agency's owners and admins, or platform staff. The same rule as the ledger. */
export interface ReceiptReader {
  readonly actorAccountId: string;
  readonly organizationId: string;
  readonly actorEmail?: string;
  readonly bootstrapEmails?: readonly string[];
}

export interface ReceiptView {
  readonly id: string;
  readonly receiptNumber: number;
  /** The number as people read it (R-000042). */
  readonly number: string;
  readonly invoiceId: string;
  readonly invoiceRef: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  /** How the money arrived: ONLINE, MANUAL_CLAIM, ADMIN_RECORDED or CREDIT. */
  readonly kind: string;
  readonly collectedDate: Date;
  readonly issuedAt: Date;
}

const NOT_ALLOWED = 'not allowed to see these receipts';

function viewColumns() {
  return {
    id: schema.paymentReceipts.id,
    receiptNumber: schema.paymentReceipts.receiptNumber,
    invoiceId: schema.paymentReceipts.invoiceId,
    invoiceRef: schema.invoices.invoiceRef,
    amountMinorUnits: schema.paymentReceipts.amountMinorUnits,
    currency: schema.paymentReceipts.currency,
    kind: schema.invoicePayments.kind,
    collectedDate: schema.invoicePayments.collectedDate,
    issuedAt: schema.paymentReceipts.issuedAt,
  };
}

function toView(row: {
  id: string;
  receiptNumber: number;
  invoiceId: string;
  invoiceRef: string;
  amountMinorUnits: number;
  currency: string;
  kind: string;
  collectedDate: Date;
  issuedAt: Date;
}): ReceiptView {
  return { ...row, number: formatReceiptNumber(row.receiptNumber) };
}

/**
 * The receipts of one agency (optionally one invoice, or a set of invoices), oldest number first. Readable by the
 * agency's owners and admins or by a platform owner; everyone else is refused. Only the named
 * agency's receipts are ever read. Empty while the receipt tables do not exist yet.
 */
export async function listReceipts(
  db: Db,
  input: ReceiptReader & {
    readonly invoiceId?: string;
    readonly invoiceIds?: readonly string[];
  },
): Promise<Result<ReceiptView[], ServiceError>> {
  if ((await invoiceLedgerReader(db, input)) === null) {
    return err(serviceError('forbidden', NOT_ALLOWED));
  }
  try {
    const receipts = schema.paymentReceipts;
    const filters = [eq(receipts.organizationId, input.organizationId)];
    if (input.invoiceId !== undefined) filters.push(eq(receipts.invoiceId, input.invoiceId));
    if (input.invoiceIds !== undefined) {
      if (input.invoiceIds.length === 0) return ok([]);
      filters.push(inArray(receipts.invoiceId, [...input.invoiceIds]));
    }
    const scope = and(...filters);
    const rows = await db
      .select(viewColumns())
      .from(receipts)
      .innerJoin(schema.invoices, eq(schema.invoices.id, receipts.invoiceId))
      .innerJoin(schema.invoicePayments, eq(schema.invoicePayments.id, receipts.invoicePaymentId))
      .where(scope)
      .orderBy(asc(receipts.receiptNumber))
      .limit(500);
    return ok(rows.map(toView));
  } catch (error) {
    if (isMissingRelationError(error)) return ok([]);
    throw error;
  }
}

export interface ReceiptDetail extends ReceiptView {
  readonly organizationName: string;
  /** The outside reference the payer or VisaStack staff gave (a transfer id). Never personal data. */
  readonly reference: string;
  readonly invoicedAmountMinorUnits: number;
}

/**
 * One receipt, looked up inside the named agency only: another agency's receipt looks exactly like
 * a missing one. Same readers as `listReceipts`.
 */
export async function getReceipt(
  db: Db,
  input: ReceiptReader & { readonly receiptId: string },
): Promise<Result<ReceiptDetail, ServiceError>> {
  if ((await invoiceLedgerReader(db, input)) === null) {
    return err(serviceError('forbidden', NOT_ALLOWED));
  }
  try {
    const receipts = schema.paymentReceipts;
    const row = first(
      await db
        .select({
          ...viewColumns(),
          reference: schema.invoicePayments.reference,
          organizationName: schema.organizations.name,
          invoicedAmountMinorUnits: schema.invoices.invoicedAmountMinorUnits,
        })
        .from(receipts)
        .innerJoin(schema.invoices, eq(schema.invoices.id, receipts.invoiceId))
        .innerJoin(schema.invoicePayments, eq(schema.invoicePayments.id, receipts.invoicePaymentId))
        .innerJoin(schema.organizations, eq(schema.organizations.id, receipts.organizationId))
        .where(
          and(eq(receipts.id, input.receiptId), eq(receipts.organizationId, input.organizationId)),
        )
        .limit(1),
    );
    if (!row) return err(serviceError('not_found', 'receipt not found'));
    return ok({ ...toView(row), ...row });
  } catch (error) {
    if (isMissingRelationError(error)) return err(serviceError('not_found', 'receipt not found'));
    throw error;
  }
}
