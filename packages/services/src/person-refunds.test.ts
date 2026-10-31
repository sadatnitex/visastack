import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selfPrincipal, staffPrincipal } from './access/principal';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import { runBillingCycle } from './billing-cycle';
import type { Db } from './db';
import { settlePaymentAttempt, startPersonPayment } from './payments';
import { FakePaymentPort, onePort } from './payments.test-support';
import { referenceCode, startPersonCheckout } from './person-billing';
import { getTravellerBilling, listTravellerNeedsCheck } from './person-billing-admin';
import { listOwnBilling } from './person-billing-history';
import {
  personInvoices,
  personPaymentAttempts,
  personRefundRequests,
  personSubscriptions,
} from './person-billing-tables';
import { grantPlatformRole } from './platform-roles';
import {
  PERSON_REFUNDS_UNAVAILABLE,
  REFERENCE_TAKEN,
  recordManualRefund,
  recordPersonRefund,
} from './refunds';
import { coveringPaidPeriod } from './traveller-billing';

/**
 * ADR 0025 T6 (D8): the platform owner records a traveller's full refund made in the gateway
 * panel. Never above what was paid, recorded once however often it is sent, only ever the
 * payer's own money, and refunding the period that covers today ends the plan at once.
 */

const OWNER_EMAIL = 'owner-person-refund@platform.example.com';
const PRICE = 49_900;
const DAY = 24 * 60 * 60 * 1000;
const urlFor = (kind: string, tran: string) => `https://app.example.test/pay/${kind}?t=${tran}`;

let db: Db;
let port: FakePaymentPort;
let planId: string;
let owner: string;
let alice: string;
let bob: string;

async function account(email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!isOk(made)) throw new Error('provision');
  return made.value.id;
}

const self = (accountId: string) => selfPrincipal(accountId);

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows;
}

async function ownerScope() {
  const minted = await staffPrincipal(
    db,
    { accountId: owner, email: OWNER_EMAIL, bootstrapEmails: [] },
    'BILLING_REFUND_MANAGE',
  );
  if (!isOk(minted)) throw new Error('scope');
  return minted.value;
}

