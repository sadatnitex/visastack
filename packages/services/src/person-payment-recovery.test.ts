import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { staffPrincipal } from './access/principal';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import { newMerchantTranId } from './payments';
import { FakePaymentPort, onePort } from './payments.test-support';
import { personInvoices, personPaymentAttempts } from './person-billing-tables';
import { recoverPersonPayment } from './person-payment-recovery';
import { grantPlatformRole } from './platform-roles';
import { recordPersonRefund } from './refunds';
import { coveringPaidPeriod } from './traveller-billing';

/**
 * Owner decision (2 Nov 2026): a traveller's purchase lost in a restore is recovered from the
 * payment gateway's own record by its transaction id, never from a typed amount, and recorded the
 * usual way (online money, receipt, paid period, refundable like any purchase). Owner only.
 */

const OWNER_EMAIL = 'owner-recover@platform.example.com';
const PRICE = 49_900;

let db: Db;
let port: FakePaymentPort;
let planId: string;
let owner: string;
let alice: string;

async function account(email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!isOk(made)) throw new Error('provision');
  return made.value.id;
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
  // Selling stays off: recovering a lost payment is the owner's, whatever the switch says.
  vi.stubEnv('TRAVELLER_PLANS_ENABLED', 'false');
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
    .values({ key: 'traveller_plus_recover', name: 'Traveller Plus', audience: 'TRAVELLER' })
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
  alice = await account('alice-recover@example.com');
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

async function aliceInvoices() {
  return db.select().from(personInvoices).where(eq(personInvoices.payerAccountId, alice));
}

