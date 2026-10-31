import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selfPrincipal } from './access/principal';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import { runBillingCycle } from './billing-cycle';
import type { Db } from './db';
import { cancelOwnQueuedNotifications } from './notifications';
import { settlePaymentAttempt, startPersonPayment } from './payments';
import { FakePaymentPort, onePort } from './payments.test-support';
import {
  getOwnPurchase,
  getOwnRenewal,
  payablePersonInvoice,
  setPlanRenewal,
  startPersonCheckout,
} from './person-billing';
import { personInvoices, personSubscriptions } from './person-billing-tables';
import { coveringPaidPeriod } from './traveller-billing';
import { getTravellerPlanSummary } from './traveller-plan';

/**
 * ADR 0025 T4 (D4): a paid traveller plan is renewed by paying a link, never charged by itself.
 * The daily run makes the renewal 7 days before the end and reminds at 7, 3 and 0 days; a rerun
 * makes nothing new; paying late inside the grace week keeps the plan; after it the plan lapses
 * and nothing is deleted; Stop Renewing cancels the renewal and its reminders.
 */

const DAY = 24 * 60 * 60 * 1000;
const PRICE = 49_900;
const urlFor = (kind: string, tran: string) => `https://app.example.test/pay/${kind}?t=${tran}`;

let db: Db;
let port: FakePaymentPort;
let planId: string;
let alice: string;
let bob: string;

async function account(email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!isOk(made)) throw new Error('provision');
  return made.value.id;
}

const self = (accountId: string) => selfPrincipal(accountId);
const run = (now: Date) =>
  runBillingCycle(db, systemScopeForTest('process-billing-cycle'), { now });

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows;
}

