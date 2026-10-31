import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import { openBillingAccount, recordInvoicePayment, voidInvoice } from './billing';
import { runBillingCycle } from './billing-cycle';
import type { Db } from './db';
import { submitManualPaymentClaim } from './manual-claims';
import { createOrganization, reviewOrganization } from './organizations';
import { startOnlinePayment } from './payments';
import { FakePaymentPort, onePort } from './payments.test-support';
import { entitlementsSchemaPresent } from './plans-schema';
import { grantPlatformRole } from './platform-roles';

/**
 * ADR 0025, T3 phase 1: before any person can buy a plan, the agency billing code is shown to leave
 * a person's own billing rows alone. Every agency function that finds an invoice by its id alone
 * reads a person's invoice as not found, and the daily billing run neither bills, reminds nor
 * changes anything of a person's.
 */

const DAY = 24 * 60 * 60 * 1000;
const OWNER_EMAIL = 'owner-isolation@platform.example.com';

let db: Db;
let ownerId: string;
let personId: string;
let personInvoiceId: string;

async function account(email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!isOk(made)) throw new Error('provision');
  return made.value.id;
}

const actor = () => ({ accountId: ownerId, email: OWNER_EMAIL, bootstrapEmails: [] as string[] });

async function personInvoice() {
  const rows = (await db.execute(
    sql`select status, collected_amount_minor_units, updated_at from invoices where id = ${personInvoiceId}::uuid`,
  )) as unknown as { rows: Record<string, unknown>[] };
  return rows.rows[0];
}

beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  ownerId = await account(OWNER_EMAIL);
  const granted = await grantPlatformRole(db, {
    actor: { accountId: ownerId, email: OWNER_EMAIL, bootstrapEmails: [OWNER_EMAIL] },
    targetAccountId: ownerId,
    role: 'PLATFORM_OWNER',
    reason: 'seed',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
  personId = await account('person-isolation@example.com');
  const [plan] = await db
    .insert(schema.plans)
    .values({
      key: 'traveller_plus_isolation',
      name: 'Traveller Plus',
      audience: 'TRAVELLER',
      periodDays: 30,
      priceMinorUnits: 49_900,
      currency: 'BDT',
    })
    .returning({ id: schema.plans.id });
  if (!plan) throw new Error('plan');
  // A person's own subscription started long ago, and an open invoice of theirs long overdue: the
  // shape that would make an agency sweep bill, remind or suspend if it read person rows.
  const started = new Date(Date.now() - 95 * DAY).toISOString();
  const sub = (
    (await db.execute(sql`
      insert into subscriptions (payer_account_id, plan_id, reason, started_at)
      values (${personId}::uuid, ${plan.id}::uuid, 'Bought Traveller Plus', ${started}::timestamptz)
      returning id`)) as unknown as { rows: { id: string }[] }
  ).rows[0];
  if (!sub) throw new Error('subscription');
  const start = new Date(Date.now() - 40 * DAY).toISOString();
  const end = new Date(Date.now() - 10 * DAY).toISOString();
  const inv = (
    (await db.execute(sql`
      insert into invoices (payer_account_id, subscription_id, plan_id, period_start, period_end,
        invoice_ref, invoiced_amount_minor_units, currency, due_date, status)
      values (${personId}::uuid, ${sub.id}::uuid, ${plan.id}::uuid, ${start}::timestamptz,
        ${end}::timestamptz, 'TP-ISOLATION-1', 49900, 'BDT', ${start}::timestamptz, 'OPEN')
      returning id`)) as unknown as { rows: { id: string }[] }
  ).rows[0];
  if (!inv) throw new Error('invoice');
  personInvoiceId = inv.id;
}, 60_000);