beforeEach(async () => {
  vi.stubEnv('TRAVELLER_PLANS_ENABLED', 'true');
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  port = new FakePaymentPort();
  owner = await account(OWNER_EMAIL);
  const granted = await grantPlatformRole(db, {
    actor: { accountId: owner, email: OWNER_EMAIL, bootstrapEmails: [OWNER_EMAIL] },
    targetAccountId: owner,
    role: 'PLATFORM_OWNER',
    reason: 'seed',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
  const [plan] = await db
    .insert(schema.plans)
    .values({ key: 'traveller_plus_refund', name: 'Traveller Plus', audience: 'TRAVELLER' })
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
  alice = await account('alice-refund@example.com');
  bob = await account('bob-refund@example.com');
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Starts and settles one online payment on `invoiceId`; returns the attempt and the outcome code. */
async function payOnce(accountId: string, invoiceId: string, startAnother = false) {
  const started = await startPersonPayment(db, onePort(port), self(accountId), {
    invoiceId,
    urlFor,
    startAnother,
  });
  if (!isOk(started) || started.value.kind !== 'redirect') throw new Error('start');
  const [attempt] = await db
    .select()
    .from(personPaymentAttempts)
    .where(eq(personPaymentAttempts.id, started.value.attemptId));
  if (!attempt) throw new Error('attempt');
  const paid = port.succeed(attempt.merchantTranId, attempt.amountMinorUnits);
  const settled = await settlePaymentAttempt(db, port, {
    merchantTranId: attempt.merchantTranId,
    valId: paid.valId,
    source: 'ipn',
  });
  return { attempt, code: settled.code };
}

async function buy(accountId: string) {
  const made = await startPersonCheckout(db, self(accountId), { planId });
  if (!isOk(made)) throw new Error(`checkout: ${made.error.message}`);
  expect((await payOnce(accountId, made.value.invoiceId)).code).toBe('recorded');
  return made.value.invoiceId;
}

async function entryOf(invoiceId: string) {
  const [entry] = await db
    .select()
    .from(schema.invoicePayments)
    .where(
      and(
        eq(schema.invoicePayments.invoiceId, invoiceId),
        eq(schema.invoicePayments.kind, 'ONLINE'),
      ),
    );
  if (!entry) throw new Error('entry');
  return entry;
}

function refundOf(
  source: { kind: 'entry'; invoicePaymentId: string } | { kind: 'held'; paymentAttemptId: string },
  overrides: Partial<Parameters<typeof recordPersonRefund>[2]> = {},
) {
  return {
    source,
    expectedAmountMinorUnits: PRICE,
    reference: `RF-${Math.random().toString(36).slice(2, 10)}`,
    refundedOn: new Date(),
    reason: 'Asked within 7 days',
    idempotencyKey: crypto.randomUUID(),
    stepUpSatisfied: true,
    ...overrides,
  };
}

describe("a traveller's full refund, recorded by the platform owner (ADR 0025 T6)", () => {
  it('records it once, naming the person, ends the plan at once, and tells them without an amount', async () => {
    const invoiceId = await buy(alice);
    const staff = await ownerScope();
    const found = await getTravellerBilling(db, staff, { code: referenceCode(alice) });
    if (!isOk(found)) throw new Error('lookup');
    const person = found.value.people[0];
    expect(found.value.refundsAvailable).toBe(true);
    expect(person?.payments[0]?.refundableMinorUnits).toBe(PRICE);
    expect(person?.plan).toMatchObject({ planName: 'Traveller Plus', renews: true });
    // Nothing that names the person.
    expect(JSON.stringify(found.value)).not.toMatch(
      /@|alice|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?!")/i,
    );

    const entry = await entryOf(invoiceId);
    const input = refundOf({ kind: 'entry', invoicePaymentId: entry.id });
    const done = await recordPersonRefund(db, staff, input);
    expect(isOk(done) && done.value).toMatchObject({
      code: 'recorded',
      amountMinorUnits: PRICE,
      outsideWindow: false,
    });
    const [request] = await db.select().from(personRefundRequests);
    expect(request).toMatchObject({
      organizationId: null,
      payerAccountId: alice,
      method: 'MANUAL',
      status: 'CONFIRMED',
      amountMinorUnits: PRICE,
    });
    const refunds = await db
      .select()
      .from(schema.invoicePayments)
      .where(eq(schema.invoicePayments.kind, 'REFUND'));
    expect(refunds.map((r) => r.amountMinorUnits)).toEqual([-PRICE]);
    // Plus ends now: nothing paid covers them, and their plan has ended.
    expect(await coveringPaidPeriod(db, alice, new Date())).toBeUndefined();
    const [sub] = await db
      .select({ endedAt: personSubscriptions.endedAt })
      .from(personSubscriptions)
      .where(eq(personSubscriptions.payerAccountId, alice));
    expect(sub?.endedAt).not.toBeNull();
    // Their Billing History reads Refunded, with no refund offered.
    const history = await listOwnBilling(db, self(alice));
    expect(isOk(history) && history.value[0]).toMatchObject({
      status: 'refunded',
      refundableUntil: null,
    });
    const notices = await rows<{ payload: { summary: string } }>(
      sql`select payload from notifications where event_type = 'PERSON_REFUND_RECORDED' and recipient_account_id = ${alice}::uuid`,
    );
    expect(notices).toHaveLength(2);
    expect(notices[0]?.payload.summary).not.toMatch(/499|BDT|৳/);

    // Sent again with the same key: once.
    const again = await recordPersonRefund(db, staff, input);
    expect(isOk(again) && again.value.code).toBe('already_recorded');
    expect(await db.select().from(personRefundRequests)).toHaveLength(1);
    // They can buy again.
    expect(isOk(await startPersonCheckout(db, self(alice), { planId }))).toBe(true);
  });

  it('never gives back more than was paid: a stale amount, a second refund, two at once', async () => {
    const invoiceId = await buy(alice);
    const staff = await ownerScope();
    const entry = await entryOf(invoiceId);
    const source = { kind: 'entry' as const, invoicePaymentId: entry.id };
    const stale = await recordPersonRefund(
      db,
      staff,
      refundOf(source, { expectedAmountMinorUnits: PRICE + 1 }),
    );
    expect(isErr(stale) && stale.error.message).toMatch(/out of date/);
    const [one, two] = await Promise.all([
      recordPersonRefund(db, staff, refundOf(source)),
      recordPersonRefund(db, staff, refundOf(source)),
    ]);
    expect([one, two].filter((r) => isOk(r))).toHaveLength(1);
    const later = await recordPersonRefund(db, staff, refundOf(source));
    expect(isErr(later) && later.error.reason).toBe('amount_over_balance');
    expect(await db.select().from(personRefundRequests)).toHaveLength(1);
    const collected = await db
      .select({ c: personInvoices.collectedAmountMinorUnits })
      .from(personInvoices)
      .where(eq(personInvoices.id, invoiceId));
    expect(collected[0]?.c).toBe(0);
  });

  it('refuses a panel reference already used, and asks for a fresh sign-in', async () => {
    const staff = await ownerScope();
    const a = await entryOf(await buy(alice));
    const b = await entryOf(await buy(bob));
    expect(
      isOk(
        await recordPersonRefund(
          db,
          staff,
          refundOf({ kind: 'entry', invoicePaymentId: a.id }, { reference: 'PANEL-1' }),
        ),
      ),
    ).toBe(true);
    const taken = await recordPersonRefund(
      db,
      staff,
      refundOf({ kind: 'entry', invoicePaymentId: b.id }, { reference: ' panel-1 ' }),
    );
    expect(isErr(taken) && taken.error.message).toBe(REFERENCE_TAKEN);
    const noStepUp = await recordPersonRefund(
      db,
      staff,
      refundOf({ kind: 'entry', invoicePaymentId: b.id }, { stepUpSatisfied: false }),
    );
    expect(isErr(noStepUp) && noStepUp.error.code).toBe('step_up_required');
  });

  it("keeps people apart: one code shows only that person's money, and agency refunds never reach it", async () => {
    await buy(alice);
    const bobEntry = await entryOf(await buy(bob));
    const staff = await ownerScope();
    const found = await getTravellerBilling(db, staff, { code: referenceCode(alice) });
    if (!isOk(found)) throw new Error('lookup');
    expect(found.value.people).toHaveLength(1);
    expect(found.value.people[0]?.payments.map((p) => p.id)).not.toContain(bobEntry.id);
    // A purchase reference finds its own person only.
    const [bobInvoice] = await db
      .select({ ref: personInvoices.invoiceRef })
      .from(personInvoices)
      .where(eq(personInvoices.payerAccountId, bob));
    const byRef = await getTravellerBilling(db, staff, { code: bobInvoice?.ref ?? '' });
    expect(isOk(byRef) && byRef.value.people.map((p) => p.shortCode)).toEqual([referenceCode(bob)]);
    // An agency refund path never finds a person's payment.
    const agency = await recordManualRefund(db, staff, {
      organizationId: crypto.randomUUID(),
      source: { kind: 'entry', invoicePaymentId: bobEntry.id },
      amountMinorUnits: PRICE,
      reference: 'AGENCY-1',
      refundedOn: new Date(),
      reason: 'wrong path',
      idempotencyKey: crypto.randomUUID(),
      stepUpSatisfied: true,
    });
    expect(isErr(agency) && agency.error.code).toBe('not_found');
    // Someone without the owner's role sees nothing and records nothing.
    const staffer = await account('staff-refund@example.com');
    const notOwner = await staffPrincipal(
      db,
      { accountId: staffer, email: 'staff-refund@example.com', bootstrapEmails: [] },
      'BILLING_REFUND_MANAGE',
    );
    expect(isOk(notOwner)).toBe(false);
    expect(await db.select().from(personRefundRequests)).toHaveLength(0);
  });

  it('refunds a held payment in full, closes it, and leaves the plan alone', async () => {
    const made = await startPersonCheckout(db, self(alice), { planId });
    if (!isOk(made)) throw new Error('checkout');
    // Two tabs both paying one purchase: the second payment is held, never counted.
    const start = async (startAnother: boolean) => {
      const started = await startPersonPayment(db, onePort(port), self(alice), {
        invoiceId: made.value.invoiceId,
        urlFor,
        startAnother,
      });
      if (!isOk(started) || started.value.kind !== 'redirect') throw new Error('start');
      const [attempt] = await db
        .select()
        .from(personPaymentAttempts)
        .where(eq(personPaymentAttempts.id, started.value.attemptId));
      if (!attempt) throw new Error('attempt');
      return attempt;
    };
    const one = await start(false);
    const two = await start(true);
    const settle = async (attempt: typeof one) => {
      const paid = port.succeed(attempt.merchantTranId, attempt.amountMinorUnits);
      return (
        await settlePaymentAttempt(db, port, {
          merchantTranId: attempt.merchantTranId,
          valId: paid.valId,
          source: 'ipn',
        })
      ).code;
    };
    expect(await settle(one)).toBe('recorded');
    expect(await settle(two)).toBe('held');
    const second = { attempt: two };
    const staff = await ownerScope();
    const needs = await listTravellerNeedsCheck(db, staff);
    expect(isOk(needs) && needs.value.map((n) => n.paymentAttemptId)).toEqual([second.attempt.id]);
    const done = await recordPersonRefund(
      db,
      staff,
      refundOf({ kind: 'held', paymentAttemptId: second.attempt.id }),
    );
    expect(isOk(done)).toBe(true);
    const [attempt] = await db
      .select({ status: personPaymentAttempts.status })
      .from(personPaymentAttempts)
      .where(eq(personPaymentAttempts.id, second.attempt.id));
    expect(attempt?.status).toBe('REFUNDED');
    expect(await coveringPaidPeriod(db, alice, new Date())).toBeDefined();
    const after = await listTravellerNeedsCheck(db, staff);
    expect(isOk(after) && after.value).toEqual([]);
  });

  it('refunding a renewal paid ahead keeps today’s period and stops renewing', async () => {
    const invoiceId = await buy(alice);
    const end = new Date(Date.now() + 5 * DAY);
    await db
      .update(personInvoices)
      .set({ periodStart: new Date(end.getTime() - 30 * DAY), periodEnd: end })
      .where(eq(personInvoices.id, invoiceId));
    await runBillingCycle(db, systemScopeForTest('process-billing-cycle'), { now: new Date() });
    const [renewal] = await db
      .select({ id: personInvoices.id })
      .from(personInvoices)
      .where(and(eq(personInvoices.payerAccountId, alice), eq(personInvoices.periodStart, end)));
    if (!renewal) throw new Error('renewal');
    expect((await payOnce(alice, renewal.id)).code).toBe('recorded');
    const staff = await ownerScope();
    const done = await recordPersonRefund(
      db,
      staff,
      refundOf({ kind: 'entry', invoicePaymentId: (await entryOf(renewal.id)).id }),
    );
    expect(isOk(done)).toBe(true);
    const covering = await coveringPaidPeriod(db, alice, new Date());
    expect(covering?.periodEnd.getTime()).toBe(end.getTime());
    const [sub] = await db
      .select({ endedAt: personSubscriptions.endedAt, renews: personSubscriptions.renews })
      .from(personSubscriptions)
      .where(eq(personSubscriptions.payerAccountId, alice));
    expect(sub).toEqual({ endedAt: null, renews: false });
    // The next run makes nothing for the refunded period and does not fail.
    const run = await runBillingCycle(db, systemScopeForTest('process-billing-cycle'), {
      now: new Date(),
    });
    expect(run.travellerPlans).toMatchObject({ renewalInvoicesCreated: 0, failed: 0 });
  });

  it('records nothing before migration 0112 has run', async () => {
    const entry = await entryOf(await buy(alice));
    // The guard as migration 0104 left it, without the payer.
    const [guard] = await rows<{ body: string }>(
      sql`select prosrc as body from pg_proc where proname = 'visastack_refund_requests_guard'`,
    );
    const older = (guard?.body ?? '').replace(
      /\s*OR NEW\."payer_account_id" IS DISTINCT FROM OLD\."payer_account_id"/,
      '',
    );
    expect(older).not.toContain('payer_account_id');
    await db.execute(
      sql.raw(
        `CREATE OR REPLACE FUNCTION "visastack_refund_requests_guard"() RETURNS trigger LANGUAGE plpgsql AS $fn$${older}$fn$;`,
      ),
    );
    const staff = await ownerScope();
    const found = await getTravellerBilling(db, staff, { code: referenceCode(alice) });
    expect(isOk(found) && found.value.refundsAvailable).toBe(false);
    const refused = await recordPersonRefund(
      db,
      staff,
      refundOf({ kind: 'entry', invoicePaymentId: entry.id }),
    );
    expect(isErr(refused) && refused.error.message).toBe(PERSON_REFUNDS_UNAVAILABLE);
    expect(await db.select().from(personRefundRequests)).toHaveLength(0);
  });

  it('allows a refund recorded after the 7 days, and says so', async () => {
    const invoiceId = await buy(alice);
    const entry = await entryOf(invoiceId);
    const staff = await ownerScope();
    const done = await recordPersonRefund(
      db,
      staff,
      refundOf(
        { kind: 'entry', invoicePaymentId: entry.id },
        { now: new Date(Date.now() + 9 * DAY), refundedOn: new Date(Date.now() + 8 * DAY) },
      ),
    );
    expect(isOk(done) && done.value.outsideWindow).toBe(true);
    const audit = await rows<{ metadata: { outsideRefundWindow: boolean } }>(
      sql`select metadata from audit_events where event_type = 'INVOICE_REFUND_RECORDED'`,
    );
    expect(audit[0]?.metadata.outsideRefundWindow).toBe(true);
  });

  it('cancels the waiting renewal and its reminders when the refund ends the plan', async () => {
    const invoiceId = await buy(alice);
    const end = new Date(Date.now() + 5 * DAY);
    await db
      .update(personInvoices)
      .set({ periodStart: new Date(end.getTime() - 30 * DAY), periodEnd: end })
      .where(eq(personInvoices.id, invoiceId));
    await runBillingCycle(db, systemScopeForTest('process-billing-cycle'), { now: new Date() });
    const [renewal] = await db
      .select({ id: personInvoices.id })
      .from(personInvoices)
      .where(and(eq(personInvoices.payerAccountId, alice), eq(personInvoices.periodStart, end)));
    if (!renewal) throw new Error('renewal');
    const staff = await ownerScope();
    const done = await recordPersonRefund(
      db,
      staff,
      refundOf({ kind: 'entry', invoicePaymentId: (await entryOf(invoiceId)).id }),
    );
    expect(isOk(done)).toBe(true);
    const [after] = await db
      .select({ status: personInvoices.status })
      .from(personInvoices)
      .where(eq(personInvoices.id, renewal.id));
    expect(after?.status).toBe('VOID');
    const queued = await rows<{ n: number }>(
      sql`select count(*)::int as n from notifications where resource_id = ${renewal.id} and status = 'QUEUED'`,
    );
    expect(queued[0]?.n).toBe(0);
    const [sub] = await db
      .select({ endedAt: personSubscriptions.endedAt })
      .from(personSubscriptions)
      .where(eq(personSubscriptions.payerAccountId, alice));
    expect(sub?.endedAt).not.toBeNull();
    const [notice] = await rows<{ payload: { summary: string } }>(
      sql`select payload from notifications where event_type = 'PERSON_REFUND_RECORDED' limit 1`,
    );
    expect(notice?.payload.summary).toContain('Your paid plan has ended');
  });

  it('keeps the plan while a renewal is being paid, so that payment still buys its period', async () => {
    const invoiceId = await buy(alice);
    const end = new Date(Date.now() + 5 * DAY);
    await db
      .update(personInvoices)
      .set({ periodStart: new Date(end.getTime() - 30 * DAY), periodEnd: end })
      .where(eq(personInvoices.id, invoiceId));
    await runBillingCycle(db, systemScopeForTest('process-billing-cycle'), { now: new Date() });
    const [renewal] = await db
      .select({ id: personInvoices.id })
      .from(personInvoices)
      .where(and(eq(personInvoices.payerAccountId, alice), eq(personInvoices.periodStart, end)));
    if (!renewal) throw new Error('renewal');
    // The person is at the payment page for the renewal.
    const started = await startPersonPayment(db, onePort(port), self(alice), {
      invoiceId: renewal.id,
      urlFor,
      startAnother: false,
    });
    if (!isOk(started) || started.value.kind !== 'redirect') throw new Error('start');
    const staff = await ownerScope();
    expect(
      isOk(
        await recordPersonRefund(
          db,
          staff,
          refundOf({ kind: 'entry', invoicePaymentId: (await entryOf(invoiceId)).id }),
        ),
      ),
    ).toBe(true);
    const [kept] = await db
      .select({ endedAt: personSubscriptions.endedAt, renews: personSubscriptions.renews })
      .from(personSubscriptions)
      .where(eq(personSubscriptions.payerAccountId, alice));
    expect(kept).toEqual({ endedAt: null, renews: false });
    // The payment completes: it is recorded and covers its own period.
    const [attempt] = await db
      .select()
      .from(personPaymentAttempts)
      .where(eq(personPaymentAttempts.id, started.value.attemptId));
    if (!attempt) throw new Error('attempt');
    const paid = port.succeed(attempt.merchantTranId, attempt.amountMinorUnits);
    const settled = await settlePaymentAttempt(db, port, {
      merchantTranId: attempt.merchantTranId,
      valId: paid.valId,
      source: 'ipn',
    });
    expect(settled.code).toBe('recorded');
    const covered = await coveringPaidPeriod(db, alice, new Date(end.getTime() + DAY));
    expect(covered?.periodStart.getTime()).toBe(end.getTime());
  });

  it('labels a purchase a renewal only when it follows an earlier period of the plan', async () => {
    const invoiceId = await buy(alice);
    const end = new Date(Date.now() + 5 * DAY);
    await db
      .update(personInvoices)
      .set({ periodStart: new Date(end.getTime() - 30 * DAY), periodEnd: end })
      .where(eq(personInvoices.id, invoiceId));
    await runBillingCycle(db, systemScopeForTest('process-billing-cycle'), { now: new Date() });
    const staff = await ownerScope();
    const found = await getTravellerBilling(db, staff, { code: referenceCode(alice) });
    if (!isOk(found)) throw new Error('lookup');
    const byRenewal = new Map(found.value.people[0]?.invoices.map((i) => [i.id, i.renewal]));
    expect(byRenewal.get(invoiceId)).toBe(false);
    expect([...byRenewal.values()].filter(Boolean)).toHaveLength(1);
  });
});
