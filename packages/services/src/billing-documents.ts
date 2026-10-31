import {
  type Result,
  TEST_PAYMENT_LABEL,
  billingDaysUntil,
  err,
  formatBillingDate,
  formatBillingDateTime,
  formatBillingPeriod,
  formatMoney,
  ok,
  paymentKindWords,
} from '@visastack/core';
import { and, asc, eq } from 'drizzle-orm';
import { invoiceLedgerReader } from './billing';
import { agencyCode } from './billing-standing';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { isUuid, normalizeCurrency, outstandingMinorUnits } from './invoice-ledger';
import { isMissingRelationError } from './missing-relation';
import { type PaymentMode, ledgerModeSql } from './plans-schema';
import { formatReceiptNumber } from './receipts';

/**
 * Downloadable billing documents (S30): one Invoice and one Receipt, each a single A4 page made on
 * demand and never stored.
 *
 * This file reads the facts and turns them into a finished view model: every word, amount and
 * date already written, in the same plain labels the Invoices page uses. Drawing the page is a
 * separate, pure step (`renderBillingDocumentPdf` in @visastack/adapters), so the layout can be
 * tested without a database and the facts without a PDF.
 *
 * Who can read: exactly the readers of the agency's invoices and receipts (`invoiceLedgerReader`):
 * the agency's active owners and admins, or a platform owner. Anyone else, another agency's
 * document and an unknown id all get the same "not found", so a document's existence is never
 * revealed.
 *
 * What a document holds: the agency's name and short code, the address billing notices go to,
 * the plan, amounts, dates, ledger references and receipt numbers. Never a traveller, a case, a
 * document, a staff account or anything secret.
 *
 * A person's own invoice and receipt (ADR 0025, T5) are built here too, from facts that
 * `person-billing-history.ts` reads for the signed-in person only: the same page with the payer
 * shown by reference code and their own address, and never an "Overdue" or "Still Owed", since a
 * traveller never owes money.
 */

export type BillingDocumentKind = 'invoice' | 'receipt';

/** The word stamped on a document, and the colour family it is drawn in. */
export type BillingDocumentTone = 'paid' | 'open' | 'overdue' | 'refunded' | 'cancelled';

export interface BillingDocumentStamp {
  readonly label: string;
  readonly tone: BillingDocumentTone;
}

export interface BillingDocumentFact {
  readonly label: string;
  readonly value: string;
}

export interface BillingDocumentTable {
  readonly heading: string;
  readonly columns: readonly string[];
  /** One row per entry; each row has one text per column. The last column is an amount. */
  readonly rows: readonly (readonly string[])[];
}

export interface BillingDocumentTotal {
  readonly label: string;
  readonly value: string;
  /** The line the reader looks for first (Still Owed, Amount Received). */
  readonly strong?: boolean;
}

/** Everything a billing document shows, already in words. */
export interface BillingDocument {
  readonly kind: BillingDocumentKind;
  /** "Invoice" or "Receipt". */
  readonly title: string;
  /** The invoice reference or the receipt number, as people quote it. */
  readonly number: string;
  /** A safe download name: VisaStack-Invoice-INV-7D3F9A2C-20261101.pdf */
  readonly fileName: string;
  readonly stamp: BillingDocumentStamp;
  /** Number, dates and period, top right. */
  readonly facts: readonly BillingDocumentFact[];
  readonly billedTo: { readonly name: string; readonly lines: readonly string[] };
  readonly items: BillingDocumentTable;
  readonly totals: readonly BillingDocumentTotal[];
  /** Payments received, then refunds; empty sections are left out. */
  readonly sections: readonly BillingDocumentTable[];
  /** One or two plain sentences under the totals. */
  readonly notes: readonly string[];
  /** When the document was made, for its own record ("Made on 30 Oct 2026, 14:05"). */
  readonly generatedAt: string;
}

/** Who is asking: the same readers as the agency's invoices and receipts. */
export interface BillingDocumentReader {
  readonly actorAccountId: string;
  readonly organizationId: string;
  readonly actorEmail?: string;
  readonly bootstrapEmails?: readonly string[];
  /** The moment the document is made; the database clock is not needed for a printout. */
  readonly now?: Date;
}

const NOT_FOUND = 'document not found';

/**
 * A download name built only from safe characters: the kind, then the reference with anything
 * other than letters, digits and hyphens turned into hyphens, at most 80 characters.
 */
