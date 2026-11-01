import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selfPrincipal, staffPrincipal } from './access/principal';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import { settlePaymentAttempt, startPersonPayment } from './payments';
import { FakePaymentPort, onePort } from './payments.test-support';
import { startPersonCheckout } from './person-billing';
import { personPaymentAttempts } from './person-billing-tables';
import { grantPlatformRole } from './platform-roles';
import {
  TRAVELLER_HEALTH_UNAVAILABLE,
  countTravellerPlanEvent,
  getTravellerHealthSettings,
  travellerPlanHealth,
  travellerPlanMetrics,
  updateTravellerHealthSettings,
} from './traveller-plan-metrics';

/**
 * ADR 0025 T6 (section 12.6): the owner's traveller plan metrics are counts by day, never who;
 * the health signals compare traveller payments with thresholds the owner sets; nothing fails
 * before migration 0114.
 */

const OWNER_EMAIL = 'owner-plan-metrics@platform.example.com';
const PRICE = 49_900;
const urlFor = (kind: string, tran: string) => `https://app.example.test/pay/${kind}?t=${tran}`;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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
    'PLANS_MANAGE',
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
    .values({ key: 'traveller_plus_metrics', name: 'Traveller Plus', audience: 'TRAVELLER' })
    .returning({ id: schema.plans.id });
  if (!plan) throw new Error('plan');
  planId = plan.id;
  await db.insert(schema.planPrices).values({
    planId,
    priceMinorUnits: PRICE,
    currency: 'BDT',
    effectiveFrom: new Date('2001-01-01T00:00:00Z'),
  });
  alice = await account('alice-metrics@example.com');
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A purchase and its payment page opened, as `accountId`. */
async function startPaying(accountId: string, email?: string) {
  const made = await startPersonCheckout(db, selfPrincipal(accountId), { planId });
  if (!isOk(made)) throw new Error('checkout');
  const started = await startPersonPayment(db, onePort(port), selfPrincipal(accountId), {
    invoiceId: made.value.invoiceId,
    urlFor,
    startAnother: false,
    ...(email ? { actorEmail: email, bootstrapEmails: [OWNER_EMAIL] } : {}),
  });
  if (!isOk(started) || started.value.kind !== 'redirect') throw new Error('start');
  const [attempt] = await db
    .select()
    .from(personPaymentAttempts)
    .where(eq(personPaymentAttempts.id, started.value.attemptId));
  if (!attempt) throw new Error('attempt');
  return attempt;
}

async function settle(attempt: { merchantTranId: string; amountMinorUnits: number }) {
  const paid = port.succeed(attempt.merchantTranId, attempt.amountMinorUnits);
  return (
    await settlePaymentAttempt(db, port, {
      merchantTranId: attempt.merchantTranId,
      valId: paid.valId,
      source: 'ipn',
    })
  ).code;
}

