import { formatBillingDate } from '@visastack/core';
import { and, desc, eq, gt, isNull, lte, ne, sql } from 'drizzle-orm';
import type { SystemScope } from './access/principal';
import { appendAuditEvent } from './audit';
import { invoiceHasRefundSql } from './billing-standing';
import { type Db, first, required, schema } from './db';
import { lockPersonBilling } from './invoice-ledger';
import {
  cancelQueuedNotificationsForResource,
  enqueueNotificationBothChannels,
} from './notifications';
import { RENEWAL_GRACE_DAYS, personInvoiceRefCandidates } from './person-billing';
import { personInvoices, personSubscriptions } from './person-billing-tables';
import { personBillingPresent } from './traveller-billing';
import { travellerPlansEnabled } from './traveller-plan';

/**
 * The person step of the daily billing run (ADR 0025 T4, D4): a person's paid plan is renewed by
 * paying a link, never charged by itself.
 *
 * - Renewal invoice: 7 days before a paid period ends, for a person who keeps renewing, on a plan
 *   still offered, for the next period. Its price is the plan's price that was set at least 30
 *   days before the new period starts (ADR 0025 12.1: a price change reaches renewals only with
 *   30 days' notice); with none that old, the price they paid last. Only while selling is on.
 * - Reminders: 7, 3 and 0 days before the end, in the app and by email, while the renewal is
 *   unpaid. None once they stop renewing (the open renewal is cancelled with its reminders).
 * - Lapse: 7 days after the last paid period ended with nothing paid since, the subscription ends,
 *   its unpaid renewal is cancelled, and they are told. Nothing is deleted. This runs whether
 *   selling is on or off: coverage itself always follows money that has arrived (the resolver).
 *
 * Every piece of work is its own transaction under the person's billing lock; a failure is
 * counted, rolled back and tried again on the next run. Reruns create nothing new.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** A renewal invoice is made this long before the paid period ends (D4). */
export const RENEWAL_NOTICE_DAYS = 7;
/** A new price reaches a renewal only when it was set at least this long before (12.1). */
const PRICE_NOTICE_DAYS = 30;

export interface PersonRenewalSummary {
  readonly renewalInvoicesCreated: number;
  readonly remindersQueued: number;
  readonly lapsed: number;
  readonly failed: number;
}

export const NO_PERSON_RENEWALS: PersonRenewalSummary = {
  renewalInvoicesCreated: 0,
  remindersQueued: 0,
  lapsed: 0,
  failed: 0,
};

const PLAN_PATH = '/app/account/plan';

/** The reminder stage for a period ending `end` at `now`: 7, 3 or 0 days before, or none yet. */
function renewalReminderStage(end: Date, now: Date): 'd7' | 'd3' | 'd0' | null {
  const left = end.getTime() - now.getTime();
  if (left > RENEWAL_NOTICE_DAYS * DAY_MS) return null;
  if (left > 3 * DAY_MS) return 'd7';
  if (left > DAY_MS) return 'd3';
  return 'd0';
}

interface CurrentPeriod {
  readonly subscriptionId: string;
  readonly payer: string;
  readonly planId: string;
  readonly planName: string;
  readonly planActive: boolean;
  readonly periodDays: number;
  readonly renews: boolean;
  readonly amount: number;
  readonly currency: string;
  readonly periodEnd: Date;
}

/**
 * Every current person subscription with its last paid, unrefunded period, the soonest end first.
 * One whose every period was refunded has none and is left alone: ending a plan on a refund
 * belongs to the refund (T6), not to this run.
 */
async function currentPeriods(db: Db, limit: number): Promise<CurrentPeriod[]> {
  const rows = (await db.execute(sql`
    select s.id as subscription_id, s.payer_account_id as payer, s.plan_id, p.name as plan_name,
      p.active as plan_active, p.period_days, s.renews,
      last.invoiced_amount_minor_units as amount, last.currency,
      last.period_end
    from subscriptions s
    join plans p on p.id = s.plan_id and p.audience = 'TRAVELLER'
    join lateral (
      select i.invoiced_amount_minor_units, i.currency, i.period_end
      from invoices i
      where i.subscription_id = s.id and i.payer_account_id = s.payer_account_id
        and i.status = 'PAID' and not ${invoiceHasRefundSql(sql`i.id`)}
      order by i.period_end desc
      limit 1
    ) last on true
    where s.payer_account_id is not null and s.ended_at is null
    order by last.period_end, s.id
    limit ${limit}`)) as unknown as {
    rows: {
      subscription_id: string;
      payer: string;
      plan_id: string;
      plan_name: string;
      plan_active: boolean;
      period_days: number | string;
      renews: boolean;
      amount: number | string;
      currency: string;
      period_end: string | Date;
    }[];
  };
  return rows.rows.map((r) => ({
    subscriptionId: r.subscription_id,
    payer: r.payer,
    planId: r.plan_id,
    planName: r.plan_name,
    planActive: r.plan_active,
    periodDays: Number(r.period_days),
    renews: r.renews,
    amount: Number(r.amount),
    currency: r.currency,
    periodEnd: new Date(r.period_end),
  }));
}