describe("agency billing leaves a person's own billing alone (ADR 0025 T3)", () => {
  it('reads a person invoice as not found when staff record a payment or void it', async () => {
    const recorded = await recordInvoicePayment(db, {
      actor: actor(),
      stepUpSatisfied: true,
      invoiceId: personInvoiceId,
      amountMinorUnits: 49_900,
      collectedDate: new Date(),
      paymentReference: 'wire-1',
      reason: 'received',
    });
    expect(isErr(recorded) && recorded.error.code).toBe('not_found');
    const voided = await voidInvoice(db, {
      actor: actor(),
      stepUpSatisfied: true,
      invoiceId: personInvoiceId,
      reason: 'error',
    });
    expect(isErr(voided) && voided.error.code).toBe('not_found');
    expect(await personInvoice()).toMatchObject({
      status: 'OPEN',
      collected_amount_minor_units: 0,
    });
    expect(await db.select().from(schema.invoicePayments)).toHaveLength(0);
  });

  // Both already refuse a person through their membership check, so this pins the behaviour; the
  // organization guard added in each lookup is a second line no test can tell apart from it.
  it('reads a person invoice as not found for a payment report or the agency online payment', async () => {
    const claim = await submitManualPaymentClaim(db, null, {
      actorAccountId: personId,
      invoiceId: personInvoiceId,
      method: 'BANK_TRANSFER',
      reference: 'TRX-1',
      amountMinorUnits: 49_900,
      paidOn: new Date(Date.now() - DAY),
    });
    expect(isErr(claim) && claim.error.code).toBe('not_found');
    const port = new FakePaymentPort();
    const started = await startOnlinePayment(db, onePort(port), {
      actorAccountId: personId,
      invoiceId: personInvoiceId,
      urlFor: (kind, tran) => `https://app.example.test/pay/${kind}?t=${tran}`,
    });
    expect(isErr(started) && started.error.code).toBe('not_found');
    expect(port.checkouts).toHaveLength(0);
    expect(await db.select().from(schema.paymentAttempts)).toHaveLength(0);
    expect(await db.select().from(schema.manualPaymentClaims)).toHaveLength(0);
  });

  it('runs the daily billing for an agency without billing, reminding or changing anything of the person', async () => {
    // A positive control: an active agency on a priced plan for 95 days, which the run must bill.
    const agencyOwner = await account('agency-owner-isolation@acme.example.com');
    const org = await createOrganization(db, {
      actorAccountId: agencyOwner,
      name: 'Acme Isolation',
    });
    if (!isOk(org)) throw new Error('org');
    const reviewer = await account('reviewer-isolation@platform.example.com');
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: reviewer,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('review');
    const [agencyPlan] = await db
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(eq(schema.plans.key, 'agency_pro'));
    if (!agencyPlan) throw new Error('agency plan');
    await db
      .update(schema.plans)
      .set({ priceMinorUnits: 500_000, currency: 'BDT' })
      .where(eq(schema.plans.id, agencyPlan.id));
    if (await entitlementsSchemaPresent(db)) {
      await db
        .insert(schema.planPrices)
        .values({
          planId: agencyPlan.id,
          priceMinorUnits: 500_000,
          currency: 'BDT',
          effectiveFrom: new Date('2001-01-01T00:00:00Z'),
        })
        .onConflictDoNothing();
    }
    const opened = await openBillingAccount(db, {
      actor: actor(),
      stepUpSatisfied: true,
      organizationId: org.value.id,
      initialStatus: 'ACTIVE',
      reason: 'terms agreed',
    });
    if (!isOk(opened)) throw new Error('billing account');
    await db
      .update(schema.billingStatusHistory)
      .set({ createdAt: new Date(Date.now() - 400 * DAY) })
      .where(eq(schema.billingStatusHistory.billingAccountId, opened.value.id));
    await db
      .update(schema.subscriptions)
      .set({ endedAt: new Date(Date.now() - 95 * DAY) })
      .where(eq(schema.subscriptions.organizationId, org.value.id));
    await db.insert(schema.subscriptions).values({
      organizationId: org.value.id,
      planId: agencyPlan.id,
      startedAt: new Date(Date.now() - 95 * DAY),
      assignedByAccountId: ownerId,
      reason: 'seed',
    });
    await db
      .update(schema.billingSettings)
      .set({ invoicingStartsAt: new Date(Date.now() - 400 * DAY) })
      .where(eq(schema.billingSettings.id, true));

    const before = await personInvoice();
    const summary = await runBillingCycle(db, systemScopeForTest('process-billing-cycle'));
    // The agency is billed (the run did work), the person is not.
    expect(summary).toMatchObject({ failed: 0, invoicesCreated: 1 });
    expect(await personInvoice()).toEqual(before);
    const agencyInvoices = await db
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(eq(schema.invoices.organizationId, org.value.id));
    expect(agencyInvoices).toHaveLength(1);
    const personRows = (await db.execute(
      sql`select count(*)::int as n from invoices where payer_account_id = ${personId}::uuid`,
    )) as unknown as { rows: { n: number }[] };
    expect(personRows.rows[0]?.n).toBe(1);
    const queued = (await db.execute(
      sql`select count(*)::int as n from notifications where resource_id = ${personInvoiceId}`,
    )) as unknown as { rows: { n: number }[] };
    expect(queued.rows[0]?.n).toBe(0);
  });
});