export function billingDocumentFileName(kind: BillingDocumentKind, reference: string): string {
  const safe =
    reference
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^A-Za-z0-9-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'Document';
  return `VisaStack-${kind === 'invoice' ? 'Invoice' : 'Receipt'}-${safe}.pdf`;
}

// --- Facts ----------------------------------------------------------------------------------

/** One ledger row of an invoice, as the document needs it. */
export interface InvoiceDocumentPayment {
  readonly kind: 'ONLINE' | 'MANUAL_CLAIM' | 'ADMIN_RECORDED' | 'CREDIT' | 'REFUND';
  /** Positive for money in, negative for a refund (as the ledger stores it). */
  readonly amountMinorUnits: number;
  readonly collectedDate: Date;
  readonly reference: string;
  /** The receipt issued for this payment, when one was. */
  readonly receiptNumber: number | null;
  /** S29: TEST for a payment made in the gateway's test mode; absent or LIVE for real money. */
  readonly mode?: PaymentMode;
}

/** What an invoice document is made from. Plain data, so the wording can be tested alone. */
export interface InvoiceDocumentFacts {
  readonly invoiceRef: string;
  readonly status: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
  readonly currency: string;
  readonly invoicedAmountMinorUnits: number;
  readonly collectedAmountMinorUnits: number;
  readonly issuedAt: Date;
  readonly dueDate: Date;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly planName: string;
  readonly organizationId: string;
  readonly organizationName: string;
  /** The address billing notices go to first (the earliest active owner), if there is one. */
  readonly billingEmail: string | null;
  readonly payments: readonly InvoiceDocumentPayment[];
}

/** What a receipt document is made from. */
export interface ReceiptDocumentFacts {
  readonly receiptNumber: number;
  readonly kind: InvoiceDocumentPayment['kind'];
  /** S29: TEST for a payment made in the gateway's test mode. */
  readonly mode?: PaymentMode;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly collectedDate: Date;
  readonly issuedAt: Date;
  readonly reference: string;
  readonly invoiceRef: string;
  readonly invoicedAmountMinorUnits: number;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly planName: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly billingEmail: string | null;
}

function paymentKindLabel(kind: string, mode?: PaymentMode): string {
  return paymentKindWords(kind, mode);
}

function billedTo(facts: {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly billingEmail: string | null;
}): BillingDocument['billedTo'] {
  return {
    name: facts.organizationName,
    lines: [
      `Agency Code ${agencyCode(facts.organizationId)}`,
      ...(facts.billingEmail ? [facts.billingEmail] : []),
    ],
  };
}

/** The stamp of an invoice, from the same facts as its state on the Invoices page. */
export function invoiceDocumentStamp(
  facts: Pick<
    InvoiceDocumentFacts,
    'status' | 'collectedAmountMinorUnits' | 'dueDate' | 'payments' | 'invoicedAmountMinorUnits'
  >,
  now: Date,
): BillingDocumentStamp {
  if (facts.status === 'VOID') return { label: 'Cancelled', tone: 'cancelled' };
  const refunded = facts.payments.some((p) => p.kind === 'REFUND');
  if (refunded) {
    return facts.collectedAmountMinorUnits > 0
      ? { label: 'Partly Refunded', tone: 'refunded' }
      : { label: 'Refunded', tone: 'refunded' };
  }
  if (facts.status === 'PAID') return { label: 'Paid', tone: 'paid' };
  // Overdue from the Bangladesh day after the due date, as everywhere in billing.
  if (billingDaysUntil(facts.dueDate, now) < 0) return { label: 'Overdue', tone: 'overdue' };
  if (facts.status === 'PARTIALLY_PAID') return { label: 'Partly Paid', tone: 'open' };
  return { label: 'Open', tone: 'open' };
}

/** Payments received, then refunds, as document tables; an empty one is left out. */
function ledgerSections(
  received: readonly InvoiceDocumentPayment[],
  refunds: readonly InvoiceDocumentPayment[],
  money: (minor: number) => string,
): BillingDocumentTable[] {
  const sections: BillingDocumentTable[] = [];
  if (received.length > 0) {
    sections.push({
      heading: 'Payments Received',
      columns: ['Date', 'How It Was Paid', 'Payment Reference', 'Receipt', 'Amount'],
      rows: received.map((p) => [
        formatBillingDate(p.collectedDate),
        paymentKindLabel(p.kind, p.mode),
        p.reference,
        p.receiptNumber === null ? '' : formatReceiptNumber(p.receiptNumber),
        money(p.amountMinorUnits),
      ]),
    });
  }
  if (refunds.length > 0) {
    sections.push({
      heading: 'Refunds',
      columns: ['Date', 'Refund Reference', 'Amount'],
      rows: refunds.map((p) => [
        formatBillingDate(p.collectedDate),
        p.reference,
        money(Math.abs(p.amountMinorUnits)),
      ]),
    });
  }
  return sections;
}

