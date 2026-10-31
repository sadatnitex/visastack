import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, isNull, lte, ne, sql } from 'drizzle-orm';
import { type SelfScope, selfScopeProblem } from './access/principal';
import { appendAuditEvent } from './audit';
import { invoiceHasRefundSql } from './billing-standing';
import { type Db, first, required, schema } from './db';
import { TRAVELLER_PLAN_KEY } from './entitlements';
import { type ServiceError, refusal, serviceError } from './errors';
import { lockPersonBilling } from './invoice-ledger';
import type { NewAttemptValues, PaymentAttempt } from './payments';
import { personInvoices, personPaymentAttempts } from './person-billing-tables';
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

/** The short code a person's invoices and receipts carry instead of a name (ADR 0025 D14). */
function referenceCode(accountId: string, length = 8): string {
  return accountId.replace(/-/g, '').slice(0, length).toUpperCase();
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

    const count = first(
      await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(i)
        .where(eq(i.payerAccountId, accountId)),
    );
    // References are unique across every invoice; two accounts can share the short code, so a
    // longer one is used when the short one is taken (D14: still never a name or an email).
    const number = (count?.n ?? 0) + 1;
    let invoiceRef = '';
    for (const length of [8, 12, 16, 32]) {
      const candidate = `TP-${referenceCode(accountId, length)}-${number}`;
      const taken = first(
        await tx
          .select({ id: schema.invoices.id })
          .from(schema.invoices)
          .where(eq(schema.invoices.invoiceRef, candidate))
          .limit(1),
      );
      if (!taken) {
        invoiceRef = candidate;
        break;
      }
    }
    if (invoiceRef === '') throw new Error('no free invoice reference for this person');
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

/** Said when a purchase is too old to pay: its period would already be partly over. */
export const PURCHASE_EXPIRED = 'This purchase has expired. Start it again on Plan & Usage.';

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
        periodStart: i.periodStart,
        periodEnd: i.periodEnd,
      })
      .from(i)
      .where(and(eq(i.id, input.invoiceId), eq(i.payerAccountId, self.accountId)))
      .limit(1),
  );
  if (!invoice) return err(serviceError('not_found', 'invoice not found'));
  if (invoice.periodStart.getTime() <= input.now.getTime() - REUSE_OPEN_INVOICE_MS) {
    return err(refusal('purchase_expired', PURCHASE_EXPIRED));
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
  if (await coveringPaidPeriod(db, self.accountId, input.now)) {
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
