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
function referenceCode(accountId: string): string {
  return accountId.replace(/-/g, '').slice(0, 8).toUpperCase();
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
    const invoiceRef = `TP-${referenceCode(accountId)}-${(count?.n ?? 0) + 1}`;
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
 * The signed-in person's own invoice, for paying it online: an invoice whose payer is anyone else
 * reads as not found.
 */
export async function ownPersonInvoice(
  db: Db,
  self: SelfScope,
  invoiceId: string,
): Promise<{ readonly id: string; readonly currency: string } | undefined> {
  if (selfScopeProblem(self)) return undefined;
  return first(
    await db
      .select({ id: personInvoices.id, currency: personInvoices.currency })
      .from(personInvoices)
      .where(
        and(eq(personInvoices.id, invoiceId), eq(personInvoices.payerAccountId, self.accountId)),
      )
      .limit(1),
  );
}

/**
 * Writes a payment attempt paid by the signed-in person, for `startPersonPayment`. The row is read
 * back as an agency attempt reads (the same columns, with no organization).
 */
export function personAttemptWriter(
  self: SelfScope,
): (tx: Db, values: NewAttemptValues) => Promise<PaymentAttempt> {
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