describe('recovering a payment lost in a restore (owner tool)', () => {
  it('records what the gateway confirms: money online, a receipt, the paid period, with selling off', async () => {
    const staff = await ownerScope();
    const tranId = newMerchantTranId();
    port.succeed(tranId, PRICE);

    const recovered = await recoverPersonPayment(db, onePort(port), staff, {
      accountId: alice,
      planKey: 'traveller_plus_recover',
      merchantTranId: tranId,
      stepUpSatisfied: true,
    });
    if (!isOk(recovered)) throw new Error(`recover: ${recovered.error.message}`);
    expect(recovered.value).toMatchObject({ amountMinorUnits: PRICE, currency: 'BDT' });

    // The plan covers them now, from the recovered purchase.
    const covering = await coveringPaidPeriod(db, alice, new Date());
    expect(covering?.planId).toBe(planId);
    const [invoice] = await aliceInvoices();
    expect(invoice).toMatchObject({ status: 'PAID', invoicedAmountMinorUnits: PRICE });
    // The money is an online payment, checked with the gateway, with a receipt.
    const money = await db
      .select()
      .from(schema.invoicePayments)
      .where(eq(schema.invoicePayments.invoiceId, invoice?.id ?? ''));
    expect(money).toEqual([
      expect.objectContaining({ kind: 'ONLINE', mode: 'LIVE', amountMinorUnits: PRICE }),
    ]);
    const receipts = (
      (await db.execute(
        sql`select count(*)::int as n from payment_receipts where payer_account_id = ${alice}::uuid`,
      )) as unknown as { rows: { n: number }[] }
    ).rows;
    expect(receipts[0]?.n).toBe(1);
    const [attempt] = await db
      .select()
      .from(personPaymentAttempts)
      .where(eq(personPaymentAttempts.merchantTranId, tranId));
    expect(attempt).toMatchObject({
      status: 'RECORDED',
      initiatedByAccountId: owner,
      reasonCode: 'recovered_after_restore',
    });
    const [audit] = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'PERSON_PAYMENT_RECOVERY_STARTED'));
    expect(audit).toMatchObject({ actorAccountId: owner, resourceId: invoice?.id });
    // Asked of the gateway first, then again by the usual recording.
    expect(port.queryCalls.filter((t) => t === tranId)).toHaveLength(2);

    // Refundable like any purchase.
    const refunded = await recordPersonRefund(db, staff, {
      source: { kind: 'entry', invoicePaymentId: money[0]?.id ?? '' },
      expectedAmountMinorUnits: PRICE,
      reference: 'RF-RECOVER-1',
      refundedOn: new Date(),
      reason: 'Asked within 7 days',
      idempotencyKey: crypto.randomUUID(),
      stepUpSatisfied: true,
    });
    expect(isOk(refunded) && refunded.value.code).toBe('recorded');
  });

  it('records nothing the gateway does not confirm as paid to this store in BDT', async () => {
    const staff = await ownerScope();
    const cases: [string, () => void][] = [
      ['not paid', () => undefined],
      ['another store', () => port.succeed(tranId, PRICE, { storeId: 'otherstore' })],
      ['another currency', () => port.succeed(tranId, PRICE, { currency: 'USD' })],
      [
        'another transaction',
        () => port.succeed(tranId, PRICE, { merchantTranId: newMerchantTranId() }),
      ],
    ];
    let tranId = newMerchantTranId();
    for (const [label, arrange] of cases) {
      tranId = newMerchantTranId();
      arrange();
      const refused = await recoverPersonPayment(db, onePort(port), staff, {
        accountId: alice,
        planKey: 'traveller_plus_recover',
        merchantTranId: tranId,
        stepUpSatisfied: true,
      });
      expect(isErr(refused), label).toBe(true);
    }
    expect(await aliceInvoices()).toEqual([]);
    expect(await db.select().from(personPaymentAttempts)).toEqual([]);
  });

  it('says plainly when the id is wrong, the gateway is down or not set up, or nothing is left to do', async () => {
    const staff = await ownerScope();
    const words = async (input: Partial<{ merchantTranId: string; planKey: string }>) => {
      const result = await recoverPersonPayment(db, onePort(port), staff, {
        accountId: alice,
        planKey: 'traveller_plus_recover',
        merchantTranId: newMerchantTranId(),
        stepUpSatisfied: true,
        ...input,
      });
      return isErr(result) ? result.error.message : 'ok';
    };
    expect(await words({ merchantTranId: 'not-an-id' })).toContain('starts with VSP');
    port.outage = true;
    expect(await words({})).toContain('did not answer');
    port.outage = false;
    const tranId = newMerchantTranId();
    port.succeed(tranId, PRICE);
    await db
      .insert(schema.plans)
      .values({ key: 'agency_recover', name: 'Agency', audience: 'AGENCY' });
    expect(await words({ merchantTranId: tranId, planKey: 'agency_recover' })).toBe(
      'Choose a paid traveller plan.',
    );
    expect(await words({ merchantTranId: tranId })).toBe('ok');
    // The same payment again, and a second payment while the first covers them.
    expect(await words({ merchantTranId: tranId })).toContain('already recorded');
    const second = newMerchantTranId();
    port.succeed(second, PRICE);
    expect(await words({ merchantTranId: second })).toContain('already has a paid plan');
    expect(await aliceInvoices()).toHaveLength(1);
    // No gateway set up: nothing can be checked.
    const notSetUp = Object.assign(new FakePaymentPort(), { configured: false });
    const result = await recoverPersonPayment(db, onePort(notSetUp), staff, {
      accountId: alice,
      planKey: 'traveller_plus_recover',
      merchantTranId: newMerchantTranId(),
      stepUpSatisfied: true,
    });
    expect(isErr(result) && result.error.message).toContain('not set up');
  });

  it('refuses an amount that is not a price of the chosen plan, and Traveller Free', async () => {
    const staff = await ownerScope();
    const cheap = newMerchantTranId();
    port.succeed(cheap, PRICE - 100);
    const wrongAmount = await recoverPersonPayment(db, onePort(port), staff, {
      accountId: alice,
      planKey: 'traveller_plus_recover',
      merchantTranId: cheap,
      stepUpSatisfied: true,
    });
    expect(isErr(wrongAmount) && wrongAmount.error).toMatchObject({ reason: 'recovery_plan' });
    expect(isErr(wrongAmount) && wrongAmount.error.message).toContain('not a price this plan');
    const free = newMerchantTranId();
    port.succeed(free, PRICE);
    const toFree = await recoverPersonPayment(db, onePort(port), staff, {
      accountId: alice,
      planKey: 'traveller_free',
      merchantTranId: free,
      stepUpSatisfied: true,
    });
    expect(isErr(toFree) && toFree.error.reason).toBe('recovery_plan');
    expect(await aliceInvoices()).toEqual([]);
    expect(await db.select().from(personPaymentAttempts)).toEqual([]);
  });

  it('finishes a recovery cut short when it is sent again, and records it only once', async () => {
    const staff = await ownerScope();
    const tranId = newMerchantTranId();
    port.succeed(tranId, PRICE);
    // The gateway answers the first question, then is down for the recording's own check.
    let calls = 0;
    const flaky = Object.assign(Object.create(port) as FakePaymentPort, {
      queryByMerchantTranId: async (id: string) => {
        calls += 1;
        if (calls === 2) throw new Error('gateway down');
        return port.queryByMerchantTranId(id);
      },
    });
    const input = {
      accountId: alice,
      planKey: 'traveller_plus_recover',
      merchantTranId: tranId,
      stepUpSatisfied: true,
    };
    const first = await recoverPersonPayment(db, onePort(flaky), staff, input);
    expect(isErr(first) && first.error.message).toContain('Send Recover Payment again');
    const [waiting] = await db
      .select()
      .from(personPaymentAttempts)
      .where(eq(personPaymentAttempts.merchantTranId, tranId));
    // Waiting for the gateway, so the regular checks would finish it too.
    expect(waiting).toMatchObject({ status: 'REDIRECTED', reasonCode: 'recovered_after_restore' });
    expect(waiting?.redirectedAt).not.toBeNull();
    const again = await recoverPersonPayment(db, onePort(flaky), staff, input);
    expect(isOk(again)).toBe(true);
    expect(await aliceInvoices()).toHaveLength(1);
    expect(await coveringPaidPeriod(db, alice, new Date())).toBeDefined();
    const third = await recoverPersonPayment(db, onePort(port), staff, input);
    expect(isErr(third) && third.error.message).toContain('already recorded');
  });

  it("pays a renewal paid early, the traveller's open renewal, rather than a new purchase", async () => {
    const staff = await ownerScope();
    const bought = newMerchantTranId();
    port.succeed(bought, PRICE);
    const base = {
      accountId: alice,
      planKey: 'traveller_plus_recover',
      stepUpSatisfied: true,
    };
    expect(
      isOk(
        await recoverPersonPayment(db, onePort(port), staff, { ...base, merchantTranId: bought }),
      ),
    ).toBe(true);
    const [paid] = await aliceInvoices();
    // The renewal the daily run made, still open on the restored branch.
    const renewalId = (
      (await db.execute(sql`insert into invoices (payer_account_id, plan_id, subscription_id,
          period_start, period_end, invoice_ref, invoiced_amount_minor_units, currency, due_date)
        values (${alice}::uuid, ${planId}::uuid, ${paid?.subscriptionId}::uuid, ${paid?.periodEnd.toISOString()}::timestamptz,
          ${paid?.periodEnd.toISOString()}::timestamptz + interval '30 days', 'TP-RECOVER-RENEW', ${PRICE},
          'BDT', ${paid?.periodEnd.toISOString()}::timestamptz) returning id`)) as unknown as {
        rows: { id: string }[];
      }
    ).rows[0]?.id;
    const early = newMerchantTranId().toUpperCase().replace('VSP', 'vsp');
    port.succeed(
      early.replace(/^vsp/, 'VSP').replace(/[A-F]/g, (c) => c.toLowerCase()),
      PRICE,
    );
    const renewed = await recoverPersonPayment(db, onePort(port), staff, {
      ...base,
      merchantTranId: early,
    });
    if (!isOk(renewed)) throw new Error(`renewal: ${renewed.error.message}`);
    expect(renewed.value.renewal).toBe(true);
    const [renewal] = await db
      .select()
      .from(personInvoices)
      .where(eq(personInvoices.id, renewalId ?? ''));
    expect(renewal?.status).toBe('PAID');
    expect(await aliceInvoices()).toHaveLength(2);
  });

  it('needs a fresh sign-in', async () => {
    const staff = await ownerScope();
    const tranId = newMerchantTranId();
    port.succeed(tranId, PRICE);
    const refusedNow = await recoverPersonPayment(db, onePort(port), staff, {
      accountId: alice,
      planKey: 'traveller_plus_recover',
      merchantTranId: tranId,
      stepUpSatisfied: false,
    });
    expect(isErr(refusedNow) && refusedNow.error.code).toBe('step_up_required');
    expect(port.queryCalls).toEqual([]);
  });

  it('is for the platform owner only', async () => {
    const staffer = await account('staff-recover@example.com');
    const minted = await staffPrincipal(
      db,
      { accountId: staffer, email: 'staff-recover@example.com', bootstrapEmails: [] },
      'BILLING_REFUND_MANAGE',
    );
    expect(isOk(minted)).toBe(false);
    const tranId = newMerchantTranId();
    port.succeed(tranId, PRICE);
    const forged = {
      kind: 'staff',
      accountId: staffer,
      permission: 'BILLING_REFUND_MANAGE',
    } as never;
    const refused = await recoverPersonPayment(db, onePort(port), forged, {
      accountId: alice,
      planKey: 'traveller_plus_recover',
      merchantTranId: tranId,
      stepUpSatisfied: true,
    });
    expect(isErr(refused) && refused.error.code).toBe('forbidden');
    expect(await aliceInvoices()).toEqual([]);
    expect(port.queryCalls).toEqual([]);
    const later = await db
      .select()
      .from(personPaymentAttempts)
      .where(and(eq(personPaymentAttempts.merchantTranId, tranId)));
    expect(later).toEqual([]);
  });
});