describe('traveller plan metrics for the platform owner (ADR 0025 T6)', () => {
  it('counts views, Get taps, checkouts and real payments by day, and test payments apart, never who', async () => {
    for (let i = 0; i < 3; i++) await countTravellerPlanEvent(db, 'PLAN_VIEWED');
    await countTravellerPlanEvent(db, 'GET_TAPPED');
    expect(await settle(await startPaying(alice))).toBe('recorded');
    // The owner pays in test mode: counted apart, never as a payment.
    port.mode = 'TEST';
    expect(await settle(await startPaying(owner, OWNER_EMAIL))).toBe('recorded');

    const staff = await ownerScope();
    const metrics = await travellerPlanMetrics(db, staff, { days: 7 });
    if (!isOk(metrics)) throw new Error('metrics');
    expect(metrics.value.days).toHaveLength(7);
    expect(metrics.value.totals).toMatchObject({ views: 3, getTaps: 1, checkouts: 2, payments: 1 });
    expect(metrics.value.testPayments).toBe(1);
    // Of the real purchases started (the test one is left out), one was paid.
    expect(metrics.value.rates.conversion).toBe(1);
    expect(metrics.value.rates.refund).toBe(0);
    expect(metrics.value.rates.renewal).toBeNull();
    expect(metrics.value.countsAvailable).toBe(true);
    const today = metrics.value.days[0];
    expect(today?.views).toBe(3);
    // A purchase started and never paid halves it.
    const bob = await account('bob-metrics@example.com');
    expect(isOk(await startPersonCheckout(db, selfPrincipal(bob), { planId }))).toBe(true);
    const later = await travellerPlanMetrics(db, staff, { days: 7 });
    expect(isOk(later) && later.value.rates.conversion).toBe(0.5);
    // A test payment page opened and never paid is a test too, never an unpaid purchase.
    const carol = await account('carol-metrics@example.com');
    const carolBuys = await startPersonCheckout(db, selfPrincipal(carol), { planId });
    if (!isOk(carolBuys)) throw new Error('checkout');
    await db.execute(sql`
      insert into payment_attempts
      select (jsonb_populate_record(null::payment_attempts, to_jsonb(a) || jsonb_build_object(
        'id', gen_random_uuid(), 'invoice_id', ${carolBuys.value.invoiceId}::uuid,
        'payer_account_id', ${carol}::uuid, 'merchant_tran_id', 'TEST-PAGE-ONLY',
        'status', 'REDIRECTED', 'provider_val_id', null, 'bank_tran_id', null,
        'recorded_at', null))).*
      from payment_attempts a where a.payer_account_id = ${owner}::uuid and a.mode = 'TEST'`);
    const withTest = await travellerPlanMetrics(db, staff, { days: 7 });
    expect(isOk(withTest) && withTest.value.rates.conversion).toBe(0.5);
    // A withdrawn (voided) purchase is never counted as one left unpaid.
    await db.execute(
      sql`update invoices set status = 'VOID' where payer_account_id = ${bob}::uuid`,
    );
    const voided = await travellerPlanMetrics(db, staff, { days: 7 });
    expect(isOk(voided) && voided.value.rates.conversion).toBe(1);
    // Numbers and days only: no id, no email.
    const text = JSON.stringify(metrics.value);
    expect(text).not.toMatch(UUID);
    expect(text).not.toContain('@');
  });

  it('measures the health signals against the owner’s thresholds, changed with a fresh sign-in', async () => {
    const staff = await ownerScope();
    // A payment left at the gateway for an hour: stuck confirming.
    const stuck = await startPaying(alice);
    // Stuck for weeks is the worst case: it still counts.
    await db
      .update(personPaymentAttempts)
      .set({ createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
      .where(eq(personPaymentAttempts.id, stuck.id));
    const first = await travellerPlanHealth(db, staff);
    if (!isOk(first)) throw new Error('health');
    const byKey = new Map(first.value.signals.map((s) => [s.key, s]));
    expect(byKey.get('stuck_confirming')).toMatchObject({
      value: 1,
      threshold: 0,
      status: 'attention',
    });
    expect(byKey.get('needs_check')).toMatchObject({ value: 0, status: 'ok' });
    expect(byKey.get('checkout_success')?.status).toBe('no_data');

    const refused = await updateTravellerHealthSettings(db, staff, {
      checkoutSuccessMinPercent: 50,
      confirmationMaxMinutes: 15,
      stuckConfirmingMax: 2,
      needsCheckMax: 0,
      stepUpSatisfied: false,
    });
    expect(isErr(refused) && refused.error.code).toBe('step_up_required');
    const invalid = await updateTravellerHealthSettings(db, staff, {
      checkoutSuccessMinPercent: 120,
      confirmationMaxMinutes: 15,
      stuckConfirmingMax: 2,
      needsCheckMax: 0,
      stepUpSatisfied: true,
    });
    expect(isErr(invalid) && invalid.error.code).toBe('invalid');
    const saved = await updateTravellerHealthSettings(db, staff, {
      checkoutSuccessMinPercent: 50,
      confirmationMaxMinutes: 15,
      stuckConfirmingMax: 2,
      needsCheckMax: 0,
      stepUpSatisfied: true,
    });
    expect(isOk(saved) && saved.value.changed).toBe(true);
    const again = await travellerPlanHealth(db, staff);
    if (!isOk(again)) throw new Error('health');
    expect(again.value.signals.find((s) => s.key === 'stuck_confirming')).toMatchObject({
      threshold: 2,
      status: 'ok',
    });
    const audit = await db.execute(
      sql`select count(*)::int as n from audit_events where event_type = 'TRAVELLER_PLAN_THRESHOLDS_CHANGED'`,
    );
    expect((audit as unknown as { rows: { n: number }[] }).rows[0]?.n).toBe(1);
  });

  it('is for the platform owner only', async () => {
    const staffer = await account('staff-metrics@example.com');
    const minted = await staffPrincipal(
      db,
      { accountId: staffer, email: 'staff-metrics@example.com', bootstrapEmails: [] },
      'PLANS_MANAGE',
    );
    expect(isOk(minted)).toBe(false);
    const forged = { kind: 'staff', accountId: staffer, permission: 'PLANS_MANAGE' } as never;
    expect(isErr(await travellerPlanMetrics(db, forged))).toBe(true);
    expect(isErr(await travellerPlanHealth(db, forged))).toBe(true);
    expect(isErr(await getTravellerHealthSettings(db, forged))).toBe(true);
  });

  it('counts nothing and fails nothing before migration 0114', async () => {
    await db.execute(sql`drop table traveller_plan_daily_counts`);
    await db.execute(sql`drop table traveller_plan_health_settings`);
    await countTravellerPlanEvent(db, 'PLAN_VIEWED');
    const staff = await ownerScope();
    const metrics = await travellerPlanMetrics(db, staff);
    expect(isOk(metrics) && metrics.value.countsAvailable).toBe(false);
    const settings = await getTravellerHealthSettings(db, staff);
    expect(isOk(settings) && settings.value).toMatchObject({
      available: false,
      stuckConfirmingMax: 0,
    });
    const health = await travellerPlanHealth(db, staff);
    expect(isOk(health)).toBe(true);
    const save = await updateTravellerHealthSettings(db, staff, {
      checkoutSuccessMinPercent: 60,
      confirmationMaxMinutes: 15,
      stuckConfirmingMax: 0,
      needsCheckMax: 0,
      stepUpSatisfied: true,
    });
    expect(isErr(save) && save.error.message).toBe(TRAVELLER_HEALTH_UNAVAILABLE);
  });
});