/** The invoice document, in words. Pure: the same facts and moment always give the same document. */
export function buildInvoiceDocument(facts: InvoiceDocumentFacts, now: Date): BillingDocument {
  const money = (minor: number) => formatMoney(minor, facts.currency);
  const stamp = invoiceDocumentStamp(facts, now);
  const refunds = facts.payments.filter((p) => p.kind === 'REFUND');
  const received = facts.payments.filter((p) => p.kind !== 'REFUND');
  const refundedMinorUnits = refunds.reduce((sum, p) => sum + Math.abs(p.amountMinorUnits), 0);
  const wasRefunded = refundedMinorUnits > 0;
  // A refunded invoice is never owed again (ADR 0020, S18 amendment D2).
  const owed =
    wasRefunded || facts.status === 'VOID'
      ? 0
      : outstandingMinorUnits(facts.invoicedAmountMinorUnits, facts.collectedAmountMinorUnits);

  const totals: BillingDocumentTotal[] = [
    { label: 'Invoiced', value: money(facts.invoicedAmountMinorUnits) },
    {
      label: wasRefunded ? 'Kept After Refunds' : 'Paid So Far',
      value: money(facts.collectedAmountMinorUnits),
    },
    ...(wasRefunded ? [{ label: 'Refunded', value: money(refundedMinorUnits) }] : []),
    { label: 'Still Owed', value: money(owed), strong: true },
  ];

  const sections = ledgerSections(received, refunds, money);

  const notes: string[] = [];
  if (facts.status === 'VOID') notes.push('This invoice was cancelled. There is nothing to pay.');
  else if (wasRefunded) {
    notes.push(
      facts.collectedAmountMinorUnits > 0
        ? 'Part of the money paid on this invoice was refunded. There is nothing more to pay on it.'
        : 'The money paid on this invoice was refunded. There is nothing to pay.',
    );
  } else if (owed === 0) notes.push('This invoice is paid in full. Thank you.');
  else if (stamp.tone === 'overdue') {
    notes.push(
      `This invoice was due on ${formatBillingDate(facts.dueDate)}. Pay ${money(owed)} from Invoices in your VisaStack workspace, online or another way.`,
    );
  } else {
    notes.push(
      `Pay ${money(owed)} by ${formatBillingDate(facts.dueDate)} from Invoices in your VisaStack workspace, online or another way.`,
    );
  }
  if (received.some((p) => p.kind === 'CREDIT')) {
    notes.push('A credit is money from an earlier payment that was counted towards this invoice.');
  }

  return {
    kind: 'invoice',
    title: 'Invoice',
    number: facts.invoiceRef,
    fileName: billingDocumentFileName('invoice', facts.invoiceRef),
    stamp,
    facts: [
      { label: 'Invoice Number', value: facts.invoiceRef },
      { label: 'Issue Date', value: formatBillingDate(facts.issuedAt) },
      ...(facts.status === 'VOID' || wasRefunded
        ? []
        : [{ label: 'Due Date', value: formatBillingDate(facts.dueDate) }]),
      { label: 'Period', value: formatBillingPeriod(facts.periodStart, facts.periodEnd) },
    ],
    billedTo: billedTo(facts),
    items: {
      heading: 'Plan',
      columns: ['Description', 'Period', 'Amount'],
      rows: [
        [
          facts.planName,
          formatBillingPeriod(facts.periodStart, facts.periodEnd),
          money(facts.invoicedAmountMinorUnits),
        ],
      ],
    },
    totals,
    sections,
    notes,
    generatedAt: formatBillingDateTime(now),
  };
}

/** The receipt document, in words. Pure. */
export function buildReceiptDocument(facts: ReceiptDocumentFacts, now: Date): BillingDocument {
  return receiptDocument(facts, billedTo(facts), now);
}

/** What any receipt shows apart from who paid. */
type ReceiptDocumentCore = Omit<
  ReceiptDocumentFacts,
  'organizationId' | 'organizationName' | 'billingEmail'
>;