/** The renewal invoice of a subscription for the period starting `start`, if any (not void). */
async function renewalFor(
  tx: Db,
  subscriptionId: string,
  start: Date,
): Promise<{ readonly id: string; readonly status: string } | undefined> {
  const i = personInvoices;
  return first(
    await tx
      .select({ id: i.id, status: i.status })
      .from(i)
      .where(
        and(eq(i.subscriptionId, subscriptionId), eq(i.periodStart, start), ne(i.status, 'VOID')),
      )
      .limit(1),
  );
}

/** The plan's price for a renewal starting `start`: one set 30 days before it, else the last paid. */
async function renewalPrice(
  tx: Db,
  period: CurrentPeriod,
  start: Date,
): Promise<{ readonly amount: number; readonly currency: string } | null> {
  const pp = schema.planPrices;
  const noticed = first(
    await tx
      .select({ amount: pp.priceMinorUnits, currency: pp.currency })
      .from(pp)
      .where(
        and(
          eq(pp.planId, period.planId),
          lte(pp.effectiveFrom, start),
          lte(pp.createdAt, new Date(start.getTime() - PRICE_NOTICE_DAYS * DAY_MS)),
        ),
      )
      .orderBy(desc(pp.effectiveFrom), desc(pp.createdAt))
      .limit(1),
  );
  if (noticed) {
    // The plan stopped being priced (no longer for sale) with notice: no renewal.
    if (noticed.amount === null || noticed.amount <= 0 || noticed.currency !== 'BDT') return null;
    return { amount: noticed.amount, currency: noticed.currency };
  }
  return { amount: period.amount, currency: period.currency };
}

/** The renewal invoice for the next period, once, 7 days before the end. True when it made one. */
async function createRenewal(db: Db, period: CurrentPeriod): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockPersonBilling(tx, period.payer);
    const start = period.periodEnd;
    if (await renewalFor(tx, period.subscriptionId, start)) return false;
    const price = await renewalPrice(tx, period, start);
    if (!price) return false;
    const i = personInvoices;
    const count = first(
      await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(i)
        .where(eq(i.payerAccountId, period.payer)),
    );
    let invoiceRef = '';
    for (const candidate of personInvoiceRefCandidates(period.payer, (count?.n ?? 0) + 1)) {
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
            payerAccountId: period.payer,
            // Linked to the subscription it renews: paying it extends that subscription.
            subscriptionId: period.subscriptionId,
            planId: period.planId,
            periodStart: start,
            periodEnd: new Date(start.getTime() + period.periodDays * DAY_MS),
            invoiceRef,
            invoicedAmountMinorUnits: price.amount,
            currency: price.currency,
            dueDate: start,
            status: 'OPEN',
          })
          .returning({ id: i.id }),
      ),
      'renewal invoice',
    );
    await appendAuditEvent(tx, {
      eventType: 'PERSON_PLAN_RENEWAL_INVOICED',
      actorAccountId: null,
      action: 'MANAGE',
      method: 'SYSTEM',
      result: 'ALLOWED',
      resourceType: 'invoice',
      resourceId: created.id,
      metadata: {
        subscriptionId: period.subscriptionId,
        planId: period.planId,
        amountMinorUnits: price.amount,
        currency: price.currency,
        periodStart: start.toISOString(),
      },
    });
    return true;
  });
}

/** One reminder for the stage the unpaid renewal has reached. True when one was written. */
async function remind(db: Db, period: CurrentPeriod, now: Date): Promise<boolean> {
  const stage = renewalReminderStage(period.periodEnd, now);
  if (stage === null) return false;
  return db.transaction(async (tx) => {
    await lockPersonBilling(tx, period.payer);
    const renewal = await renewalFor(tx, period.subscriptionId, period.periodEnd);
    if (!renewal || renewal.status !== 'OPEN') return false;
    // Neutral words (no amount, as every notice): the price is on the page the link opens.
    const ended = period.periodEnd.getTime() <= now.getTime();
    const ends = formatBillingDate(new Date(period.periodEnd.getTime() - 1));
    const lastDay = formatBillingDate(
      new Date(period.periodEnd.getTime() + RENEWAL_GRACE_DAYS * DAY_MS - 1),
    );
    const written = await enqueueNotificationBothChannels(tx, {
      eventType: 'PERSON_PLAN_RENEWAL_DUE',
      resourceId: renewal.id,
      recipientAccountId: period.payer,
      threshold: stage,
      payload: {
        subject: ended
          ? `${period.planName} has ended`
          : stage === 'd0'
            ? `${period.planName} ends today`
            : `${period.planName} ends soon`,
        summary: ended
          ? `${period.planName} covered you until ${ends}. Renew it by ${lastDay} to keep it. Nothing is charged unless you pay.`
          : `${period.planName} covers you until ${ends}. Renew it to keep your extra room. Nothing is charged unless you pay.`,
        deepLinkPath: `${PLAN_PATH}?purchase=${renewal.id}#confirm-purchase-title`,
        timing: ended ? 'overdue' : stage === 'd0' ? 'today' : 'upcoming',
      },
    });
    return written > 0;
  });
}

