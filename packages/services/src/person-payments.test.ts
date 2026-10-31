import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selfPrincipal } from './access/principal';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import { resolveEntitlements } from './entitlements';
import { applyInvoiceCollection } from './invoice-ledger';
import {
  getPaymentResultView,
  reconcilePaymentAttempts,
  settlePaymentAttempt,
  startOnlinePayment,
  startPersonPayment,
} from './payments';
import { FakePaymentPort, onePort } from './payments.test-support';
import { startPersonCheckout } from './person-billing';
import {
  personInvoices,
  personPaymentAttempts,
  personPaymentReceipts,
} from './person-billing-tables';
import { grantPlatformRole } from './platform-roles';

/**
 * ADR 0025 T3b: a person buys a paid traveller plan and pays for it online. The ADR 0020 security
 * rules, for persons: nobody reads, pays or confirms anyone else's purchase; one payment is
 * counted once however often the gateway reports it; two tabs make one purchase; a changed amount
 * or a forged report records nothing; in test mode only the platform owner pays; selling waits
 * for the switch.
 */

const OWNER_EMAIL = 'owner-person-pay@platform.example.com';
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
const resolver = () => onePort(port);

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows;
}

beforeEach(async () => {
  vi.stubEnv('TRAVELLER_PLANS_ENABLED', 'true');
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  port = new FakePaymentPort();
  const owner = await account(OWNER_EMAIL);
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
    .values({
      key: 'traveller_plus_pay',
      name: 'Traveller Plus',
      audience: 'TRAVELLER',
      periodDays: 30,
    })
    .returning({ id: schema.plans.id });
  if (!plan) throw new Error('plan');
  planId = plan.id;
  await db.insert(schema.planPrices).values({
    planId,
    priceMinorUnits: PRICE,
    currency: 'BDT',
    effectiveFrom: new Date('2001-01-01T00:00:00Z'),
  });
  await db.insert(schema.planEntitlements).values({
    planId,
    key: 'person_storage_bytes',
    included: true,
    limitValue: 500 * 1024 * 1024,
    per: 'TOTAL',
  });
  alice = await account('alice@example.com');
  bob = await account('bob@example.com');
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

async function checkout(accountId: string) {
  const made = await startPersonCheckout(db, self(accountId), { planId });
  if (!isOk(made)) throw new Error(`checkout: ${made.error.message}`);
  return made.value;
}

async function pay(accountId: string, invoiceId: string, startAnother = false) {
  const started = await startPersonPayment(db, resolver(), self(accountId), {
    invoiceId,
    urlFor,
    startAnother,
  });
  if (!isOk(started) || started.value.kind !== 'redirect') {
    throw new Error(`start: ${isErr(started) ? started.error.message : started.value.kind}`);
  }
  const attempt = (
    await db
      .select()
      .from(personPaymentAttempts)
      .where(eq(personPaymentAttempts.id, started.value.attemptId))
  )[0];
  if (!attempt) throw new Error('attempt');
  return attempt;
}

const settle = (tran: string, valId: string | null, source: 'ipn' | 'return' = 'ipn') =>
  settlePaymentAttempt(db, port, { merchantTranId: tran, valId, source });

describe('buying a paid traveller plan (ADR 0025 T3b)', () => {
  it('makes one purchase invoice in BDT for the plan period, paid by the person only', async () => {
    const made = await checkout(alice);
    expect(made).toMatchObject({ amountMinorUnits: PRICE, currency: 'BDT', reused: false });
    expect(made.periodEnd.getTime() - made.periodStart.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(made.invoiceRef).toMatch(/^TP-[0-9A-F]{8}-1$/);
    const [row] = await db
      .select()
      .from(personInvoices)
      .where(eq(personInvoices.id, made.invoiceId));
    expect(row).toMatchObject({ payerAccountId: alice, organizationId: null, status: 'OPEN' });
  });

  it('gives a second tab the same invoice, and refuses a plan that is not for sale', async () => {
    const first = await checkout(alice);
    const again = await checkout(alice);
    expect(again).toMatchObject({ invoiceId: first.invoiceId, reused: true });
    const free = (
      await db
        .select({ id: schema.plans.id })
        .from(schema.plans)
        .where(eq(schema.plans.key, 'traveller_free'))
    )[0];
    const refused = await startPersonCheckout(db, self(alice), { planId: free?.id ?? '' });
    expect(isErr(refused) && refused.error.reason).toBe('plan_not_for_sale');
  });

  it('is refused while selling is switched off, and starts no payment', async () => {
    const made = await checkout(alice);
    vi.stubEnv('TRAVELLER_PLANS_ENABLED', 'false');
    const refusedCheckout = await startPersonCheckout(db, self(alice), { planId });
    expect(isErr(refusedCheckout) && refusedCheckout.error.reason).toBe('selling_off');
    const refusedPay = await startPersonPayment(db, resolver(), self(alice), {
      invoiceId: made.invoiceId,
      urlFor,
    });
    expect(isErr(refusedPay) && refusedPay.error.reason).toBe('selling_off');
    expect(port.checkouts).toHaveLength(0);
  });
});

describe("nobody touches another person's purchase (ADR 0020 for persons)", () => {
  it("reads another person's invoice as not found, for a person and for the agency payment", async () => {
    const made = await checkout(alice);
    const asBob = await startPersonPayment(db, resolver(), self(bob), {
      invoiceId: made.invoiceId,
      urlFor,
    });
    expect(isErr(asBob) && asBob.error.code).toBe('not_found');
    const viaAgency = await startOnlinePayment(db, resolver(), {
      actorAccountId: alice,
      invoiceId: made.invoiceId,
      urlFor,
    });
    expect(isErr(viaAgency) && viaAgency.error.code).toBe('not_found');
    expect(port.checkouts).toHaveLength(0);
  });

  it('refuses a scope that is not the genuine one minted for the session', async () => {
    const made = await checkout(alice);
    const forged = { ...self(alice) } as unknown as ReturnType<typeof selfPrincipal>;
    const result = await startPersonPayment(db, resolver(), forged, {
      invoiceId: made.invoiceId,
      urlFor,
    });
    expect(isErr(result) && result.error.code).toBe('forbidden');
  });
});

describe('a payment is counted once, and gives the plan for the period paid (ADR 0025)', () => {
  it('records the payment, a numbered receipt and the plan, once however often it is reported', async () => {
    const made = await checkout(alice);
    const attempt = await pay(alice, made.invoiceId);
    expect(port.checkouts[0]).toMatchObject({ amountMinorUnits: PRICE, currency: 'BDT' });
    expect(port.checkouts[0]?.customer).toEqual({ name: 'alice', email: 'alice@example.com' });
    const paid = port.succeed(attempt.merchantTranId, PRICE);
    const first = await settle(attempt.merchantTranId, paid.valId, 'ipn');
    expect(first.code).toBe('recorded');
    expect(await getPaymentResultView(db, attempt.merchantTranId)).toMatchObject({
      state: 'received',
      payer: 'person',
      amountMinorUnits: PRICE,
    });
    // The same report again, the return page, and the daily check: nothing more is written.
    expect((await settle(attempt.merchantTranId, paid.valId, 'ipn')).code).toBe('already_recorded');
    expect((await settle(attempt.merchantTranId, paid.valId, 'return')).code).toBe(
      'already_recorded',
    );
    await reconcilePaymentAttempts(
      db,
      systemScopeForTest('process-payment-reconciliation'),
      resolver(),
    );

    expect(await db.select().from(schema.invoicePayments)).toHaveLength(1);
    const receipts = await db
      .select()
      .from(personPaymentReceipts)
      .where(eq(personPaymentReceipts.payerAccountId, alice));
    expect(receipts.map((r) => r.receiptNumber)).toEqual([1]);
    const subs = await rows<{ id: string; plan_id: string }>(
      sql`select id, plan_id from subscriptions where payer_account_id = ${alice}::uuid and ended_at is null`,
    );
    expect(subs).toHaveLength(1);
    expect(subs[0]?.plan_id).toBe(planId);
    const [invoice] = await db
      .select()
      .from(personInvoices)
      .where(eq(personInvoices.id, made.invoiceId));
    expect(invoice).toMatchObject({ status: 'PAID', subscriptionId: subs[0]?.id });

    // The resolver gives the plan now; Bob is untouched.
    expect((await resolveEntitlements(db, { accountId: alice })).plan?.key).toBe(
      'traveller_plus_pay',
    );
    expect((await resolveEntitlements(db, { accountId: bob })).plan?.key).toBe('traveller_free');
    // A covered person cannot buy the same period again.
    const again = await startPersonCheckout(db, self(alice), { planId });
    expect(isErr(again) && again.error.reason).toBe('already_covered');
  });

  it('holds a second payment for a period already paid (two tabs both paying), never counting it', async () => {
    const made = await checkout(alice);
    const one = await pay(alice, made.invoiceId);
    const two = await pay(alice, made.invoiceId, true);
    const paidOne = port.succeed(one.merchantTranId, PRICE);
    const paidTwo = port.succeed(two.merchantTranId, PRICE);
    expect((await settle(one.merchantTranId, paidOne.valId)).code).toBe('recorded');
    expect((await settle(two.merchantTranId, paidTwo.valId)).code).toBe('held');
    const [held] = await db
      .select()
      .from(personPaymentAttempts)
      .where(eq(personPaymentAttempts.id, two.id));
    expect(held).toMatchObject({ status: 'HELD_FOR_REVIEW', reasonCode: 'already_paid' });
    expect(await db.select().from(schema.invoicePayments)).toHaveLength(1);
  });

  it('holds money for a period another paid invoice covers (two invoices, both paid)', async () => {
    const first = await checkout(alice);
    // A second purchase invoice for an overlapping period, as an older open one would be.
    await db
      .update(personInvoices)
      .set({ periodStart: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
      .where(eq(personInvoices.id, first.invoiceId));
    const second = await checkout(alice);
    expect(second.invoiceId).not.toBe(first.invoiceId);
    const a = await pay(alice, first.invoiceId);
    const b = await pay(alice, second.invoiceId);
    const paidA = port.succeed(a.merchantTranId, PRICE);
    const paidB = port.succeed(b.merchantTranId, PRICE);
    expect((await settle(a.merchantTranId, paidA.valId)).code).toBe('recorded');
    expect((await settle(b.merchantTranId, paidB.valId)).code).toBe('held');
    const [held] = await db
      .select()
      .from(personPaymentAttempts)
      .where(eq(personPaymentAttempts.id, b.id));
    expect(held).toMatchObject({ status: 'HELD_FOR_REVIEW', reasonCode: 'already_covered' });
    const subs = await rows<{ n: number }>(
      sql`select count(*)::int as n from subscriptions where payer_account_id = ${alice}::uuid`,
    );
    expect(subs[0]?.n).toBe(1);
  });

  it('records nothing for a changed amount, another store, or a report for an unknown payment', async () => {
    const made = await checkout(alice);
    const attempt = await pay(alice, made.invoiceId);
    const short = port.succeed(attempt.merchantTranId, PRICE - 100);
    expect((await settle(attempt.merchantTranId, short.valId)).code).toBe('held');
    const other = await checkout(bob);
    const bobAttempt = await pay(bob, other.invoiceId);
    const store = port.succeed(bobAttempt.merchantTranId, PRICE, { storeId: 'another-store' });
    expect((await settle(bobAttempt.merchantTranId, store.valId)).code).not.toBe('recorded');
    expect((await settle('VSP000000000000000000000ZZ', 'VALFORGED')).code).not.toBe('recorded');
    expect(await db.select().from(schema.invoicePayments)).toHaveLength(0);
    expect(await db.select().from(personPaymentReceipts)).toHaveLength(0);
    const subs = await rows<{ n: number }>(
      sql`select count(*)::int as n from subscriptions where payer_account_id is not null`,
    );
    expect(subs[0]?.n).toBe(0);
  });

  it('numbers each person’s receipts in their own series', async () => {
    for (const person of [alice, bob]) {
      const made = await checkout(person);
      const attempt = await pay(person, made.invoiceId);
      const paid = port.succeed(attempt.merchantTranId, PRICE);
      expect((await settle(attempt.merchantTranId, paid.valId)).code).toBe('recorded');
    }
    const numbers = await db
      .select({
        payer: personPaymentReceipts.payerAccountId,
        n: personPaymentReceipts.receiptNumber,
      })
      .from(personPaymentReceipts);
    expect(
      numbers.sort((x, y) => (x.payer ?? '').localeCompare(y.payer ?? '')).map((r) => r.n),
    ).toEqual([1, 1]);
    // No agency receipt counter or receipt was written for a person.
    expect(await db.select().from(schema.paymentReceiptCounters)).toHaveLength(0);
  });
});

describe('test mode (ADR 0025 D9)', () => {
  it('lets only the platform owner start a payment while the gateway is in test mode', async () => {
    port.mode = 'TEST';
    const made = await checkout(alice);
    const refused = await startPersonPayment(db, resolver(), self(alice), {
      invoiceId: made.invoiceId,
      urlFor,
      actorEmail: 'alice@example.com',
    });
    expect(isErr(refused) && refused.error.reason).toBe('test_mode_owner_only');
    expect(port.checkouts).toHaveLength(0);
  });
});

describe('the one recording function on a person invoice (ADR 0025 D13)', () => {
  it('refuses money that did not come online, and writes nothing', async () => {
    const made = await checkout(alice);
    for (const kind of ['ADMIN_RECORDED', 'MANUAL_CLAIM', 'CREDIT'] as const) {
      const refused = await db.transaction((tx) =>
        applyInvoiceCollection(tx, {
          invoiceId: made.invoiceId,
          amountMinorUnits: PRICE,
          currency: 'BDT',
          kind,
          sourceId: kind === 'ADMIN_RECORDED' ? null : crypto.randomUUID(),
          reference: 'by hand',
          collectedDate: new Date(),
          recordedByAccountId: alice,
        }),
      );
      expect(isErr(refused) && refused.error.code, kind).toBe('invalid');
    }
    expect(await db.select().from(schema.invoicePayments)).toHaveLength(0);
    const [invoice] = await db
      .select()
      .from(personInvoices)
      .where(eq(personInvoices.id, made.invoiceId));
    expect(invoice?.status).toBe('OPEN');
  });
});