function receiptDocument(
  facts: ReceiptDocumentCore,
  payer: BillingDocument['billedTo'],
  now: Date,
): BillingDocument {
  const money = (minor: number) => formatMoney(minor, facts.currency);
  const number = formatReceiptNumber(facts.receiptNumber);
  return {
    kind: 'receipt',
    title: 'Receipt',
    number,
    fileName: billingDocumentFileName('receipt', number),
    stamp: { label: 'Paid', tone: 'paid' },
    facts: [
      { label: 'Receipt Number', value: number },
      { label: 'Receipt Issued', value: formatBillingDate(facts.issuedAt) },
      { label: 'Payment Date', value: formatBillingDate(facts.collectedDate) },
      { label: 'Invoice', value: facts.invoiceRef },
      ...(facts.mode === 'TEST'
        ? [{ label: 'Payment Type', value: `${TEST_PAYMENT_LABEL}, not money received` }]
        : []),
    ],
    billedTo: payer,
    items: {
      heading: 'Payment',
      columns: ['How It Was Paid', 'Payment Reference', 'Amount'],
      rows: [
        [paymentKindLabel(facts.kind, facts.mode), facts.reference, money(facts.amountMinorUnits)],
      ],
    },
    totals: [
      { label: 'Invoice Amount', value: money(facts.invoicedAmountMinorUnits) },
      { label: 'Amount Received', value: money(facts.amountMinorUnits), strong: true },
    ],
    sections: [
      {
        heading: 'For Invoice',
        columns: ['Invoice', 'Plan', 'Period'],
        rows: [
          [
            facts.invoiceRef,
            facts.planName,
            formatBillingPeriod(facts.periodStart, facts.periodEnd),
          ],
        ],
      },
    ],
    notes: [
      'This receipt shows that a payment was recorded against the invoice named above. It is not a tax document.',
    ],
    generatedAt: formatBillingDateTime(now),
  };
}

// --- A person's own documents (ADR 0025, T5) --------------------------------------------------

/**
 * Who paid, on a person's own invoice or receipt. The stored rows name the payer only by account
 * (D14); the address is read when the document is made (ADR 0025 section 7) and is the one the
 * person signs in with. Nothing else about them is shown.
 */
export interface PersonPayer {
  /** The short code their invoices carry (the first 8 hex of the account id, upper case). */
  readonly referenceCode: string;
  /** Their sign-in address now, or null when the account no longer exists. */
  readonly email: string | null;
}

/** What a person's own invoice document is made from. */
export interface PersonInvoiceDocumentFacts {
  readonly invoiceRef: string;
  readonly status: InvoiceDocumentFacts['status'];
  readonly currency: string;
  readonly invoicedAmountMinorUnits: number;
  readonly collectedAmountMinorUnits: number;
  readonly issuedAt: Date;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly planName: string;
  /** When the invoice was paid in full, if it was. */
  readonly paidAt: Date | null;
  readonly payer: PersonPayer;
  readonly payments: readonly InvoiceDocumentPayment[];
}

/** What a person's own receipt document is made from. */
export type PersonReceiptDocumentFacts = ReceiptDocumentCore & { readonly payer: PersonPayer };

function personBilledTo(payer: PersonPayer): BillingDocument['billedTo'] {
  return {
    name: payer.email ?? 'Deleted Account',
    lines: [`Reference Code ${payer.referenceCode}`],
  };
}

/**
 * The stamp of a person's own invoice. A traveller never owes money (ADR 0025 D4), so an unpaid
 * invoice is never "Overdue": it waits for a payment they may or may not make. The Billing
 * History page shows the same word.
 */
export function personInvoiceDocumentStamp(facts: {
  readonly status: InvoiceDocumentFacts['status'];
  readonly collectedAmountMinorUnits: number;
  readonly refunded: boolean;
}): BillingDocumentStamp {
  if (facts.status === 'VOID') return { label: 'Cancelled', tone: 'cancelled' };
  if (facts.refunded) {
    return facts.collectedAmountMinorUnits > 0
      ? { label: 'Partly Refunded', tone: 'refunded' }
      : { label: 'Refunded', tone: 'refunded' };
  }
  if (facts.status === 'PAID') return { label: 'Paid', tone: 'paid' };
  return { label: 'Waiting for Payment', tone: 'open' };
}

