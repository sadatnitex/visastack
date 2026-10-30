import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  createInvoice,
  getBillingAccountForOrganization,
  openBillingAccount,
  recordInvoicePayment,
} from './billing';
import type { Db } from './db';
import { createOrganization, reviewOrganization } from './organizations';
import { getPlanByKey } from './plans';
import { grantPlatformRole } from './platform-roles';

/**
 * Characterization of `recordInvoicePayment` as it behaved before the cash
 * ledger existed (ADR 0020, S10). These tests describe today's observable
 * behaviour: they passed on the code as it was, and keep passing once the
 * function delegates to the single recording function. The one intended
 * change (a currency mismatch is refused) is tested separately in
 * invoice-ledger.test.ts.
 */

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function seedPlatformOwner(db: Db) {
  const p = await provisionAccount(db, { email: 'owner-char@platform.example.com' });
  if (!isOk(p)) throw new Error('provision');
  const granted = await grantPlatformRole(db, {
    actor: { accountId: p.value.id, email: p.value.email, bootstrapEmails: [p.value.email] },
    targetAccountId: p.value.id,
    role: 'PLATFORM_OWNER',
    reason: 'seed',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
  return {
    accountId: p.value.id,
    actor: { accountId: p.value.id, email: p.value.email, bootstrapEmails: [] as string[] },
  };
}

async function seedOrganization(db: Db) {
  const ownerAcc = await provisionAccount(db, { email: 'org-owner-char@acme.com' });
  if (!isOk(ownerAcc)) throw new Error('provision');
  const org = await createOrganization(db, {
    actorAccountId: ownerAcc.value.id,
    name: 'Acme Char',
  });
  if (!isOk(org)) throw new Error('org');
  const reviewer = await provisionAccount(db, { email: 'reviewer-char@platform.example.com' });
  if (!isOk(reviewer)) throw new Error('reviewer');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
  return org.value.id;
}

describe('recordInvoicePayment characterization (pre-ledger behaviour)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  let organizationId: string;
  let planId: string;

  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db);
    organizationId = await seedOrganization(db);
    const plan = await getPlanByKey(db, 'agency_starter');
    if (!plan) throw new Error('seed plan');
    planId = plan.id;
  });

  // Each invoice a test opens gets its own 30-day period (since S17, invoices for the same plan
  // whose periods overlap are refused); due dates stay where they were.
  let periodSeq = 0;
  async function openInvoice(invoiceRef: string, amount = 10000, currency = 'USD') {
    const now = new Date();
    const invoice = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart: new Date(now.getTime() + periodSeq * 31 * 24 * 60 * 60 * 1000),
      periodEnd: new Date(now.getTime() + (periodSeq++ * 31 + 30) * 24 * 60 * 60 * 1000),
      invoiceRef,
      invoicedAmountMinorUnits: amount,
      currency,
      dueDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
    });
    if (!isOk(invoice)) throw new Error('invoice');
    return invoice.value.id;
  }

  function pay(
    invoiceId: string,
    amountMinorUnits: number,
    extra: { ref?: string; on?: Date } = {},
  ) {
    return recordInvoicePayment(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      invoiceId,
      amountMinorUnits,
      collectedDate: extra.on ?? new Date('2026-03-01T00:00:00Z'),
      paymentReference: extra.ref ?? 'wire-1',
      reason: 'bank transfer confirmed',
    });
  }

  it('keeps the latest reference and date, and accumulates the running total', async () => {
    const invoiceId = await openInvoice('INV-CHAR-LATEST');
    await pay(invoiceId, 3000, { ref: 'first', on: new Date('2026-03-01T00:00:00Z') });
    const second = await pay(invoiceId, 2000, {
      ref: 'second',
      on: new Date('2026-04-01T00:00:00Z'),
    });
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.collectedAmountMinorUnits).toBe(5000);
    expect(second.value.status).toBe('PARTIALLY_PAID');
    expect(second.value.paymentReference).toBe('second');
    expect(second.value.collectedDate?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('reaches PAID exactly when collected equals invoiced, then refuses anything more', async () => {
    const invoiceId = await openInvoice('INV-CHAR-EXACT', 7000);
    const paid = await pay(invoiceId, 7000);
    expect(isOk(paid) && paid.value.status).toBe('PAID');
    const again = await pay(invoiceId, 1);
    expect(isErr(again)).toBe(true);
  });

  it('refuses with the same words for overpayment, a void invoice and an unknown invoice', async () => {
    const invoiceId = await openInvoice('INV-CHAR-WORDS', 1000);
    const over = await pay(invoiceId, 1001);
    expect(isErr(over) && over.error).toEqual({
      code: 'invalid',
      message: 'this payment would exceed the invoiced amount',
      reason: 'amount_over_balance',
    });
    const unknown = await pay('00000000-0000-0000-0000-000000000000', 5);
    expect(isErr(unknown) && unknown.error).toEqual({
      code: 'not_found',
      message: 'invoice not found',
    });
  });

  it('has no idempotency: two identical calls are two payments', async () => {
    const invoiceId = await openInvoice('INV-CHAR-TWICE', 10000);
    expect(isOk(await pay(invoiceId, 1000))).toBe(true);
    const second = await pay(invoiceId, 1000);
    expect(isOk(second) && second.value.collectedAmountMinorUnits).toBe(2000);
  });

  it('writes one audit event with the amounts and status, and one CASH_COLLECTED event', async () => {
    const invoiceId = await openInvoice('INV-CHAR-AUDIT', 10000);
    await pay(invoiceId, 4000);
    const audit = (
      await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'INVOICE_PAYMENT_RECORDED'))
    )[0];
    expect(audit).toMatchObject({
      actorAccountId: owner.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'invoice',
      resourceId: invoiceId,
      reason: 'bank transfer confirmed',
    });
    expect(audit?.metadata).toMatchObject({
      organizationId,
      amountMinorUnits: 4000,
      newCollectedAmountMinorUnits: 4000,
      newStatus: 'PARTIALLY_PAID',
    });
    const cash = (await db.select().from(schema.productEvents)).filter(
      (e) => e.eventType === 'CASH_COLLECTED',
    );
    expect(cash).toHaveLength(1);
    expect(cash[0]).toMatchObject({ dimension: 'USD', metricValue: 4000, organizationId });
  });

  it('never changes the billing account status', async () => {
    const opened = await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      initialStatus: 'ACTIVE',
      reason: 'terms agreed',
    });
    expect(isOk(opened)).toBe(true);
    const invoiceId = await openInvoice('INV-CHAR-STATUS', 1000);
    await pay(invoiceId, 1000);
    const account = await getBillingAccountForOrganization(db, {
      actorAccountId: owner.accountId,
      organizationId,
      actorEmail: owner.actor.email,
      bootstrapEmails: [],
    });
    expect(isOk(account) && account.value?.status).toBe('ACTIVE');
  });

  it('keeps its permission order: owner first, then step-up, then amount, then reason', async () => {
    const invoiceId = await openInvoice('INV-CHAR-ORDER');
    const stranger = await provisionAccount(db, { email: 'stranger-char@example.com' });
    if (!isOk(stranger)) throw new Error('stranger');
    const base = {
      invoiceId,
      amountMinorUnits: 100,
      collectedDate: new Date(),
      paymentReference: 'r',
      reason: 'x',
    };
    const notOwner = await recordInvoicePayment(db, {
      ...base,
      actor: {
        accountId: stranger.value.id,
        email: 'stranger-char@example.com',
        bootstrapEmails: [],
      },
      stepUpSatisfied: true,
    });
    expect(isErr(notOwner) && notOwner.error.code).toBe('forbidden');
    const noStepUp = await recordInvoicePayment(db, {
      ...base,
      actor: owner.actor,
      stepUpSatisfied: false,
    });
    expect(isErr(noStepUp) && noStepUp.error.code).toBe('step_up_required');
    const negative = await recordInvoicePayment(db, {
      ...base,
      actor: owner.actor,
      stepUpSatisfied: true,
      amountMinorUnits: -5,
    });
    expect(isErr(negative) && negative.error.code).toBe('invalid');
    const noReason = await recordInvoicePayment(db, {
      ...base,
      actor: owner.actor,
      stepUpSatisfied: true,
      reason: ' ',
    });
    expect(isErr(noReason) && noReason.error.code).toBe('invalid');
  });
});