/** Ends a subscription whose last paid period ended over 7 days ago. True when it ended one. */
async function lapse(db: Db, period: CurrentPeriod, now: Date): Promise<boolean> {
  if (now.getTime() < period.periodEnd.getTime() + RENEWAL_GRACE_DAYS * DAY_MS) return false;
  return db.transaction(async (tx) => {
    await lockPersonBilling(tx, period.payer);
    const s = personSubscriptions;
    const i = personInvoices;
    // Still current, and still nothing paid after that period (read again under the lock).
    const current = first(
      await tx
        .select({ id: s.id })
        .from(s)
        .where(and(eq(s.id, period.subscriptionId), isNull(s.endedAt)))
        .limit(1)
        .for('update'),
    );
    if (!current) return false;
    const later = first(
      await tx
        .select({ id: i.id })
        .from(i)
        .where(
          and(
            eq(i.subscriptionId, period.subscriptionId),
            eq(i.status, 'PAID'),
            gt(i.periodEnd, period.periodEnd),
          ),
        )
        .limit(1),
    );
    if (later) return false;
    await tx.update(s).set({ endedAt: now }).where(eq(s.id, period.subscriptionId));
    // Its unpaid renewals are cancelled with their reminders; nothing paid is touched.
    const open = await tx
      .select({ id: i.id })
      .from(i)
      .where(
        and(
          eq(i.subscriptionId, period.subscriptionId),
          eq(i.status, 'OPEN'),
          eq(i.collectedAmountMinorUnits, 0),
        ),
      );
    for (const invoice of open) {
      await tx.update(i).set({ status: 'VOID', updatedAt: now }).where(eq(i.id, invoice.id));
      await cancelQueuedNotificationsForResource(tx, invoice.id);
    }
    await appendAuditEvent(tx, {
      eventType: 'PERSON_PLAN_LAPSED',
      actorAccountId: null,
      action: 'MANAGE',
      method: 'SYSTEM',
      result: 'ALLOWED',
      resourceType: 'subscription',
      resourceId: period.subscriptionId,
      metadata: {
        planId: period.planId,
        lastPeriodEnd: period.periodEnd.toISOString(),
        cancelledInvoices: open.length,
      },
    });
    await enqueueNotificationBothChannels(tx, {
      eventType: 'PERSON_PLAN_ENDED',
      resourceId: period.subscriptionId,
      recipientAccountId: period.payer,
      payload: {
        subject: `${period.planName} has ended`,
        summary: `${period.planName} has ended, so you are on Traveller Free again. Everything you stored is kept. If you are over a limit, only new uploads wait until you make room or buy a plan again.`,
        deepLinkPath: PLAN_PATH,
      },
    });
    return true;
  });
}

/**
 * The person step of the daily billing run. Renewal invoices and reminders only while selling is
 * switched on; lapses always. Before migrations 0110 and 0111 there is nothing to do.
 */
export async function runPersonRenewals(
  db: Db,
  scope: SystemScope<'process-billing-cycle'>,
  options: {
    readonly now: Date;
    readonly limit: number;
    /** True once no more work may start (the run's budget for this step). */
    readonly deadline: () => boolean;
  },
): Promise<PersonRenewalSummary> {
  if (scope.job !== 'process-billing-cycle') throw new Error('wrong job scope');
  if (!(await personBillingPresent(db))) return NO_PERSON_RENEWALS;
  const selling = travellerPlansEnabled();
  let renewalInvoicesCreated = 0;
  let remindersQueued = 0;
  let lapsed = 0;
  let failed = 0;
  // One more than the limit is read, so a run that cannot finish says so.
  for (const period of await currentPeriods(db, options.limit + 1)) {
    if (options.deadline()) break;
    try {
      if (await lapse(db, period, options.now)) {
        lapsed++;
        continue;
      }
      // Inside the grace week the renewal is still made and stays payable (D4).
      if (!selling || !period.renews || !period.planActive) continue;
      if (renewalReminderStage(period.periodEnd, options.now) === null) continue;
      if (await createRenewal(db, period)) renewalInvoicesCreated++;
      if (await remind(db, period, options.now)) remindersQueued++;
    } catch (error) {
      failed++;
      console.error(
        JSON.stringify({
          event: 'billing_cycle_person_failed',
          subscriptionId: period.subscriptionId,
          error: error instanceof Error ? error.name : 'unknown',
        }),
      );
    }
  }
  return { renewalInvoicesCreated, remindersQueued, lapsed, failed };
}