/** A person's own invoice document, in words. Pure. */
export function buildPersonInvoiceDocument(
  facts: PersonInvoiceDocumentFacts,
  now: Date,
): BillingDocument {
  const money = (minor: number) => formatMoney(minor, facts.currency);
  const refunds = facts.payments.filter((p) => p.kind === 'REFUND');
  const received = facts.payments.filter((p) => p.kind !== 'REFUND');
  const refundedMinorUnits = refunds.reduce((sum, p) => sum + Math.abs(p.amountMinorUnits), 0);
  const wasRefunded = refundedMinorUnits > 0;
  const stamp = personInvoiceDocumentStamp({ ...facts, refunded: wasRefunded });

  const notes: string[] = [];
  if (facts.status === 'VOID') notes.push('This invoice was cancelled. There is nothing to pay.');
  else if (wasRefunded) {
    notes.push(
      facts.collectedAmountMinorUnits > 0
        ? 'Part of the money paid on this invoice was refunded. There is nothing more to pay on it.'
        : 'The money paid on this invoice was refunded. There is nothing to pay.',
    );
  } else if (facts.status === 'PAID') notes.push('This invoice is paid in full. Thank you.');
  else {
    notes.push(
      'This invoice is not paid yet, and you owe nothing. The plan covers you only once it is paid online, from Plan & Usage in VisaStack.',
    );
  }

  return {
    kind: 'invoice',
    title: 'Invoice',
    number: facts.invoiceRef,
    fileName: billingDocumentFileName('invoice', facts.invoiceRef),
    stamp,
    facts: [
      { label: 'Invoice Number', value: facts.invoiceRef },
      { label: 'Issue Date', value: formatBillingDate(facts.issuedAt) },
      ...(facts.paidAt && facts.status === 'PAID'
        ? [{ label: 'Paid On', value: formatBillingDate(facts.paidAt) }]
        : []),
      { label: 'Period', value: formatBillingPeriod(facts.periodStart, facts.periodEnd) },
    ],
    billedTo: personBilledTo(facts.payer),
    items: {
      heading: 'Plan',
      columns: ['Description', 'Period', 'Amount'],
      rows: [
        [
          facts.planName,
          formatBillingPeriod(facts.periodStart, facts.periodEnd),
          money(facts.invoicedAmountMinorUnits),
        ],
      ],
    },
    totals: [
      { label: 'Plan Price', value: money(facts.invoicedAmountMinorUnits) },
      ...(wasRefunded ? [{ label: 'Refunded', value: money(refundedMinorUnits) }] : []),
      {
        label: wasRefunded ? 'Kept After Refunds' : 'Paid',
        value: money(facts.collectedAmountMinorUnits),
        strong: true,
      },
    ],
    sections: ledgerSections(received, refunds, money),
    notes,
    generatedAt: formatBillingDateTime(now),
  };
}

/** A person's own receipt document, in words: an agency's receipt apart from who paid. Pure. */
export function buildPersonReceiptDocument(
  facts: PersonReceiptDocumentFacts,
  now: Date,
): BillingDocument {
  return receiptDocument(facts, personBilledTo(facts.payer), now);
}

// --- Reading ----------------------------------------------------------------------------------

/** The address billing notices go to first: the agency's earliest active owner. */
async function billingEmailFor(db: Db, organizationId: string): Promise<string | null> {
  const m = schema.memberships;
  const row = first(
    await db
      .select({ email: schema.accounts.email })
      .from(m)
      .innerJoin(schema.accounts, eq(schema.accounts.id, m.accountId))
      .where(and(eq(m.organizationId, organizationId), eq(m.role, 'OWNER'), eq(m.active, true)))
      .orderBy(asc(m.createdAt), asc(m.id))
      .limit(1),
  );
  return row?.email ?? null;
}

