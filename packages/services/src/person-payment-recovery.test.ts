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
      'Choose a traveller plan.',
    );
    expect(await words({ merchantTranId: tranId })).toBe('ok');
    // The same payment again, and a second payment while the first covers them.
    expect(await words({ merchantTranId: tranId })).toBe('This payment is already recorded.');
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
    });
    expect(isErr(result) && result.error.message).toContain('not set up');
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
