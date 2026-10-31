import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import { TRAVELLER_PLAN_KEY, resolveEntitlements } from './entitlements';

/**
 * ADR 0025, T2: a traveller is on a paid traveller plan only while a paid, unrefunded invoice of
 * their current subscription covers now. Everything else is Traveller Free.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-15T12:00:00Z');

let db: Db;

beforeEach(async () => {
  const client = await createMigratedPglite();
  db = drizzle(client, { schema }) as unknown as Db;
}, 60_000);

async function account(email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!isOk(made)) throw new Error('provision failed');
  return made.value.id;
}

async function plusPlan(): Promise<string> {
  const [plan] = await db
    .insert(schema.plans)
    .values({
      key: 'traveller_plus',
      name: 'Traveller Plus',
      audience: 'TRAVELLER',
      periodDays: 30,
    })
    .returning({ id: schema.plans.id });
  if (!plan) throw new Error('plan insert failed');
  await db.insert(schema.planEntitlements).values([
    { planId: plan.id, key: 'ai.ai_app_suggestions', included: true, limitValue: 100, per: 'DAY' },
    {
      planId: plan.id,
      key: 'account_storage_bytes',
      included: true,
      limitValue: 500_000_000,
      per: 'TOTAL',
    },
    {
      planId: plan.id,
      key: 'person_storage_bytes',
      included: true,
      limitValue: 200_000_000,
      per: 'TOTAL',
    },
  ]);
  return plan.id;
}

let refs = 0;
/** A person's subscription to `planId`, with one invoice for [start, start + 30 days). */
async function bought(
  accountId: string,
  planId: string,
  invoice: { start: Date; status?: 'PAID' | 'OPEN'; payer?: string },
): Promise<{ subscriptionId: string; invoiceId: string }> {
  const [sub] = await db
    .insert(schema.subscriptions)
    .values({ payerAccountId: accountId, planId, reason: 'Bought Traveller Plus' })
    .returning({ id: schema.subscriptions.id });
  if (!sub) throw new Error('subscription insert failed');
  const [inv] = await db
    .insert(schema.invoices)
    .values({
      payerAccountId: invoice.payer ?? accountId,
      subscriptionId: sub.id,
      planId,
      periodStart: invoice.start,
      periodEnd: new Date(invoice.start.getTime() + 30 * DAY),
      invoiceRef: `INV-P-${++refs}`,
      invoicedAmountMinorUnits: 49900,
      collectedAmountMinorUnits: invoice.status === 'OPEN' ? 0 : 49900,
      currency: 'BDT',
      dueDate: invoice.start,
      status: invoice.status ?? 'PAID',
    })
    .returning({ id: schema.invoices.id });
  if (!inv) throw new Error('invoice insert failed');
  return { subscriptionId: sub.id, invoiceId: inv.id };
}

describe('a traveller’s plan follows money that has arrived (ADR 0025)', () => {
  it('is Traveller Free with no paid plan, and has no storage rules of its own', async () => {
    const person = await account('free@example.com');
    const resolved = await resolveEntitlements(db, { accountId: person }, NOW);
    expect(resolved.plan?.key).toBe(TRAVELLER_PLAN_KEY);
    expect(resolved.periodEnd).toBeNull();
    expect(resolved.travellerStorage).toEqual({ accountBytes: null, personBytes: null });
  });

  it('is the paid plan, with its period and rules, while a paid invoice covers now', async () => {
    const person = await account('plus@example.com');
    const plan = await plusPlan();
    await bought(person, plan, { start: new Date(NOW.getTime() - 10 * DAY) });
    const resolved = await resolveEntitlements(db, { accountId: person }, NOW);
    expect(resolved.plan?.key).toBe('traveller_plus');
    expect(resolved.periodStart).toEqual(new Date(NOW.getTime() - 10 * DAY));
    expect(resolved.periodEnd).toEqual(new Date(NOW.getTime() + 20 * DAY));
    expect(resolved.features?.ai_app_suggestions).toEqual({ included: true, dailyLimit: 100 });
    expect(resolved.travellerStorage).toEqual({
      accountBytes: 500_000_000,
      personBytes: 200_000_000,
    });
  });

  it('falls back to Traveller Free when the invoice is unpaid, the period has ended, or not started', async () => {
    const plan = await plusPlan();
    const unpaid = await account('unpaid@example.com');
    await bought(unpaid, plan, { start: new Date(NOW.getTime() - DAY), status: 'OPEN' });
    const ended = await account('ended@example.com');
    await bought(ended, plan, { start: new Date(NOW.getTime() - 31 * DAY) });
    const future = await account('future@example.com');
    await bought(future, plan, { start: new Date(NOW.getTime() + DAY) });
    for (const person of [unpaid, ended, future]) {
      const resolved = await resolveEntitlements(db, { accountId: person }, NOW);
      expect(resolved.plan?.key, person).toBe(TRAVELLER_PLAN_KEY);
      expect(resolved.periodEnd, person).toBeNull();
    }
  });

  it('falls back to Traveller Free once the payment is refunded or the subscription has ended', async () => {
    const plan = await plusPlan();
    const refunded = await account('refunded@example.com');
    const paid = await bought(refunded, plan, { start: new Date(NOW.getTime() - DAY) });
    await db.insert(schema.invoicePayments).values({
      invoiceId: paid.invoiceId,
      amountMinorUnits: -49900,
      currency: 'BDT',
      kind: 'REFUND',
      sourceId: crypto.randomUUID(),
      reference: 'REFUND-1',
      collectedDate: NOW,
      recordedByAccountId: refunded,
      mode: 'LIVE',
    });
    const stopped = await account('stopped@example.com');
    const ended = await bought(stopped, plan, { start: new Date(NOW.getTime() - DAY) });
    await db
      .update(schema.subscriptions)
      .set({ endedAt: NOW })
      .where(eq(schema.subscriptions.id, ended.subscriptionId));
    for (const person of [refunded, stopped]) {
      const resolved = await resolveEntitlements(db, { accountId: person }, NOW);
      expect(resolved.plan?.key, person).toBe(TRAVELLER_PLAN_KEY);
    }
  });

  it('never counts another person’s payment', async () => {
    const plan = await plusPlan();
    const payer = await account('payer@example.com');
    const other = await account('other@example.com');
    // A subscription of `other` with an invoice paid by `payer`: it covers neither.
    await bought(other, plan, { start: new Date(NOW.getTime() - DAY), payer });
    for (const person of [payer, other]) {
      const resolved = await resolveEntitlements(db, { accountId: person }, NOW);
      expect(resolved.plan?.key, person).toBe(TRAVELLER_PLAN_KEY);
    }
  });

  it('keeps a period already paid for after the plan is retired', async () => {
    const person = await account('retired@example.com');
    const plan = await plusPlan();
    await bought(person, plan, { start: new Date(NOW.getTime() - DAY) });
    await db.update(schema.plans).set({ active: false }).where(eq(schema.plans.id, plan));
    const resolved = await resolveEntitlements(db, { accountId: person }, NOW);
    expect(resolved.plan?.key).toBe('traveller_plus');
  });
});