async function ledgerRows(db: Db, invoiceId: string): Promise<InvoiceDocumentPayment[]> {
  const p = schema.invoicePayments;
  try {
    const rows = await db
      .select({
        id: p.id,
        kind: p.kind,
        mode: await ledgerModeSql(db),
        amountMinorUnits: p.amountMinorUnits,
        collectedDate: p.collectedDate,
        reference: p.reference,
      })
      .from(p)
      .where(eq(p.invoiceId, invoiceId))
      .orderBy(asc(p.collectedDate), asc(p.seq));
    const numbers = new Map<string, number>();
    try {
      const r = schema.paymentReceipts;
      for (const receipt of await db
        .select({ paymentId: r.invoicePaymentId, number: r.receiptNumber })
        .from(r)
        .where(eq(r.invoiceId, invoiceId))) {
        numbers.set(receipt.paymentId, receipt.number);
      }
    } catch (error) {
      if (!isMissingRelationError(error)) throw error;
    }
    return rows.map((row) => ({
      kind: row.kind,
      mode: row.mode,
      amountMinorUnits: row.amountMinorUnits,
      collectedDate: row.collectedDate,
      reference: row.reference,
      receiptNumber: numbers.get(row.id) ?? null,
    }));
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

/**
 * The invoice document for one invoice of the named agency, for its owners and admins or a
 * platform owner. Anything not visible to the reader is "not found".
 */
export async function getInvoiceDocument(
  db: Db,
  input: BillingDocumentReader & { readonly invoiceId: string },
): Promise<Result<BillingDocument, ServiceError>> {
  if (!isUuid(input.invoiceId) || !isUuid(input.organizationId)) {
    return err(serviceError('not_found', NOT_FOUND));
  }
  if ((await invoiceLedgerReader(db, input)) === null) {
    return err(serviceError('not_found', NOT_FOUND));
  }
  const i = schema.invoices;
  const row = first(
    await db
      .select({
        invoiceRef: i.invoiceRef,
        status: i.status,
        currency: i.currency,
        invoicedAmountMinorUnits: i.invoicedAmountMinorUnits,
        collectedAmountMinorUnits: i.collectedAmountMinorUnits,
        issuedAt: i.createdAt,
        dueDate: i.dueDate,
        periodStart: i.periodStart,
        periodEnd: i.periodEnd,
        planName: schema.plans.name,
        organizationName: schema.organizations.name,
      })
      .from(i)
      .innerJoin(schema.plans, eq(schema.plans.id, i.planId))
      .innerJoin(schema.organizations, eq(schema.organizations.id, i.organizationId))
      .where(and(eq(i.id, input.invoiceId), eq(i.organizationId, input.organizationId)))
      .limit(1),
  );
  if (!row) return err(serviceError('not_found', NOT_FOUND));
  const facts: InvoiceDocumentFacts = {
    ...row,
    currency: normalizeCurrency(row.currency),
    organizationId: input.organizationId,
    billingEmail: await billingEmailFor(db, input.organizationId),
    payments: await ledgerRows(db, input.invoiceId),
  };
  return ok(buildInvoiceDocument(facts, input.now ?? new Date()));
}

/**
 * The receipt document for one receipt of the named agency, for the same readers. Anything not
 * visible to the reader, and every receipt before the receipt tables exist, is "not found".
 */
export async function getReceiptDocument(
  db: Db,
  input: BillingDocumentReader & { readonly receiptId: string },
): Promise<Result<BillingDocument, ServiceError>> {
  if (!isUuid(input.receiptId) || !isUuid(input.organizationId)) {
    return err(serviceError('not_found', NOT_FOUND));
  }
  if ((await invoiceLedgerReader(db, input)) === null) {
    return err(serviceError('not_found', NOT_FOUND));
  }
  const r = schema.paymentReceipts;
  const i = schema.invoices;
  const p = schema.invoicePayments;
  let row:
    | {
        receiptNumber: number;
        kind: InvoiceDocumentPayment['kind'];
        mode: PaymentMode;
        amountMinorUnits: number;
        currency: string;
        collectedDate: Date;
        issuedAt: Date;
        reference: string;
        invoiceRef: string;
        invoicedAmountMinorUnits: number;
        periodStart: Date;
        periodEnd: Date;
        planName: string;
        organizationName: string;
      }
    | undefined;
  try {
    row = first(
      await db
        .select({
          receiptNumber: r.receiptNumber,
          kind: p.kind,
          mode: await ledgerModeSql(db),
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
          organizationName: schema.organizations.name,
        })
        .from(r)
        .innerJoin(i, and(eq(i.id, r.invoiceId), eq(i.organizationId, input.organizationId)))
        .innerJoin(p, eq(p.id, r.invoicePaymentId))
        .innerJoin(schema.plans, eq(schema.plans.id, i.planId))
        .innerJoin(schema.organizations, eq(schema.organizations.id, r.organizationId))
        .where(and(eq(r.id, input.receiptId), eq(r.organizationId, input.organizationId)))
        .limit(1),
    );
  } catch (error) {
    if (isMissingRelationError(error)) return err(serviceError('not_found', NOT_FOUND));
    throw error;
  }
  if (!row) return err(serviceError('not_found', NOT_FOUND));
  return ok(
    buildReceiptDocument(
      {
        ...row,
        currency: normalizeCurrency(row.currency),
        organizationId: input.organizationId,
        billingEmail: await billingEmailFor(db, input.organizationId),
      },
      input.now ?? new Date(),
    ),
  );
}
