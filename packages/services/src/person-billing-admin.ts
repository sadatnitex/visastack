import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { type StaffScope, staffScopeProblem } from './access/principal';
import { personInvoiceDocumentStamp } from './billing-documents';
import { invoiceHasRefundSql } from './billing-standing';
import { type Db, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { personInvoiceInTime, referenceCode } from './person-billing';
import { PERSON_REFUND_WINDOW_DAYS } from './person-billing-history';
import {
  personInvoices,
  personPaymentAttempts,
  personRefundRequests,
  personSubscriptions,
} from './person-billing-tables';
import {
  entryRefundableMinorUnits,
  heldRemainingMinorUnits,
  personRefundGuardPresent,
  refundsPresent,
} from './refunds';
import { coveringPaidPeriod, personBillingPresent } from './traveller-billing';

/**
 * The platform owner's Traveller Billing view (ADR 0025, T6): one traveller's own purchases,
 * payments, receipts, refunds and held payments, found by their reference code (the short code
 * their invoices carry) or a purchase reference, and the list of traveller payments that need a
 * check. Platform owner only (`BILLING_REFUND_MANAGE`). It never returns a name, an email or an
 * account id: people are told apart by a longer reference code, rows by their own ids.
 */

const NOT_ALLOWED = 'Only the platform owner can see traveller billing.';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Rows of each kind shown for one person, newest first. */
const PER_PERSON_LIMIT = 50;
/** People shown for one code (two accounts can share the short code). */
const PEOPLE_LIMIT = 5;
export const TRAVELLER_NEEDS_CHECK_LIMIT = 25;
/** A payment still confirming after this long needs a look. */
const STUCK_AFTER_MS = 30 * 60 * 1000;

function denied(staff: unknown): ServiceError | undefined {
  return staffScopeProblem(staff, 'BILLING_REFUND_MANAGE')
    ? serviceError('forbidden', NOT_ALLOWED)
    : undefined;
}

/** "A1B2C3D4", "a1b2-c3d4", or a purchase reference "TP-A1B2C3D4-3": the hex to look for. */
export function travellerLookup(
  raw: string,
):
  | { readonly kind: 'code'; readonly hex: string }
  | { readonly kind: 'reference'; readonly invoiceRef: string }
  | null {
  const text = raw.trim();
  const reference = text.match(/^TP-([0-9A-F]{8,32})-(\d{1,6})$/i);
  if (reference) return { kind: 'reference', invoiceRef: text.toUpperCase() };
  const hex = text.replace(/[\s-]/g, '').toLowerCase();
  return /^[0-9a-f]{8,32}$/.test(hex) ? { kind: 'code', hex } : null;
}

export interface TravellerInvoiceView {
  readonly id: string;
  readonly invoiceRef: string;
  readonly planName: string;
  readonly amountMinorUnits: number;
  readonly collectedAmountMinorUnits: number;
  readonly currency: string;
  readonly statusLabel: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  /** A renewal (linked to the plan it renews), or a purchase. */
  readonly renewal: boolean;
}

export interface TravellerPaymentView {
  /** The ledger entry's id: what a refund names. */
  readonly id: string;
  readonly invoiceRef: string;
  readonly kind: string;
  readonly mode: 'TEST' | 'LIVE';
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly collectedDate: Date;
  /** What can still go back from it; 0 when it was refunded already. */
  readonly refundableMinorUnits: number;
  /** When the 7 days the person was promised end (D8). Refunds after it are allowed and marked. */
  readonly refundWindowEndsAt: Date;
}

export interface TravellerHeldView {
  /** The held payment's id: what a refund of held money names. */
  readonly id: string;
  readonly invoiceRef: string;
  readonly amountMinorUnits: number;
  readonly remainingMinorUnits: number;
  readonly currency: string;
  readonly reasonCode: string | null;
  readonly since: Date;
  /** The day the money came in, as a refund counts it (the earliest refund day). */
  readonly paidOn: Date;
  /** When the 7 days the person was promised end, counted from that day (D8). */
  readonly refundWindowEndsAt: Date;
}

export interface TravellerRefundView {
  readonly id: string;
  readonly invoiceRef: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly status: string;
  readonly reference: string | null;
  readonly refundedOn: Date | null;
}

export interface TravellerBilling {
  /** The longer reference code that tells this person apart from another with the same short one. */
  readonly code: string;
  readonly shortCode: string;
  readonly plan: {
    readonly planName: string;
    readonly renews: boolean;
    /** The last moment the paid time from now covers, or null when no paid period covers now. */
    readonly paidUntil: Date | null;
  } | null;
  readonly invoices: readonly TravellerInvoiceView[];
  readonly payments: readonly TravellerPaymentView[];
  readonly held: readonly TravellerHeldView[];
  readonly refunds: readonly TravellerRefundView[];
}

export interface TravellerBillingResult {
  /** Whether a refund can be recorded here (migrations 0104, 0110, 0111 and 0112 have run). */
  readonly refundsAvailable: boolean;
  readonly people: readonly TravellerBilling[];
}

/** The people a lookup names, at most a few, each with at least one invoice of their own. */
async function payersFor(
  db: Db,
  lookup: NonNullable<ReturnType<typeof travellerLookup>>,
): Promise<string[]> {
  const i = personInvoices;
  if (lookup.kind === 'reference') {
    const rows = await db
      .select({ payer: i.payerAccountId })
      .from(i)
      .where(and(eq(i.invoiceRef, lookup.invoiceRef), isNull(i.organizationId)))
      .limit(1);
    return rows.flatMap((row) => (row.payer ? [row.payer] : []));
  }
  const rows = await db
    .selectDistinct({ payer: i.payerAccountId })
    .from(i)
    .where(
      and(
        isNull(i.organizationId),
        sql`replace(${i.payerAccountId}::text, '-', '') like ${`${lookup.hex}%`}`,
      ),
    )
    .limit(PEOPLE_LIMIT);
  return rows.flatMap((row) => (row.payer ? [row.payer] : []));
}

async function billingOf(db: Db, payer: string, now: Date): Promise<TravellerBilling> {
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
      refunded: sql<boolean>`${invoiceHasRefundSql(sql`${i.id}`)}`,
    })
    .from(i)
    .innerJoin(schema.plans, eq(schema.plans.id, i.planId))
    .where(eq(i.payerAccountId, payer))
    .orderBy(desc(i.createdAt), desc(i.id))
    .limit(PER_PERSON_LIMIT);
  const refOf = new Map(invoices.map((row) => [row.id, row.invoiceRef]));
  // A renewal follows on from an earlier period of the same plan (every paid purchase is linked
  // to its subscription too, so the link alone does not tell them apart).
  const periodEnds = new Set(
    invoices.map((row) => `${row.subscriptionId}:${row.periodEnd.getTime()}`),
  );
  const ids = invoices.map((row) => row.id);

  const r = personRefundRequests;
  const requests = await db
    .select({
      id: r.id,
      invoiceId: r.invoiceId,
      invoiceRef: i.invoiceRef,
      invoicePaymentId: r.invoicePaymentId,
      paymentAttemptId: r.paymentAttemptId,
      amountMinorUnits: r.amountMinorUnits,
      currency: r.currency,
      status: r.status,
      reference: r.reference,
      providerRefundedAt: r.providerRefundedAt,
      createdAt: r.createdAt,
    })
    .from(r)
    .innerJoin(i, eq(i.id, r.invoiceId))
    .where(eq(r.payerAccountId, payer))
    .orderBy(desc(r.createdAt))
    .limit(PER_PERSON_LIMIT * 2);

  const p = schema.invoicePayments;
  // Read only for invoices already proven to be this person's: the ledger has no payer column.
  const entries =
    ids.length === 0
      ? []
      : await db
          .select({
            id: p.id,
            invoiceId: p.invoiceId,
            kind: p.kind,
            mode: p.mode,
            amountMinorUnits: p.amountMinorUnits,
            currency: p.currency,
            collectedDate: p.collectedDate,
          })
          .from(p)
          .where(inArray(p.invoiceId, ids))
          .orderBy(desc(p.collectedDate));

  const a = personPaymentAttempts;
  const held = await db
    .select({
      id: a.id,
      invoiceId: a.invoiceId,
      amountMinorUnits: a.amountMinorUnits,
      currency: a.currency,
      reasonCode: a.reasonCode,
      createdAt: a.createdAt,
      redirectedAt: a.redirectedAt,
      invoiceRef: i.invoiceRef,
    })
    .from(a)
    .innerJoin(i, eq(i.id, a.invoiceId))
    .where(and(eq(a.payerAccountId, payer), eq(a.status, 'HELD_FOR_REVIEW')))
    .orderBy(desc(a.createdAt))
    .limit(PER_PERSON_LIMIT);

  const s = personSubscriptions;
  const [subscription] = await db
    .select({ planName: schema.plans.name, renews: s.renews })
    .from(s)
    .innerJoin(schema.plans, eq(schema.plans.id, s.planId))
    .where(and(eq(s.payerAccountId, payer), isNull(s.endedAt)))
    .limit(1);
  const covering = await coveringPaidPeriod(db, payer, now, { paidThrough: true });

  const asRequests = (match: (row: (typeof requests)[number]) => boolean) =>
    requests
      .filter(match)
      .map((row) => ({ status: row.status, amountMinorUnits: row.amountMinorUnits }));

  return {
    code: referenceCode(payer, 12),
    shortCode: referenceCode(payer),
    plan: subscription
      ? {
          planName: subscription.planName,
          renews: subscription.renews,
          paidUntil: covering ? new Date(covering.paidThrough.getTime() - 1) : null,
        }
      : null,
    invoices: invoices.map((row) => ({
      id: row.id,
      invoiceRef: row.invoiceRef,
      planName: row.planName,
      amountMinorUnits: row.amountMinorUnits,
      collectedAmountMinorUnits: row.collectedAmountMinorUnits,
      currency: row.currency,
      statusLabel: personInvoiceDocumentStamp({
        status: row.status,
        collectedAmountMinorUnits: row.collectedAmountMinorUnits,
        refunded: row.refunded === true,
        stillPayable: personInvoiceInTime(row, now),
      }).label,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      renewal:
        row.subscriptionId !== null &&
        periodEnds.has(`${row.subscriptionId}:${row.periodStart.getTime()}`),
    })),
    payments: entries
      .filter((entry) => entry.kind !== 'REFUND')
      .map((entry) => ({
        id: entry.id,
        invoiceRef: refOf.get(entry.invoiceId) ?? '',
        kind: entry.kind,
        mode: entry.mode === 'TEST' ? ('TEST' as const) : ('LIVE' as const),
        amountMinorUnits: entry.amountMinorUnits,
        currency: entry.currency,
        collectedDate: entry.collectedDate,
        refundableMinorUnits: entryRefundableMinorUnits(
          entry.amountMinorUnits,
          asRequests((row) => row.invoicePaymentId === entry.id),
        ),
        refundWindowEndsAt: new Date(
          entry.collectedDate.getTime() + PERSON_REFUND_WINDOW_DAYS * DAY_MS,
        ),
      })),
    held: held.map((row) => ({
      id: row.id,
      invoiceRef: row.invoiceRef,
      amountMinorUnits: row.amountMinorUnits,
      remainingMinorUnits: heldRemainingMinorUnits(
        row.amountMinorUnits,
        0,
        asRequests((request) => request.paymentAttemptId === row.id),
      ),
      currency: row.currency,
      reasonCode: row.reasonCode,
      since: row.createdAt,
      // The same day a refund counts from (refunds.ts `paymentDay`).
      paidOn: row.redirectedAt ?? row.createdAt,
      refundWindowEndsAt: new Date(
        (row.redirectedAt ?? row.createdAt).getTime() + PERSON_REFUND_WINDOW_DAYS * DAY_MS,
      ),
    })),
    refunds: requests.map((row) => ({
      id: row.id,
      invoiceRef: row.invoiceRef,
      amountMinorUnits: row.amountMinorUnits,
      currency: row.currency,
      status: row.status,
      reference: row.reference,
      refundedOn: row.providerRefundedAt,
    })),
  };
}