beforeEach(async () => {
  vi.stubEnv('TRAVELLER_PLANS_ENABLED', 'true');
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  port = new FakePaymentPort();
  const [plan] = await db
    .insert(schema.plans)
    .values({ key: 'traveller_plus_renew', name: 'Traveller Plus', audience: 'TRAVELLER' })
    .returning({ id: schema.plans.id });
  if (!plan) throw new Error('plan');
  planId = plan.id;
  await db.insert(schema.planPrices).values({
    planId,
    priceMinorUnits: PRICE,
    currency: 'BDT',
    effectiveFrom: new Date('2001-01-01T00:00:00Z'),
    createdAt: new Date('2001-01-01T00:00:00Z'),
  });
  alice = await account('alice-renew@example.com');
  bob = await account('bob-renew@example.com');
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Pays `invoiceId` online as `accountId`, recorded by the one recording function. */
async function payInvoice(accountId: string, invoiceId: string): Promise<string> {
  const started = await startPersonPayment(db, onePort(port), self(accountId), {
    invoiceId,
    urlFor,
    startAnother: false,
  });
  if (!isOk(started) || started.value.kind !== 'redirect') {
    throw new Error(`start: ${isErr(started) ? started.error.message : started.value.kind}`);
  }
  const [attempt] = await rows<{ merchant_tran_id: string; amount_minor_units: number }>(
    sql`select merchant_tran_id, amount_minor_units from payment_attempts where id = ${started.value.attemptId}::uuid`,
  );
  if (!attempt) throw new Error('attempt');
  const paid = port.succeed(attempt.merchant_tran_id, Number(attempt.amount_minor_units));
  const settled = await settlePaymentAttempt(db, port, {
    merchantTranId: attempt.merchant_tran_id,
    valId: paid.valId,
    source: 'ipn',
  });
  return settled.code;
}

/** Buys and pays one 30-day period, then moves it so it ends `endsInDays` from now (or at `at`). */
async function paidPeriod(accountId: string, endsInDays: number, at?: Date): Promise<Date> {
  const made = await startPersonCheckout(db, self(accountId), { planId });
  if (!isOk(made)) throw new Error(`checkout: ${made.error.message}`);
  expect(await payInvoice(accountId, made.value.invoiceId)).toBe('recorded');
  const end = at ?? new Date(Date.now() + endsInDays * DAY);
  const start = new Date(end.getTime() - 30 * DAY);
  await db
    .update(personInvoices)
    .set({ periodStart: start, periodEnd: end, dueDate: start })
    .where(eq(personInvoices.id, made.value.invoiceId));
  await db
    .update(personSubscriptions)
    .set({ startedAt: start })
    .where(eq(personSubscriptions.payerAccountId, accountId));
  return end;
}

async function invoicesOf(accountId: string) {
  return db
    .select({
      id: personInvoices.id,
      status: personInvoices.status,
      subscriptionId: personInvoices.subscriptionId,
      periodStart: personInvoices.periodStart,
      periodEnd: personInvoices.periodEnd,
      amount: personInvoices.invoicedAmountMinorUnits,
    })
    .from(personInvoices)
    .where(eq(personInvoices.payerAccountId, accountId))
    .orderBy(personInvoices.periodStart);
}

async function notices(accountId: string) {
  return rows<{ event_type: string; channel: string; status: string; idempotency_key: string }>(
    sql`select event_type, channel, status, idempotency_key from notifications
      where recipient_account_id = ${accountId}::uuid order by created_at, channel`,
  );
}

describe('renewing a paid traveller plan by paying a link (ADR 0025 T4)', () => {
  it('makes one renewal 7 days before the end, reminds at 7, 3 and 0 days, and a rerun makes nothing', async () => {
    const end = await paidPeriod(alice, 6);
    const first = await run(new Date());
    expect(first.travellerPlans).toEqual({
      renewalInvoicesCreated: 1,
      remindersQueued: 1,
      lapsed: 0,
      failed: 0,
    });
    const again = await run(new Date());
    expect(again.travellerPlans).toMatchObject({ renewalInvoicesCreated: 0, remindersQueued: 0 });

    const list = await invoicesOf(alice);
    expect(list).toHaveLength(2);
    const renewal = list[1];
    const [subscription] = await db
      .select({ id: personSubscriptions.id })
      .from(personSubscriptions)
      .where(eq(personSubscriptions.payerAccountId, alice));
    expect(renewal).toMatchObject({
      status: 'OPEN',
      subscriptionId: subscription?.id,
      amount: PRICE,
    });
    expect(renewal?.periodStart.getTime()).toBe(end.getTime());
    expect(renewal?.periodEnd.getTime()).toBe(end.getTime() + 30 * DAY);

    // In the app and by email, once per stage.
    const due = (await notices(alice)).filter((n) => n.event_type === 'PERSON_PLAN_RENEWAL_DUE');
    expect(due.map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
    expect(due.every((n) => n.idempotency_key.endsWith(':d7'))).toBe(true);
    const [payload] = await rows<{ payload: { deepLinkPath: string; summary: string } }>(
      sql`select payload from notifications where event_type = 'PERSON_PLAN_RENEWAL_DUE' limit 1`,
    );
    expect(payload?.payload.deepLinkPath).toBe(
      `/app/account/plan?purchase=${renewal?.id}#confirm-purchase-title`,
    );
    expect(payload?.payload.summary).toContain('Nothing is charged unless you pay');

    await run(new Date(end.getTime() - 2 * DAY));
    await run(new Date(end.getTime() - 2 * DAY));
    await run(new Date(end.getTime() - DAY / 2));
    const stages = (await notices(alice))
      .filter((n) => n.event_type === 'PERSON_PLAN_RENEWAL_DUE' && n.channel === 'IN_APP')
      .map((n) => n.idempotency_key.split(':').pop());
    expect(stages).toEqual(['d7', 'd3', 'd0']);
    expect(await invoicesOf(alice)).toHaveLength(2);
    // Bob has no paid plan: nothing is made for him.
    expect(await invoicesOf(bob)).toHaveLength(0);
  });

  it('can be paid early, extends the same plan, and stops the reminders still waiting', async () => {
    const end = await paidPeriod(alice, 6);
    await run(new Date());
    const renewal = (await invoicesOf(alice))[1];
    if (!renewal) throw new Error('renewal');
    // The confirmation card shows it, from the end of the paid period.
    const purchase = await getOwnPurchase(db, self(alice), { invoiceId: renewal.id });
    expect(purchase?.periodStart.getTime()).toBe(end.getTime());
    // Bob cannot see or pay it.
    expect(await getOwnPurchase(db, self(bob), { invoiceId: renewal.id })).toBeNull();

    expect(await payInvoice(alice, renewal.id)).toBe('recorded');
    const list = await invoicesOf(alice);
    expect(list.map((i) => i.status)).toEqual(['PAID', 'PAID']);
    const subs = await db
      .select({ id: personSubscriptions.id, endedAt: personSubscriptions.endedAt })
      .from(personSubscriptions)
      .where(eq(personSubscriptions.payerAccountId, alice));
    expect(subs).toHaveLength(1);
    expect(subs[0]?.endedAt).toBeNull();
    const covered = await coveringPaidPeriod(db, alice, new Date(end.getTime() + DAY));
    expect(covered?.periodEnd.getTime()).toBe(end.getTime() + 30 * DAY);
    // A queued reminder about the paid renewal is not sent.
    const due = (await notices(alice)).filter((n) => n.event_type === 'PERSON_PLAN_RENEWAL_DUE');
    expect(due.every((n) => n.status === 'CANCELLED')).toBe(true);
    // The next run makes the renewal after it only 7 days before that one ends.
    expect((await run(new Date())).travellerPlans.renewalInvoicesCreated).toBe(0);
    expect((await run(new Date(end.getTime() + 24 * DAY))).travellerPlans).toMatchObject({
      renewalInvoicesCreated: 1,
      lapsed: 0,
    });
  });

  it('keeps the plan when paid late inside the grace week, from the day the last period ended', async () => {
    const end = await paidPeriod(alice, -3);
    expect(await coveringPaidPeriod(db, alice, new Date())).toBeUndefined();
    const summary = await run(new Date());
    expect(summary.travellerPlans).toMatchObject({ renewalInvoicesCreated: 1, lapsed: 0 });
    const renewal = (await invoicesOf(alice))[1];
    if (!renewal) throw new Error('renewal');
    const view = await getOwnRenewal(db, self(alice));
    expect(view).toMatchObject({ renews: true, openRenewal: { invoiceId: renewal.id } });
    expect(view?.payableUntil.getTime()).toBe(end.getTime() + 7 * DAY);

    expect(await payInvoice(alice, renewal.id)).toBe('recorded');
    const covered = await coveringPaidPeriod(db, alice, new Date());
    expect(covered?.periodStart.getTime()).toBe(end.getTime());
    expect((await run(new Date(end.getTime() + 8 * DAY))).travellerPlans.lapsed).toBe(0);
  });

  it('lapses 7 days after the end with nothing paid: the renewal is cancelled, nothing is deleted', async () => {
    await paidPeriod(alice, -6);
    await run(new Date());
    const before = await invoicesOf(alice);
    expect(before).toHaveLength(2);
    const receiptsBefore = await rows<{ n: number }>(
      sql`select count(*)::int as n from payment_receipts where payer_account_id = ${alice}::uuid`,
    );

    const lapsedRun = await run(new Date(Date.now() + 2 * DAY));
    expect(lapsedRun.travellerPlans).toMatchObject({ lapsed: 1, failed: 0 });
    const after = await invoicesOf(alice);
    expect(after.map((i) => [i.id, i.status])).toEqual([
      [before[0]?.id, 'PAID'],
      [before[1]?.id, 'VOID'],
    ]);
    const receiptsAfter = await rows<{ n: number }>(
      sql`select count(*)::int as n from payment_receipts where payer_account_id = ${alice}::uuid`,
    );
    expect(receiptsAfter).toEqual(receiptsBefore);
    const [sub] = await db
      .select({ endedAt: personSubscriptions.endedAt })
      .from(personSubscriptions)
      .where(eq(personSubscriptions.payerAccountId, alice));
    expect(sub?.endedAt).not.toBeNull();
    const all = await notices(alice);
    expect(all.filter((n) => n.event_type === 'PERSON_PLAN_ENDED')).toHaveLength(2);
    expect(
      all
        .filter((n) => n.event_type === 'PERSON_PLAN_RENEWAL_DUE')
        .every((n) => n.status === 'CANCELLED'),
    ).toBe(true);
    const audit = await rows<{ n: number }>(
      sql`select count(*)::int as n from audit_events where event_type = 'PERSON_PLAN_LAPSED'`,
    );
    expect(audit[0]?.n).toBe(1);
    // The cancelled renewal can no longer be paid, and a rerun changes nothing.
    const refused = await payablePersonInvoice(db, self(alice), {
      invoiceId: before[1]?.id ?? '',
      now: new Date(),
    });
    expect(isErr(refused)).toBe(true);
    expect((await run(new Date(Date.now() + 3 * DAY))).travellerPlans.lapsed).toBe(0);
    expect(await getOwnRenewal(db, self(alice))).toBeNull();
    // They can buy the plan again.
    expect(isOk(await startPersonCheckout(db, self(alice), { planId }))).toBe(true);
  });

  it('Stop Renewing cancels the renewal and its reminders; Keep Renewing lets the run make it again', async () => {
    await paidPeriod(alice, 6);
    await run(new Date());
    const renewal = (await invoicesOf(alice))[1];
    if (!renewal) throw new Error('renewal');

    // Nobody else can silence Alice's reminders, even naming her renewal.
    expect(await cancelOwnQueuedNotifications(db, self(bob), [renewal.id])).toEqual({
      cancelled: 0,
    });
    expect(
      (await notices(alice)).filter(
        (n) => n.status === 'QUEUED' && n.event_type === 'PERSON_PLAN_RENEWAL_DUE',
      ),
    ).toHaveLength(2);
    const stopped = await setPlanRenewal(db, self(alice), { renews: false });
    expect(isOk(stopped) && stopped.value.renews).toBe(false);
    expect((await invoicesOf(alice))[1]?.status).toBe('VOID');
    expect(
      (await notices(alice)).filter(
        (n) => n.status === 'QUEUED' && n.event_type === 'PERSON_PLAN_RENEWAL_DUE',
      ),
    ).toHaveLength(0);
    expect(await getOwnRenewal(db, self(alice))).toMatchObject({
      renews: false,
      openRenewal: null,
    });
    // No renewal and no reminder while they do not renew; the paid period still covers them.
    const quiet = await run(new Date(Date.now() + 4 * DAY));
    expect(quiet.travellerPlans).toMatchObject({ renewalInvoicesCreated: 0, remindersQueued: 0 });
    expect(await coveringPaidPeriod(db, alice, new Date())).toBeDefined();
    // Bob cannot change Alice's plan: he has none of his own.
    const bobs = await setPlanRenewal(db, self(bob), { renews: false });
    expect(isErr(bobs) && bobs.error.code).toBe('not_found');

    // Inside the last week, Keep Renewing makes the renewal at once: there is something to pay now.
    const resumed = await setPlanRenewal(db, self(alice), { renews: true });
    expect(isOk(resumed) && resumed.value).toEqual({
      renews: true,
      renewalReady: true,
      ended: false,
    });
    expect((await invoicesOf(alice)).filter((i) => i.status === 'OPEN')).toHaveLength(1);
    expect((await run(new Date(Date.now() + 4 * DAY))).travellerPlans).toMatchObject({
      renewalInvoicesCreated: 0,
      remindersQueued: 1,
    });
    const audits = await rows<{ event_type: string }>(
      sql`select event_type from audit_events where event_type like 'PERSON_PLAN_RENEWAL_%' order by occurred_at, event_type`,
    );
    expect(audits.map((a) => a.event_type)).toEqual(
      expect.arrayContaining(['PERSON_PLAN_RENEWAL_STOPPED', 'PERSON_PLAN_RENEWAL_RESUMED']),
    );
    // A repeat changes nothing and writes nothing.
    const count = audits.length;
    await setPlanRenewal(db, self(alice), { renews: true });
    expect(
      await rows(sql`select 1 from audit_events where event_type like 'PERSON_PLAN_RENEWAL_%'`),
    ).toHaveLength(count);
  });

  it('keeps the price paid unless a new one was set 30 days before the renewal starts', async () => {
    await paidPeriod(alice, 6);
    await paidPeriod(bob, 6);
    // A new price set today reaches no renewal starting within 30 days.
    await db.insert(schema.planPrices).values({
      planId,
      priceMinorUnits: 79_900,
      currency: 'BDT',
      effectiveFrom: new Date(Date.now() - DAY),
    });
    await run(new Date());
    expect((await invoicesOf(alice))[1]?.amount).toBe(PRICE);
    // With 30 days' notice, it does (prices are never edited: a new row, set 40 days ago).
    await db.insert(schema.planPrices).values({
      planId,
      priceMinorUnits: 69_900,
      currency: 'BDT',
      effectiveFrom: new Date(Date.now() - 35 * DAY),
      createdAt: new Date(Date.now() - 40 * DAY),
    });
    await setPlanRenewal(db, self(bob), { renews: false });
    await setPlanRenewal(db, self(bob), { renews: true });
    await run(new Date());
    const bobs = await invoicesOf(bob);
    expect(bobs.filter((i) => i.status === 'OPEN').map((i) => i.amount)).toEqual([69_900]);
    expect((await invoicesOf(alice))[1]?.amount).toBe(PRICE);
  });

  it('makes no renewal while selling is off, but still lapses a plan nobody paid for', async () => {
    await paidPeriod(alice, 6);
    await paidPeriod(bob, -8);
    vi.stubEnv('TRAVELLER_PLANS_ENABLED', 'false');
    const summary = await run(new Date());
    expect(summary.travellerPlans).toEqual({
      renewalInvoicesCreated: 0,
      remindersQueued: 0,
      lapsed: 1,
      failed: 0,
    });
    expect(await invoicesOf(alice)).toHaveLength(1);
    const [bobSub] = await db
      .select({ endedAt: personSubscriptions.endedAt })
      .from(personSubscriptions)
      .where(and(eq(personSubscriptions.payerAccountId, bob)));
    expect(bobSub?.endedAt).not.toBeNull();
  });

  it('never lapses a plan while a payment on its renewal is on its way', async () => {
    await paidPeriod(alice, -6);
    await run(new Date());
    const renewal = (await invoicesOf(alice))[1];
    if (!renewal) throw new Error('renewal');
    await startPersonPayment(db, onePort(port), self(alice), {
      invoiceId: renewal.id,
      urlFor,
      startAnother: false,
    });
    const waiting = await run(new Date(Date.now() + 2 * DAY));
    expect(waiting.travellerPlans.lapsed).toBe(0);
    expect((await invoicesOf(alice))[1]?.status).toBe('OPEN');
    // Once the payment is over without money, the plan lapses on the next run.
    await db.execute(
      sql`update payment_attempts set status = 'EXPIRED' where invoice_id = ${renewal.id}::uuid`,
    );
    expect((await run(new Date(Date.now() + 2 * DAY))).travellerPlans.lapsed).toBe(1);
  });

  it('counts reminder days on the Bangladesh calendar, like agency reminders', async () => {
    // Ends 10 Nov at 10:00 in Bangladesh: on 9 Nov at 12:15 there is still a day to go.
    const end = new Date('2026-11-10T04:00:00Z');
    await paidPeriod(alice, 0, end);
    await run(new Date('2026-11-09T06:15:00Z'));
    await run(new Date('2026-11-10T01:00:00Z'));
    const stages = (await notices(alice))
      .filter((n) => n.event_type === 'PERSON_PLAN_RENEWAL_DUE' && n.channel === 'IN_APP')
      .map((n) => n.idempotency_key.split(':').pop());
    expect(stages).toEqual(['d3', 'd0']);
    const [today] = await rows<{ payload: { subject: string } }>(
      sql`select payload from notifications where idempotency_key like '%:d0' and channel = 'IN_APP'`,
    );
    expect(today?.payload.subject).toBe('Traveller Plus ends today');
  });

  it('treats a refunded renewal as never paid: the plan still lapses, with no more reminders', async () => {
    await paidPeriod(alice, 3);
    await run(new Date());
    const renewal = (await invoicesOf(alice))[1];
    if (!renewal) throw new Error('renewal');
    expect(await payInvoice(alice, renewal.id)).toBe('recorded');
    await db.insert(schema.invoicePayments).values({
      invoiceId: renewal.id,
      amountMinorUnits: -PRICE,
      currency: 'BDT',
      kind: 'REFUND',
      sourceId: '00000000-0000-4000-8000-00000000f00d',
      reference: 'RF-RENEW-1',
      collectedDate: new Date(),
      mode: 'LIVE',
    });
    await db
      .update(personInvoices)
      .set({ status: 'OPEN', collectedAmountMinorUnits: 0 })
      .where(eq(personInvoices.id, renewal.id));
    const later = new Date(Date.now() + 11 * DAY);
    const summary = await run(later);
    expect(summary.travellerPlans).toMatchObject({
      lapsed: 1,
      renewalInvoicesCreated: 0,
      failed: 0,
    });
    // The refunded invoice keeps its own record (never voided over it).
    expect((await invoicesOf(alice))[1]?.status).toBe('OPEN');
  });

  it('makes no renewal for a plan no longer offered, and says it is not renewable', async () => {
    await paidPeriod(alice, 5);
    await db.update(schema.plans).set({ active: false }).where(eq(schema.plans.id, planId));
    expect((await run(new Date())).travellerPlans.renewalInvoicesCreated).toBe(0);
    expect(await getOwnRenewal(db, self(alice))).toMatchObject({
      renewable: false,
      openRenewal: null,
    });
  });

  it('turns renewing back on when the same plan is bought again after Stop Renewing', async () => {
    await paidPeriod(alice, -2);
    await setPlanRenewal(db, self(alice), { renews: false });
    const again = await startPersonCheckout(db, self(alice), { planId });
    if (!isOk(again)) throw new Error('checkout');
    expect(await payInvoice(alice, again.value.invoiceId)).toBe('recorded');
    const [sub] = await db
      .select({ renews: personSubscriptions.renews, endedAt: personSubscriptions.endedAt })
      .from(personSubscriptions)
      .where(eq(personSubscriptions.payerAccountId, alice));
    expect(sub).toEqual({ renews: true, endedAt: null });
  });

  it('cancels a renewal left open on a plan that is no longer theirs', async () => {
    await paidPeriod(alice, 5);
    await run(new Date());
    const renewal = (await invoicesOf(alice))[1];
    await db
      .update(personSubscriptions)
      .set({ endedAt: new Date() })
      .where(eq(personSubscriptions.payerAccountId, alice));
    await run(new Date());
    expect((await invoicesOf(alice)).find((i) => i.id === renewal?.id)?.status).toBe('VOID');
    const due = (await notices(alice)).filter((n) => n.event_type === 'PERSON_PLAN_RENEWAL_DUE');
    expect(due.every((n) => n.status === 'CANCELLED')).toBe(true);
  });

  it('gives a renewal a lower price at once', async () => {
    await paidPeriod(alice, 5);
    await db.insert(schema.planPrices).values({
      planId,
      priceMinorUnits: 29_900,
      currency: 'BDT',
      effectiveFrom: new Date(Date.now() - DAY),
    });
    await run(new Date());
    expect((await invoicesOf(alice))[1]?.amount).toBe(29_900);
  });

  it('says Paid until the end of a renewal paid ahead', async () => {
    const end = await paidPeriod(alice, 5);
    await run(new Date());
    const renewal = (await invoicesOf(alice))[1];
    if (!renewal) throw new Error('renewal');
    expect(await payInvoice(alice, renewal.id)).toBe('recorded');
    const summary = await getTravellerPlanSummary(db, { actorAccountId: alice });
    expect(summary.paidUntil?.getTime()).toBe(end.getTime() + 30 * DAY - 1);
  });
});
