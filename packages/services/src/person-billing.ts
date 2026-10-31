import { type Result, billingDaysUntil, err, formatBillingDate, ok } from '@visastack/core';
import { and, desc, eq, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import { type SelfScope, type SystemScope, selfScopeProblem } from './access/principal';
import { appendAuditEvent } from './audit';
import { invoiceHasRefundSql } from './billing-standing';
import { type Db, first, required, schema } from './db';
import { TRAVELLER_PLAN_KEY } from './entitlements';
import { type ServiceError, refusal, serviceError } from './errors';
import { lockPersonBilling } from './invoice-ledger';
import {
  cancelOwnQueuedNotifications,
  cancelQueuedNotificationsForResource,
  enqueueNotificationBothChannels,
} from './notifications';
import type { NewAttemptValues, PaymentAttempt } from './payments';
import {
  personInvoices,
  personPaymentAttempts,
  personSubscriptions,
} from './person-billing-tables';
import { coveringPaidPeriod, personBillingPresent } from './traveller-billing';
import { travellerPlansEnabled } from './traveller-plan';

/**
 * A person's own billing (ADR 0025, T3b): buying a paid traveller plan and paying for it online.
 *
 * - Everything a person starts takes their `SelfScope` and reads and writes only rows whose payer
 *   is that person. Another person's invoice reads as not found.
 * - Selling waits for `TRAVELLER_PLANS_ENABLED` and for migrations 0110 and 0111. Money already
 *   paid keeps its period whatever the switch says: the entitlement resolver reads paid invoices.
 * - Money is recorded only by the one recording function (`applyInvoiceCollection`), as for
 *   agencies; its person steps are private to it. The online payment itself starts with
 *   `startPersonPayment` (payments.ts), through the same opening as an agency's.
 *
 * Checkout takes only this person's billing lock (`lockPersonBilling`), the lock the recording
 * takes after the invoice's.
 */

/** What a traveller sees when buying is off (the switch, or a database not updated yet). */
export const PERSON_SELLING_OFF = 'Paid plans are not on sale yet.';
const NOT_AVAILABLE = 'Paid plans are not available yet. Please try again later.';
export const ALREADY_COVERED =
  'Your paid plan already covers today. You can buy again when it is about to end.';
/** A purchase invoice younger than this is offered again instead of a new one (two tabs). */
const REUSE_OPEN_INVOICE_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** After a paid period ends, a renewal stays payable this long, then the plan lapses (D4). */
export const RENEWAL_GRACE_DAYS = 7;
const RENEWAL_GRACE_MS = RENEWAL_GRACE_DAYS * DAY_MS;

/** The short code a person's invoices and receipts carry instead of a name (ADR 0025 D14). */
export function referenceCode(accountId: string, length = 8): string {
  return accountId.replace(/-/g, '').slice(0, length).toUpperCase();
}

/**
 * The references a person's `number`th invoice may take, shortest first (ADR 0025 D14: a code,
 * never a name). References are unique across every invoice, so a longer code is used when another
 * person holds the short one.
 */
export function personInvoiceRefCandidates(accountId: string, number: number): string[] {
  return [8, 12, 16, 32].map((length) => `TP-${referenceCode(accountId, length)}-${number}`);
}

/**
 * The next free reference for one of this person's invoices: their invoice count plus one, after
 * the short code. References are unique across every invoice; two accounts can share the short
 * code, so a longer one is used when the short one is taken (D14: still never a name or an
 * email). Inside the person's billing lock.
 */
async function nextPersonInvoiceRef(tx: Db, accountId: string): Promise<string> {
  const count = first(
    await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(personInvoices)
      .where(eq(personInvoices.payerAccountId, accountId)),
  );
  for (const candidate of personInvoiceRefCandidates(accountId, (count?.n ?? 0) + 1)) {
    const taken = first(
      await tx
        .select({ id: schema.invoices.id })
        .from(schema.invoices)
        .where(eq(schema.invoices.invoiceRef, candidate))
        .limit(1),
    );
    if (!taken) return candidate;
  }
  throw new Error('no free invoice reference for this person');
}

export interface PersonCheckout {
  readonly invoiceId: string;
  readonly invoiceRef: string;
  readonly planId: string;
  readonly planName: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  /** True when an open purchase made in the last day is offered again (another tab, a retry). */
  readonly reused: boolean;
}

/**
 * Starts buying a paid traveller plan for the signed-in person: one open purchase invoice for
 * [now, now + the plan's period), at the plan's price now, in BDT. Refused when selling is off,
 * the plan is not a priced, offered traveller plan, or a paid period already covers them. Two
 * tabs get the same invoice. Nothing is charged here: payment starts with `startPersonPayment`.
 */
export async function startPersonCheckout(
  db: Db,
  self: SelfScope,
  input: { readonly planId: string; readonly now?: Date },
): Promise<Result<PersonCheckout, ServiceError>> {
  const denied = selfScopeProblem(self);
  if (denied) return err(denied);
  if (!travellerPlansEnabled()) return err(refusal('selling_off', PERSON_SELLING_OFF));
  if (!(await personBillingPresent(db))) return err(serviceError('invalid', NOT_AVAILABLE));
  const now = input.now ?? new Date();
  const accountId = self.accountId;

  return db.transaction(async (tx): Promise<Result<PersonCheckout, ServiceError>> => {
    const plan = first(
      await tx
        .select({
          id: schema.plans.id,
          key: schema.plans.key,
          name: schema.plans.name,
          periodDays: schema.plans.periodDays,
        })
        .from(schema.plans)
        .where(
          and(
            eq(schema.plans.id, input.planId),
            eq(schema.plans.audience, 'TRAVELLER'),
            eq(schema.plans.active, true),
            ne(schema.plans.key, TRAVELLER_PLAN_KEY),
          ),
        )
        .limit(1),
    );
    if (!plan) return err(refusal('plan_not_for_sale', 'This plan is not for sale.'));
    const price = first(
      await tx
        .select({
          amount: schema.planPrices.priceMinorUnits,
          currency: schema.planPrices.currency,
        })
        .from(schema.planPrices)
        .where(
          and(eq(schema.planPrices.planId, plan.id), lte(schema.planPrices.effectiveFrom, now)),
        )
        .orderBy(desc(schema.planPrices.effectiveFrom))
        .limit(1),
    );
    if (!price || price.amount === null || price.amount <= 0 || price.currency !== 'BDT') {
      return err(refusal('plan_not_for_sale', 'This plan is not for sale.'));
    }

    await lockPersonBilling(tx, accountId);
    const person = first(
      await tx
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(eq(schema.accounts.id, accountId))
        .limit(1),
    );
    if (!person) return err(serviceError('not_found', 'account not found'));
    if (await coveringPaidPeriod(tx, accountId, now)) {
      return err(refusal('already_covered', ALREADY_COVERED));
    }

    const i = personInvoices;
    const reusable = first(
      await tx
        .select()
        .from(i)
        .where(
          and(
            eq(i.payerAccountId, accountId),
            eq(i.planId, plan.id),
            eq(i.status, 'OPEN'),
            isNull(i.subscriptionId),
            eq(i.invoicedAmountMinorUnits, price.amount),
            eq(i.currency, price.currency),
            sql`${i.periodStart} > ${new Date(now.getTime() - REUSE_OPEN_INVOICE_MS).toISOString()}::timestamptz`,
            sql`not ${invoiceHasRefundSql(sql`${i.id}`)}`,
          ),
        )
        .orderBy(desc(i.periodStart))
        .limit(1),
    );
    const view = (row: typeof i.$inferSelect, reused: boolean): PersonCheckout => ({
      invoiceId: row.id,
      invoiceRef: row.invoiceRef,
      planId: plan.id,
      planName: plan.name,
      amountMinorUnits: row.invoicedAmountMinorUnits,
      currency: row.currency,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      reused,
    });
    if (reusable) return ok(view(reusable, true));

    const invoiceRef = await nextPersonInvoiceRef(tx, accountId);
    const created = required(
      first(
        await tx
          .insert(i)
          .values({
            organizationId: null,
            payerAccountId: accountId,
            subscriptionId: null,
            planId: plan.id,
            periodStart: now,
            periodEnd: new Date(now.getTime() + plan.periodDays * DAY_MS),
            invoiceRef,
            invoicedAmountMinorUnits: price.amount,
            currency: price.currency,
            dueDate: now,
            status: 'OPEN',
          })
          .returning(),
      ),
      'person invoice',
    );
    await appendAuditEvent(tx, {
      eventType: 'PERSON_PLAN_CHECKOUT_STARTED',
      actorAccountId: accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'invoice',
      resourceId: created.id,
      metadata: {
        planId: plan.id,
        amountMinorUnits: price.amount,
        currency: price.currency,
        periodStart: created.periodStart.toISOString(),
        periodEnd: created.periodEnd.toISOString(),
      },
    });
    return ok(view(created, false));
  });
}

/**
 * Whether a person's invoice is still inside the time it can be paid in. A renewal (T4) is linked
 * to the plan it renews: from when it is made until the grace week after the paid period ends. A
 * purchase, for a day. Billing History says "Not Paid" for one past it.
 */
export function personInvoiceInTime(
  invoice: { readonly subscriptionId: string | null; readonly periodStart: Date },
  now: Date,
): boolean {
  const payableFor = invoice.subscriptionId !== null ? RENEWAL_GRACE_MS : REUSE_OPEN_INVOICE_MS;
  return invoice.periodStart.getTime() > now.getTime() - payableFor;
}

/** Said when a purchase is too old to pay: its period would already be partly over. */
export const PURCHASE_EXPIRED = 'This purchase has expired. Start it again on Plan & Usage.';

/** Said when a purchase was refunded: it is never owed again, so a new one is needed (T6). */
export const PURCHASE_REFUNDED = 'This purchase was refunded. Start a new one on Plan & Usage.';

/**
 * The signed-in person's own purchase invoice, if it can be paid online now: another person's
 * invoice reads as not found; a purchase made more than a day ago, for a plan no longer offered, or
 * for time a paid period already covers is refused before any payment page opens (the recording
 * holds such money too, as a second line). The amount stays the one agreed at checkout.
 */
export async function payablePersonInvoice(
  db: Db,
  self: SelfScope,
  input: { readonly invoiceId: string; readonly now: Date },
): Promise<Result<{ readonly id: string; readonly currency: string }, ServiceError>> {
  const denied = selfScopeProblem(self);
  if (denied) return err(denied);
  const i = personInvoices;
  const invoice = first(
    await db
      .select({
        id: i.id,
        currency: i.currency,
        planId: i.planId,
        subscriptionId: i.subscriptionId,
        periodStart: i.periodStart,
        periodEnd: i.periodEnd,
      })
      .from(i)
      .where(and(eq(i.id, input.invoiceId), eq(i.payerAccountId, self.accountId)))
      .limit(1),
  );
  if (!invoice) return err(serviceError('not_found', 'invoice not found'));
  // A refunded invoice goes back to open with nothing collected, but it is never owed again (D2):
  // money paid on it would only be held, so it is refused before any payment page opens (T6).
  const refunded = first(
    await db
      .select({ refunded: sql<boolean>`${invoiceHasRefundSql(sql`${i.id}`)}` })
      .from(i)
      .where(eq(i.id, invoice.id))
      .limit(1),
  );
  if (refunded?.refunded === true) return err(refusal('purchase_refunded', PURCHASE_REFUNDED));
  const renewal = invoice.subscriptionId !== null;
  if (!personInvoiceInTime(invoice, input.now)) {
    return err(refusal('purchase_expired', PURCHASE_EXPIRED));
  }
  if (invoice.subscriptionId !== null) {
    const current = first(
      await db
        .select({ id: personSubscriptions.id })
        .from(personSubscriptions)
        .where(
          and(
            eq(personSubscriptions.id, invoice.subscriptionId),
            eq(personSubscriptions.payerAccountId, self.accountId),
            isNull(personSubscriptions.endedAt),
          ),
        )
        .limit(1),
    );
    if (!current) return err(refusal('purchase_expired', PURCHASE_EXPIRED));
  }
  const offered = first(
    await db
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(
        and(
          eq(schema.plans.id, invoice.planId),
          eq(schema.plans.active, true),
          ne(schema.plans.key, TRAVELLER_PLAN_KEY),
        ),
      )
      .limit(1),
  );
  if (!offered) return err(refusal('plan_not_for_sale', 'This plan is not for sale.'));
  const covering = await coveringPaidPeriod(db, self.accountId, input.now);
  // The period a renewal follows covers them until it starts; anything else covering them now
  // means this would pay twice for the same days.
  const renewsCovering =
    renewal &&
    covering !== undefined &&
    covering.planId === invoice.planId &&
    covering.periodEnd.getTime() <= invoice.periodStart.getTime();
  if (covering && !renewsCovering) {
    return err(refusal('already_covered', ALREADY_COVERED));
  }
  const overlapping = first(
    await db
      .select({ id: i.id })
      .from(i)
      .where(
        and(
          eq(i.payerAccountId, self.accountId),
          ne(i.id, invoice.id),
          eq(i.status, 'PAID'),
          sql`${i.periodStart} < ${invoice.periodEnd.toISOString()}::timestamptz`,
          sql`${i.periodEnd} > ${invoice.periodStart.toISOString()}::timestamptz`,
          sql`not ${invoiceHasRefundSql(sql`${i.id}`)}`,
        ),
      )
      .limit(1),
  );
  if (overlapping) return err(refusal('already_covered', ALREADY_COVERED));
  return ok({ id: invoice.id, currency: invoice.currency });
}

/** The person's own purchase waiting to be paid, as the confirmation card on Plan & Usage shows it. */
export interface PersonPurchase {
  readonly invoiceId: string;
  readonly invoiceRef: string;
  readonly planName: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  /** When the period starts: the moment of checkout (a purchase is reused for a day). */
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

/**
 * The signed-in person's own purchase `invoiceId`, if it can still be paid now (the same rules as
 * `payablePersonInvoice`, and still open): what the confirmation card shows before the payment
 * page. Another person's invoice, a paid or old one, reads as nothing.
 */
export async function getOwnPurchase(
  db: Db,
  self: SelfScope,
  input: { readonly invoiceId: string; readonly now?: Date },
): Promise<PersonPurchase | null> {
  if (selfScopeProblem(self)) return null;
  // Before migrations 0110 and 0111 there is no purchase to show.
  if (!(await personBillingPresent(db))) return null;
  const now = input.now ?? new Date();
  const payable = await payablePersonInvoice(db, self, { invoiceId: input.invoiceId, now });
  if (!payable.ok) return null;
  const i = personInvoices;
  const row = first(
    await db
      .select({
        invoiceId: i.id,
        invoiceRef: i.invoiceRef,
        status: i.status,
        planName: schema.plans.name,
        amountMinorUnits: i.invoicedAmountMinorUnits,
        currency: i.currency,
        periodStart: i.periodStart,
        periodEnd: i.periodEnd,
      })
      .from(i)
      .innerJoin(schema.plans, eq(schema.plans.id, i.planId))
      .where(and(eq(i.id, payable.value.id), eq(i.payerAccountId, self.accountId)))
      .limit(1),
  );
  if (!row || row.status !== 'OPEN') return null;
  return {
    invoiceId: row.invoiceId,
    invoiceRef: row.invoiceRef,
    planName: row.planName,
    amountMinorUnits: row.amountMinorUnits,
    currency: row.currency,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
  };
}

/**
 * Writes a payment attempt paid by the signed-in person, for `startPersonPayment`. The row is read
 * back as an agency attempt reads (the same columns, with no organization).
 */
export function personAttemptWriter(
  self: SelfScope,
): (tx: Db, values: NewAttemptValues) => Promise<PaymentAttempt> {
  // A programmer fault: callers check the scope first (startPersonPayment does).
  if (selfScopeProblem(self)) throw new Error('personAttemptWriter needs a genuine, fresh scope');
  const accountId = self.accountId;
  return async (tx, values) =>
    required(
      first(
        await tx
          .insert(personPaymentAttempts)
          .values({ ...values, organizationId: null, payerAccountId: accountId })
          .returning(),
      ),
      'payment attempt',
    ) as unknown as PaymentAttempt;
}

// --- Renewing a paid plan (ADR 0025 T4, D4) ------------------------------------------------------
//
// A paid plan is renewed by paying a link, never charged by itself. Lock order everywhere here is
// the recording's: the person's open renewal invoices first (row locks), then their billing lock.

/** A renewal is made, and reminders start, 7 calendar days before the last paid day (D4). */
export const RENEWAL_NOTICE_DAYS = 7;
/** A higher price reaches a renewal only when it was set at least this long before it starts. */
const PRICE_NOTICE_MS = 30 * DAY_MS;
const PLAN_PATH = '/app/account/plan';

/** Payment attempts still on their way: a renewal being paid now is never cancelled under it. */
export const IN_FLIGHT_ATTEMPTS = ['CREATED', 'REDIRECTED', 'VALIDATED'] as const;

type RenewalStage = 'd7' | 'd3' | 'd0';

/**
 * The reminder stage a paid period ending `end` (exclusive) has reached at `now`, counted in
 * Bangladesh calendar days to its last covered day, as agency reminders are (S30): 7 to 4 days
 * before, 3 to 1 days before, then the last day itself and the grace week after it.
 */
function renewalStage(end: Date, now: Date): RenewalStage | null {
  if (now.getTime() >= end.getTime()) return 'd0';
  const days = billingDaysUntil(new Date(end.getTime() - 1), now);
  if (days > RENEWAL_NOTICE_DAYS) return null;
  if (days >= 4) return 'd7';
  if (days >= 1) return 'd3';
  return 'd0';
}

interface RenewalState {
  readonly subscriptionId: string;
  readonly planId: string;
  readonly planName: string;
  readonly periodDays: number;
  readonly renews: boolean;
  /** The plan is still offered and priced in BDT now, so it can be renewed. */
  readonly renewable: boolean;
  /** The end (exclusive) of the last paid, unrefunded period, and what was paid for it. */
  readonly paidUntil: Date;
  readonly lastAmount: number;
  readonly lastCurrency: string;
  /** The renewal for the period after it, unless cancelled or refunded. */
  readonly renewal: {
    readonly id: string;
    readonly status: string;
    readonly amountMinorUnits: number;
    readonly currency: string;
  } | null;
}

/** The person's current paid traveller plan, its last paid period and its renewal, or null. */
async function renewalState(db: Db, accountId: string, now: Date): Promise<RenewalState | null> {
  const s = personSubscriptions;
  const i = personInvoices;
  const p = schema.plans;
  const current = first(
    await db
      .select({
        id: s.id,
        planId: s.planId,
        renews: s.renews,
        planName: p.name,
        planKey: p.key,
        active: p.active,
        periodDays: p.periodDays,
      })
      .from(s)
      .innerJoin(p, and(eq(p.id, s.planId), eq(p.audience, 'TRAVELLER')))
      .where(and(eq(s.payerAccountId, accountId), isNull(s.endedAt)))
      .limit(1),
  );
  if (!current) return null;
  const unrefunded = sql`not ${invoiceHasRefundSql(sql`${i.id}`)}`;
  const last = first(
    await db
      .select({ periodEnd: i.periodEnd, amount: i.invoicedAmountMinorUnits, currency: i.currency })
      .from(i)
      .where(
        and(
          eq(i.subscriptionId, current.id),
          eq(i.payerAccountId, accountId),
          eq(i.status, 'PAID'),
          unrefunded,
        ),
      )
      .orderBy(desc(i.periodEnd))
      .limit(1),
  );
  if (!last) return null;
  const renewal = first(
    await db
      .select({
        id: i.id,
        status: i.status,
        amountMinorUnits: i.invoicedAmountMinorUnits,
        currency: i.currency,
      })
      .from(i)
      .where(
        and(
          eq(i.subscriptionId, current.id),
          eq(i.payerAccountId, accountId),
          eq(i.periodStart, last.periodEnd),
          ne(i.status, 'VOID'),
          unrefunded,
        ),
      )
      .limit(1),
  );
  const price = await priceAt(db, current.planId, now);
  return {
    subscriptionId: current.id,
    planId: current.planId,
    planName: current.planName,
    periodDays: current.periodDays,
    renews: current.renews,
    renewable: current.active && current.planKey !== TRAVELLER_PLAN_KEY && forSale(price) !== null,
    paidUntil: last.periodEnd,
    lastAmount: last.amount,
    lastCurrency: last.currency,
    renewal: renewal ?? null,
  };
}

type PriceRow = { readonly amount: number | null; readonly currency: string | null } | undefined;

/** A price a plan can be sold at: priced, above zero, in BDT. */
function forSale(price: PriceRow): number | null {
  return price && price.amount !== null && price.amount > 0 && price.currency === 'BDT'
    ? price.amount
    : null;
}

/** The plan's price in force at `at`; with `setBefore`, only one set by then. */
async function priceAt(db: Db, planId: string, at: Date, setBefore?: Date): Promise<PriceRow> {
  const pp = schema.planPrices;
  return first(
    await db
      .select({ amount: pp.priceMinorUnits, currency: pp.currency })
      .from(pp)
      .where(
        and(
          eq(pp.planId, planId),
          lte(pp.effectiveFrom, at),
          ...(setBefore ? [lte(pp.createdAt, setBefore)] : []),
        ),
      )
      .orderBy(desc(pp.effectiveFrom), desc(pp.createdAt))
      .limit(1),
  );
}

/**
 * The price of a renewal starting `start` (ADR 0025 12.1): the price set at least 30 days before
 * it starts, else the one they paid last, and never more than the plan sells at then (a lower
 * price reaches them at once). Null when the plan is not for sale then.
 */
async function renewalPrice(tx: Db, state: RenewalState, start: Date): Promise<number | null> {
  const selling = forSale(await priceAt(tx, state.planId, start));
  if (selling === null) return null;
  const noticed = forSale(
    await priceAt(tx, state.planId, start, new Date(start.getTime() - PRICE_NOTICE_MS)),
  );
  const paid = state.lastCurrency === 'BDT' ? state.lastAmount : selling;
  return Math.min(noticed ?? paid, selling);
}

/**
 * The renewal for the period after the last paid one, made once: none when one already exists
 * for that start (a refunded one included: the period is not sold twice) or the plan is not for
 * sale then. Its period is the plan's length from the end of the paid one, and it is linked to
 * the subscription it renews, so paying it extends that plan. Inside both locks.
 */
async function makeRenewal(
  tx: Db,
  accountId: string,
  state: RenewalState,
  actorAccountId: string | null,
): Promise<string | null> {
  const i = personInvoices;
  const start = state.paidUntil;
  const existing = first(
    await tx
      .select({ id: i.id })
      .from(i)
      .where(
        and(
          eq(i.payerAccountId, accountId),
          eq(i.planId, state.planId),
          eq(i.periodStart, start),
          ne(i.status, 'VOID'),
        ),
      )
      .limit(1),
  );
  if (existing) return null;
  const amount = await renewalPrice(tx, state, start);
  if (amount === null) return null;
  const created = required(
    first(
      await tx
        .insert(i)
        .values({
          organizationId: null,
          payerAccountId: accountId,
          subscriptionId: state.subscriptionId,
          planId: state.planId,
          periodStart: start,
          periodEnd: new Date(start.getTime() + state.periodDays * DAY_MS),
          invoiceRef: await nextPersonInvoiceRef(tx, accountId),
          invoicedAmountMinorUnits: amount,
          currency: 'BDT',
          dueDate: start,
          status: 'OPEN',
        })
        .returning({ id: i.id }),
    ),
    'renewal invoice',
  );
  await appendAuditEvent(tx, {
    eventType: 'PERSON_PLAN_RENEWAL_INVOICED',
    actorAccountId,
    action: 'MANAGE',
    method: actorAccountId === null ? 'SYSTEM' : 'MANUAL',
    result: 'ALLOWED',
    resourceType: 'invoice',
    resourceId: created.id,
    metadata: {
      subscriptionId: state.subscriptionId,
      planId: state.planId,
      amountMinorUnits: amount,
      currency: 'BDT',
      periodStart: start.toISOString(),
    },
  });
  return created.id;
}

/**
 * Locks the person's open renewal invoices, then their billing lock: the recording's order
 * (invoice, then person), so a payment being recorded and this never wait on each other in a
 * circle. Returns the locked rows.
 */
async function lockOwnRenewals(
  tx: Db,
  accountId: string,
): Promise<readonly { readonly id: string; readonly subscriptionId: string | null }[]> {
  const i = personInvoices;
  const rows = await tx
    .select({ id: i.id, subscriptionId: i.subscriptionId })
    .from(i)
    .where(and(eq(i.payerAccountId, accountId), eq(i.status, 'OPEN'), isNotNull(i.subscriptionId)))
    .orderBy(i.id)
    .for('update');
  await lockPersonBilling(tx, accountId);
  return rows;
}

/** Whether a payment on `invoiceId` is still on its way (it may yet be recorded). */
async function paymentOnTheWay(tx: Db, invoiceId: string): Promise<boolean> {
  const a = personPaymentAttempts;
  const row = first(
    await tx
      .select({ id: a.id })
      .from(a)
      .where(and(eq(a.invoiceId, invoiceId), inArray(a.status, [...IN_FLIGHT_ATTEMPTS])))
      .limit(1),
  );
  return row !== undefined;
}

/** Cancels an open renewal with nothing paid on it and no payment on its way. Inside both locks. */
async function voidUnpaidRenewal(tx: Db, invoiceId: string, now: Date): Promise<boolean> {
  if (await paymentOnTheWay(tx, invoiceId)) return false;
  const i = personInvoices;
  const updated = await tx
    .update(i)
    .set({ status: 'VOID', updatedAt: now })
    .where(
      and(
        eq(i.id, invoiceId),
        eq(i.status, 'OPEN'),
        eq(i.collectedAmountMinorUnits, 0),
        sql`not ${invoiceHasRefundSql(sql`${i.id}`)}`,
      ),
    )
    .returning({ id: i.id });
  return updated.length > 0;
}

/** What Plan & Usage shows about renewing the person's current paid plan. */
export interface OwnRenewal {
  readonly planName: string;
  readonly renews: boolean;
  /** Whether the plan is still offered: when it is not, it simply ends. */
  readonly renewable: boolean;
  /** The end of the last paid period (exclusive): the plan covers them until then. */
  readonly paidUntil: Date;
  /** After `paidUntil`, until this moment, a renewal can still be paid without losing the plan. */
  readonly payableUntil: Date;
  /** The renewal waiting to be paid, once made (7 days before the end). */
  readonly openRenewal: {
    readonly invoiceId: string;
    readonly amountMinorUnits: number;
    readonly currency: string;
  } | null;
}

/** The person's current paid plan and its renewal, or null when no paid plan is theirs. */
export async function getOwnRenewal(
  db: Db,
  self: SelfScope,
  input: { readonly now?: Date } = {},
): Promise<OwnRenewal | null> {
  if (selfScopeProblem(self)) return null;
  if (!(await personBillingPresent(db))) return null;
  const state = await renewalState(db, self.accountId, input.now ?? new Date());
  if (!state) return null;
  const open = state.renewal?.status === 'OPEN' ? state.renewal : null;
  return {
    planName: state.planName,
    renews: state.renews,
    renewable: state.renewable,
    paidUntil: state.paidUntil,
    payableUntil: new Date(state.paidUntil.getTime() + RENEWAL_GRACE_MS),
    openRenewal: open
      ? {
          invoiceId: open.id,
          amountMinorUnits: open.amountMinorUnits,
          currency: open.currency,
        }
      : null,
  };
}

/** What Stop Renewing or Keep Renewing did, for the words shown after it. */
export interface PlanRenewalChange {
  readonly renews: boolean;
  /** A renewal is waiting to be paid now (made at once inside the last week or the grace week). */
  readonly renewalReady: boolean;
  /** The last paid period has already ended (the grace week). */
  readonly ended: boolean;
}

/**
 * Stop Renewing or Keep Renewing the person's current paid plan. Stopping cancels the renewal
 * waiting to be paid and its reminders (one being paid right now is left to finish: money is
 * never refused under a person); the plan still covers them until the paid period ends. Keeping
 * it renewing inside the last week or the grace week makes the renewal at once, so there is
 * something to pay straight away. Audited when it changes; a repeat changes nothing.
 */
export async function setPlanRenewal(
  db: Db,
  self: SelfScope,
  input: { readonly renews: boolean; readonly now?: Date },
): Promise<Result<PlanRenewalChange, ServiceError>> {
  const denied = selfScopeProblem(self);
  if (denied) return err(denied);
  if (!(await personBillingPresent(db))) return err(serviceError('invalid', NOT_AVAILABLE));
  const now = input.now ?? new Date();
  const accountId = self.accountId;
  return db.transaction(async (tx): Promise<Result<PlanRenewalChange, ServiceError>> => {
    await lockOwnRenewals(tx, accountId);
    const state = await renewalState(tx, accountId, now);
    if (!state) return err(serviceError('not_found', 'no paid plan'));
    const ended = now.getTime() >= state.paidUntil.getTime();
    const s = personSubscriptions;
    const i = personInvoices;
    let cancelled = 0;
    if (state.renews !== input.renews) {
      await tx.update(s).set({ renews: input.renews }).where(eq(s.id, state.subscriptionId));
      if (!input.renews) {
        if (
          state.renewal?.status === 'OPEN' &&
          (await voidUnpaidRenewal(tx, state.renewal.id, now))
        ) {
          cancelled++;
        }
        // Every reminder about a renewal of this plan stops, the one being paid included.
        const renewals = await tx
          .select({ id: i.id })
          .from(i)
          .where(and(eq(i.subscriptionId, state.subscriptionId), eq(i.payerAccountId, accountId)));
        await cancelOwnQueuedNotifications(
          tx,
          self,
          renewals.map((invoice) => invoice.id),
        );
      }
      await appendAuditEvent(tx, {
        eventType: input.renews ? 'PERSON_PLAN_RENEWAL_RESUMED' : 'PERSON_PLAN_RENEWAL_STOPPED',
        actorAccountId: accountId,
        action: 'MANAGE',
        method: 'MANUAL',
        result: 'ALLOWED',
        resourceType: 'subscription',
        resourceId: state.subscriptionId,
        metadata: { cancelledInvoices: cancelled },
      });
    }
    let renewalReady = input.renews && state.renewal?.status === 'OPEN';
    const inWindow =
      renewalStage(state.paidUntil, now) !== null &&
      now.getTime() < state.paidUntil.getTime() + RENEWAL_GRACE_MS;
    if (
      input.renews &&
      !renewalReady &&
      state.renewal === null &&
      state.renewable &&
      travellerPlansEnabled() &&
      inWindow
    ) {
      renewalReady =
        (await makeRenewal(tx, accountId, { ...state, renews: true }, accountId)) !== null;
    }
    return ok({ renews: input.renews, renewalReady, ended });
  });
}

/** What the daily run did for one person. */
export interface PersonRenewalRun {
  readonly created: boolean;
  readonly reminded: boolean;
  readonly lapsed: boolean;
  readonly cancelled: number;
}

/**
 * The daily run's work for one person (ADR 0025 T4, D4), in one transaction under both locks, so
 * what it decides is read again after anything the person did meanwhile:
 * - a renewal of a plan that is no longer theirs is cancelled (unless a payment is on its way);
 * - 7 days after the last paid period ended with nothing paid since, the plan ends: the unpaid
 *   renewal is cancelled with its reminders and they are told. Never while a payment on the
 *   renewal is on its way. Nothing is deleted;
 * - while selling is on, they keep renewing and the plan is still offered: from 7 days before the
 *   end, the renewal (once) and the reminder for the stage reached (once each: 7, 3, 0 days).
 */
export async function processPersonRenewal(
  db: Db,
  scope: SystemScope<'process-billing-cycle'>,
  input: { readonly accountId: string; readonly now: Date; readonly selling: boolean },
): Promise<PersonRenewalRun> {
  if (scope.job !== 'process-billing-cycle') throw new Error('wrong job scope');
  const { accountId, now } = input;
  return db.transaction(async (tx): Promise<PersonRenewalRun> => {
    const locked = await lockOwnRenewals(tx, accountId);
    const state = await renewalState(tx, accountId, now);
    let cancelled = 0;
    for (const row of locked) {
      if (state && row.subscriptionId === state.subscriptionId) continue;
      if (await voidUnpaidRenewal(tx, row.id, now)) cancelled++;
      await cancelQueuedNotificationsForResource(tx, row.id);
    }
    const nothing = { created: false, reminded: false, lapsed: false, cancelled };
    if (!state) return nothing;

    if (now.getTime() >= state.paidUntil.getTime() + RENEWAL_GRACE_MS) {
      const renewal = state.renewal;
      if (renewal?.status === 'OPEN' && (await paymentOnTheWay(tx, renewal.id))) return nothing;
      await lapsePlan(tx, accountId, state, now);
      return { ...nothing, lapsed: true };
    }
    if (!input.selling || !state.renews || !state.renewable) return nothing;
    const stage = renewalStage(state.paidUntil, now);
    if (stage === null) return nothing;
    let renewalId = state.renewal?.status === 'OPEN' ? state.renewal.id : null;
    let created = false;
    if (state.renewal === null) {
      renewalId = await makeRenewal(tx, accountId, state, null);
      created = renewalId !== null;
    }
    if (renewalId === null) return { ...nothing, created };
    const reminded = await queueRenewalReminder(tx, accountId, state, renewalId, stage, now);
    return { ...nothing, created, reminded };
  });
}

/** The reminder for the stage reached, once per stage. Neutral words: no amount, as every notice. */
async function queueRenewalReminder(
  tx: Db,
  accountId: string,
  state: RenewalState,
  renewalId: string,
  stage: RenewalStage,
  now: Date,
): Promise<boolean> {
  const ended = state.paidUntil.getTime() <= now.getTime();
  const lastDay = formatBillingDate(new Date(state.paidUntil.getTime() - 1));
  const renewBy = formatBillingDate(new Date(state.paidUntil.getTime() + RENEWAL_GRACE_MS - 1));
  const plan = state.planName;
  const written = await enqueueNotificationBothChannels(tx, {
    eventType: 'PERSON_PLAN_RENEWAL_DUE',
    resourceId: renewalId,
    recipientAccountId: accountId,
    threshold: stage,
    payload: {
      subject: ended
        ? `Renew ${plan} by ${renewBy}`
        : stage === 'd0'
          ? `${plan} ends today`
          : `${plan} ends soon`,
      summary: ended
        ? `${plan} covered you until ${lastDay}. Renew it by ${renewBy} to keep it. Nothing is charged unless you pay.`
        : `${plan} covers you until ${lastDay}. Renew it to keep your extra room. Nothing is charged unless you pay.`,
      deepLinkPath: `${PLAN_PATH}?purchase=${renewalId}#confirm-purchase-title`,
      timing: ended ? 'overdue' : stage === 'd0' ? 'today' : 'upcoming',
    },
  });
  return written > 0;
}

/** Ends the person's plan after the grace week: cancels the unpaid renewal, tells them. */
async function lapsePlan(tx: Db, accountId: string, state: RenewalState, now: Date): Promise<void> {
  const s = personSubscriptions;
  await tx.update(s).set({ endedAt: now }).where(eq(s.id, state.subscriptionId));
  let cancelled = 0;
  if (state.renewal?.status === 'OPEN') {
    if (await voidUnpaidRenewal(tx, state.renewal.id, now)) cancelled++;
    await cancelQueuedNotificationsForResource(tx, state.renewal.id);
  }
  await appendAuditEvent(tx, {
    eventType: 'PERSON_PLAN_LAPSED',
    actorAccountId: null,
    action: 'MANAGE',
    method: 'SYSTEM',
    result: 'ALLOWED',
    resourceType: 'subscription',
    resourceId: state.subscriptionId,
    metadata: {
      planId: state.planId,
      lastPeriodEnd: state.paidUntil.toISOString(),
      cancelledInvoices: cancelled,
    },
  });
  await enqueueNotificationBothChannels(tx, {
    eventType: 'PERSON_PLAN_ENDED',
    resourceId: state.subscriptionId,
    recipientAccountId: accountId,
    payload: {
      subject: `${state.planName} has ended`,
      summary: `${state.planName} has ended, so you are on Traveller Free again. Everything you stored is kept. If you are over a limit, only new uploads wait until you make room or buy a plan again.`,
      deepLinkPath: PLAN_PATH,
    },
  });
}