/** One traveller's billing (or a few, when the short code is shared), for the platform owner. */
export async function getTravellerBilling(
  db: Db,
  staff: StaffScope<'BILLING_REFUND_MANAGE'>,
  input: { readonly code: string; readonly now?: Date },
): Promise<Result<TravellerBillingResult, ServiceError>> {
  const forbidden = denied(staff);
  if (forbidden) return err(forbidden);
  const lookup = travellerLookup(input.code);
  if (!lookup) {
    return err(
      serviceError(
        'invalid',
        'Enter a reference code (8 or more letters and digits) or a purchase reference.',
      ),
    );
  }
  if (!(await personBillingPresent(db))) return ok({ refundsAvailable: false, people: [] });
  const now = input.now ?? new Date();
  const payers = await payersFor(db, lookup);
  const people: TravellerBilling[] = [];
  for (const payer of payers) people.push(await billingOf(db, payer, now));
  const refundsAvailable = (await refundsPresent(db)) && (await personRefundGuardPresent(db));
  return ok({ refundsAvailable, people });
}

export interface TravellerNeedsCheckItem {
  readonly kind: 'held' | 'confirming';
  readonly paymentAttemptId: string;
  /** The person's short reference code, to look them up. */
  readonly shortCode: string;
  readonly invoiceRef: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly reasonCode: string | null;
  readonly since: Date;
}

/**
 * Traveller payments that need the owner (newest first, at most 25): money held for a check with
 * something left of it, and payments still confirming after 30 minutes (ADR 0025 12.5).
 */
export async function listTravellerNeedsCheck(
  db: Db,
  staff: StaffScope<'BILLING_REFUND_MANAGE'>,
  input: { readonly now?: Date } = {},
): Promise<Result<readonly TravellerNeedsCheckItem[], ServiceError>> {
  const forbidden = denied(staff);
  if (forbidden) return err(forbidden);
  if (!(await personBillingPresent(db))) return ok([]);
  const now = input.now ?? new Date();
  const a = personPaymentAttempts;
  const i = personInvoices;
  const rows = await db
    .select({
      id: a.id,
      payer: a.payerAccountId,
      status: a.status,
      amountMinorUnits: a.amountMinorUnits,
      currency: a.currency,
      reasonCode: a.reasonCode,
      createdAt: a.createdAt,
      invoiceRef: i.invoiceRef,
      refunded: sql<number>`coalesce((select sum(rr.amount_minor_units) from refund_requests rr where rr.payment_attempt_id = ${a.id} and rr.status in ('REQUESTED', 'SUBMITTED', 'CONFIRMED')), 0)::int`,
    })
    .from(a)
    .innerJoin(i, eq(i.id, a.invoiceId))
    .where(
      and(
        isNull(a.organizationId),
        sql`(${a.status} = 'HELD_FOR_REVIEW' or (${inArray(a.status, ['REDIRECTED', 'VALIDATED'])} and ${lt(a.createdAt, new Date(now.getTime() - STUCK_AFTER_MS))} and ${gt(a.createdAt, new Date(now.getTime() - 7 * DAY_MS))}))`,
      ),
    )
    .orderBy(desc(a.createdAt))
    .limit(TRAVELLER_NEEDS_CHECK_LIMIT * 2);
  return ok(
    rows
      .filter((row) => row.status !== 'HELD_FOR_REVIEW' || row.amountMinorUnits - row.refunded > 0)
      .slice(0, TRAVELLER_NEEDS_CHECK_LIMIT)
      .map((row) => ({
        kind: row.status === 'HELD_FOR_REVIEW' ? ('held' as const) : ('confirming' as const),
        paymentAttemptId: row.id,
        shortCode: row.payer ? referenceCode(row.payer) : '',
        invoiceRef: row.invoiceRef,
        amountMinorUnits: row.amountMinorUnits,
        currency: row.currency,
        reasonCode: row.reasonCode,
        since: row.createdAt,
      })),
  );
}
