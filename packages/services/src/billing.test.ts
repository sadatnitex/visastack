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
  isBillingSuspended,
  listBillingStatusHistory,
  listInvoicesForOrganization,
  openBillingAccount,
  recordInvoicePayment,
  transitionBillingStatus,
  voidInvoice,
} from './billing';
import type { Db } from './db';
import { createOrganization, reviewOrganization } from './organizations';
import { getPlanByKey } from './plans';
import { grantPlatformRole } from './platform-roles';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema });
  return db as unknown as Db;
}

async function activateOrg(db: Db, organizationId: string): Promise<void> {
  const reviewer = await provisionAccount(db, {
    email: `reviewer-${organizationId}@platform.example.com`,
  });
  if (!isOk(reviewer)) throw new Error('reviewer');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
}

async function seedPlatformOwner(db: Db, tag: string) {
  const p = await provisionAccount(db, { email: `owner-${tag}@platform.example.com` });
  if (!isOk(p)) throw new Error('provision');
  const account = p.value;
  const granted = await grantPlatformRole(db, {
    actor: { accountId: account.id, email: account.email, bootstrapEmails: [account.email] },
    targetAccountId: account.id,
    role: 'PLATFORM_OWNER',
    reason: 'seed',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
  return {
    accountId: account.id,
    actor: { accountId: account.id, email: account.email, bootstrapEmails: [] as string[] },
  };
}

async function seedOrganization(db: Db, tag: string) {
  const ownerAcc = await provisionAccount(db, { email: `org-owner-${tag}@acme.com` });
  if (!isOk(ownerAcc)) throw new Error('provision');
  const org = await createOrganization(db, {
    actorAccountId: ownerAcc.value.id,
    name: `Acme ${tag}`,
  });
  if (!isOk(org)) throw new Error('org');
  await activateOrg(db, org.value.id);
  return { organizationId: org.value.id, ownerAccountId: ownerAcc.value.id };
}

async function seedStranger(db: Db, tag: string): Promise<string> {
  const account = await provisionAccount(db, { email: `stranger-${tag}@example.com` });
  if (!isOk(account)) throw new Error('provision');
  return account.value.id;
}

describe('billing accounts -- states, transitions, and history (COM-03)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'accounts');
  });

  it('openBillingAccount refuses a non-owner, refuses without step-up, and refuses an empty reason', async () => {
    const { organizationId } = await seedOrganization(db, 'auth');
    const strangerId = await seedStranger(db, 'auth');

    const notOwner = await openBillingAccount(db, {
      actor: { accountId: strangerId, email: 'x@example.com', bootstrapEmails: [] },
      stepUpSatisfied: true,
      organizationId,
      reason: 'onboarding',
    });
    expect(isErr(notOwner)).toBe(true);
    if (isErr(notOwner)) expect(notOwner.error.code).toBe('forbidden');

    const noStepUp = await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: false,
      organizationId,
      reason: 'onboarding',
    });
    expect(isErr(noStepUp)).toBe(true);
    if (isErr(noStepUp)) expect(noStepUp.error.code).toBe('step_up_required');

    const emptyReason = await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: '   ',
    });
    expect(isErr(emptyReason)).toBe(true);
  });

  it('refuses an unknown organization and refuses opening a second account for the same org', async () => {
    const unknown = await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId: '00000000-0000-0000-0000-000000000000',
      reason: 'onboarding',
    });
    expect(isErr(unknown)).toBe(true);
    if (isErr(unknown)) expect(unknown.error.code).toBe('not_found');

    const { organizationId } = await seedOrganization(db, 'dupe');
    const first = await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: 'onboarding',
    });
    expect(isOk(first)).toBe(true);

    const second = await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: 'again',
    });
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.message).toContain('already has a billing account');
  });

  it('opens with a default TRIAL status, recording it in the append-only history', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'trial-default');
    const opened = await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: 'new customer',
    });
    expect(isOk(opened)).toBe(true);
    if (!isOk(opened)) return;
    expect(opened.value.status).toBe('TRIAL');

    const history = await listBillingStatusHistory(db, {
      actorAccountId: ownerAccountId,
      organizationId,
    });
    expect(isOk(history)).toBe(true);
    if (!isOk(history)) return;
    expect(history.value).toHaveLength(1);
    expect(history.value[0]?.fromStatus).toBeNull();
    expect(history.value[0]?.toStatus).toBe('TRIAL');

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'BILLING_ACCOUNT_OPENED'));
    expect(events).toHaveLength(1);
  });

  it('can open directly in ACTIVE status when payment terms were already agreed', async () => {
    const { organizationId } = await seedOrganization(db, 'active-default');
    const opened = await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      initialStatus: 'ACTIVE',
      reason: 'terms already agreed',
    });
    expect(isOk(opened)).toBe(true);
    if (isOk(opened)) expect(opened.value.status).toBe('ACTIVE');
  });

  it('getBillingAccountForOrganization / listBillingStatusHistory refuse a non-member and return empty/undefined before any account is opened', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'noaccount');
    const strangerId = await seedStranger(db, 'noaccount');

    const strangerRead = await getBillingAccountForOrganization(db, {
      actorAccountId: strangerId,
      organizationId,
    });
    expect(isErr(strangerRead)).toBe(true);

    const beforeOpen = await getBillingAccountForOrganization(db, {
      actorAccountId: ownerAccountId,
      organizationId,
    });
    expect(isOk(beforeOpen)).toBe(true);
    if (isOk(beforeOpen)) expect(beforeOpen.value).toBeUndefined();

    const historyBeforeOpen = await listBillingStatusHistory(db, {
      actorAccountId: ownerAccountId,
      organizationId,
    });
    expect(isOk(historyBeforeOpen)).toBe(true);
    if (isOk(historyBeforeOpen)) expect(historyBeforeOpen.value).toEqual([]);
  });

  it('getBillingAccountForOrganization / listBillingStatusHistory allow a platform owner who is not a member, but still refuse a non-owner stranger even with an email supplied', async () => {
    const { organizationId } = await seedOrganization(db, 'ownerread');
    const strangerId = await seedStranger(db, 'ownerread');

    const strangerWithEmail = await getBillingAccountForOrganization(db, {
      actorAccountId: strangerId,
      organizationId,
      actorEmail: 'stranger-ownerread@example.com',
      bootstrapEmails: [],
    });
    expect(isErr(strangerWithEmail)).toBe(true);

    const ownerRead = await getBillingAccountForOrganization(db, {
      actorAccountId: owner.accountId,
      organizationId,
      actorEmail: owner.actor.email,
      bootstrapEmails: owner.actor.bootstrapEmails,
    });
    expect(isOk(ownerRead)).toBe(true);
    if (isOk(ownerRead)) expect(ownerRead.value).toBeUndefined();

    const ownerHistory = await listBillingStatusHistory(db, {
      actorAccountId: owner.accountId,
      organizationId,
      actorEmail: owner.actor.email,
      bootstrapEmails: owner.actor.bootstrapEmails,
    });
    expect(isOk(ownerHistory)).toBe(true);
    if (isOk(ownerHistory)) expect(ownerHistory.value).toEqual([]);
  });

  it('transitionBillingStatus refuses a non-owner, refuses without step-up, and refuses an unknown/unopened organization', async () => {
    const { organizationId } = await seedOrganization(db, 'trans-auth');
    const strangerId = await seedStranger(db, 'trans-auth');

    const notOwner = await transitionBillingStatus(db, {
      actor: { accountId: strangerId, email: 'x@example.com', bootstrapEmails: [] },
      stepUpSatisfied: true,
      organizationId,
      toStatus: 'ACTIVE',
      reason: 'x',
    });
    expect(isErr(notOwner)).toBe(true);
    if (isErr(notOwner)) expect(notOwner.error.code).toBe('forbidden');

    const noAccount = await transitionBillingStatus(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toStatus: 'ACTIVE',
      reason: 'x',
    });
    expect(isErr(noAccount)).toBe(true);
    if (isErr(noAccount)) expect(noAccount.error.code).toBe('not_found');
  });

  it('refuses transitioning to the current status and refuses an illegal transition (TRIAL -> SUSPENDED directly)', async () => {
    const { organizationId } = await seedOrganization(db, 'illegal');
    await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: 'onboarding',
    });

    const sameStatus = await transitionBillingStatus(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toStatus: 'TRIAL',
      reason: 'noop',
    });
    expect(isErr(sameStatus)).toBe(true);

    const illegal = await transitionBillingStatus(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toStatus: 'SUSPENDED',
      reason: 'skip ahead',
    });
    expect(isErr(illegal)).toBe(true);
    if (isErr(illegal)) expect(illegal.error.message).toContain('cannot transition');
  });

  it('walks the full legal lifecycle TRIAL -> ACTIVE -> GRACE -> SUSPENDED -> CLOSED -> ACTIVE (reactivation), each step recorded in history', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'lifecycle');
    await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      reason: 'onboarding',
    });

    const path: Array<'ACTIVE' | 'GRACE' | 'SUSPENDED' | 'CLOSED'> = [
      'ACTIVE',
      'GRACE',
      'SUSPENDED',
      'CLOSED',
    ];
    for (const toStatus of path) {
      const result = await transitionBillingStatus(db, {
        actor: owner.actor,
        stepUpSatisfied: true,
        organizationId,
        toStatus,
        reason: `moving to ${toStatus}`,
      });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.value.status).toBe(toStatus);
    }

    // CLOSED -> ACTIVE: a churned organization restarting.
    const reactivated = await transitionBillingStatus(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toStatus: 'ACTIVE',
      reason: 'customer is back',
    });
    expect(isOk(reactivated)).toBe(true);

    const history = await listBillingStatusHistory(db, {
      actorAccountId: ownerAccountId,
      organizationId,
    });
    expect(isOk(history)).toBe(true);
    if (!isOk(history)) return;
    // TRIAL (open) + 4 path steps + 1 reactivation = 6 entries, newest first.
    expect(history.value).toHaveLength(6);
    expect(history.value[0]?.toStatus).toBe('ACTIVE');
    expect(history.value[0]?.fromStatus).toBe('CLOSED');
    expect(history.value[5]?.toStatus).toBe('TRIAL');
    expect(history.value[5]?.fromStatus).toBeNull();
  });

  it('refuses CLOSED -> GRACE/SUSPENDED and refuses re-entering TRIAL from anywhere except CLOSED', async () => {
    const { organizationId } = await seedOrganization(db, 'closed-limits');
    await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      initialStatus: 'ACTIVE',
      reason: 'onboarding',
    });

    const backToTrial = await transitionBillingStatus(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toStatus: 'TRIAL',
      reason: 'nonsensical',
    });
    expect(isErr(backToTrial)).toBe(true);

    await transitionBillingStatus(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toStatus: 'CLOSED',
      reason: 'closing',
    });
    const closedToGrace = await transitionBillingStatus(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toStatus: 'GRACE',
      reason: 'nonsensical',
    });
    expect(isErr(closedToGrace)).toBe(true);
  });

  it('isBillingSuspended is false with no account and false when ACTIVE, true only once SUSPENDED', async () => {
    const { organizationId } = await seedOrganization(db, 'suspended-check');
    expect(await isBillingSuspended(db, organizationId)).toBe(false);

    await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      initialStatus: 'ACTIVE',
      reason: 'onboarding',
    });
    expect(await isBillingSuspended(db, organizationId)).toBe(false);

    await transitionBillingStatus(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toStatus: 'SUSPENDED',
      reason: 'non-payment',
    });
    expect(await isBillingSuspended(db, organizationId)).toBe(true);
  });
});

describe('invoices -- issue, collect, void (COM-03)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  let organizationId: string;
  let ownerAccountId: string;
  let planId: string;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'invoices');
    const org = await seedOrganization(db, 'invoices');
    organizationId = org.organizationId;
    ownerAccountId = org.ownerAccountId;
    const plan = await getPlanByKey(db, 'agency_starter');
    if (!plan) throw new Error('seed plan');
    planId = plan.id;
  });

  function periodDates(): { periodStart: Date; periodEnd: Date; dueDate: Date } {
    const now = new Date();
    return {
      periodStart: now,
      periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      dueDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
    };
  }

  it('createInvoice refuses a non-owner, refuses without step-up, and validates every required field', async () => {
    const strangerId = await seedStranger(db, 'invoice-auth');
    const { periodStart, periodEnd, dueDate } = periodDates();

    const notOwner = await createInvoice(db, {
      actor: { accountId: strangerId, email: 'x@example.com', bootstrapEmails: [] },
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-1',
      invoicedAmountMinorUnits: 10000,
      currency: 'USD',
      dueDate,
    });
    expect(isErr(notOwner)).toBe(true);
    if (isErr(notOwner)) expect(notOwner.error.code).toBe('forbidden');

    const noStepUp = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: false,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-2',
      invoicedAmountMinorUnits: 10000,
      currency: 'USD',
      dueDate,
    });
    expect(isErr(noStepUp)).toBe(true);
    if (isErr(noStepUp)) expect(noStepUp.error.code).toBe('step_up_required');

    const badPeriod = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart: periodEnd,
      periodEnd: periodStart,
      invoiceRef: 'INV-3',
      invoicedAmountMinorUnits: 10000,
      currency: 'USD',
      dueDate,
    });
    expect(isErr(badPeriod)).toBe(true);

    const negativeAmount = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-4',
      invoicedAmountMinorUnits: -1,
      currency: 'USD',
      dueDate,
    });
    expect(isErr(negativeAmount)).toBe(true);

    const emptyCurrency = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-5',
      invoicedAmountMinorUnits: 10000,
      currency: '  ',
      dueDate,
    });
    expect(isErr(emptyCurrency)).toBe(true);
  });

  it('refuses an unknown organization, an unknown plan, and a duplicate invoice reference', async () => {
    const { periodStart, periodEnd, dueDate } = periodDates();
    const unknownOrg = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId: '00000000-0000-0000-0000-000000000000',
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-UNKNOWN-ORG',
      invoicedAmountMinorUnits: 10000,
      currency: 'USD',
      dueDate,
    });
    expect(isErr(unknownOrg)).toBe(true);
    if (isErr(unknownOrg)) expect(unknownOrg.error.code).toBe('not_found');

    const unknownPlan = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId: '00000000-0000-0000-0000-000000000000',
      periodStart,
      periodEnd,
      invoiceRef: 'INV-UNKNOWN-PLAN',
      invoicedAmountMinorUnits: 10000,
      currency: 'USD',
      dueDate,
    });
    expect(isErr(unknownPlan)).toBe(true);
    if (isErr(unknownPlan)) expect(unknownPlan.error.code).toBe('not_found');

    const first = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-DUPE',
      invoicedAmountMinorUnits: 10000,
      currency: 'USD',
      dueDate,
    });
    expect(isOk(first)).toBe(true);
    const dupe = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-DUPE',
      invoicedAmountMinorUnits: 5000,
      currency: 'USD',
      dueDate,
    });
    expect(isErr(dupe)).toBe(true);
    if (isErr(dupe)) expect(dupe.error.message).toContain('already exists');
  });

  it("creates a real OPEN invoice, audited, with invoicedAmountMinorUnits/currency immutable from the plan's own live price", async () => {
    const { periodStart, periodEnd, dueDate } = periodDates();
    const created = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-REAL',
      invoicedAmountMinorUnits: 25000,
      currency: 'USD',
      dueDate,
    });
    expect(isOk(created)).toBe(true);
    if (!isOk(created)) return;
    expect(created.value.status).toBe('OPEN');
    expect(created.value.invoicedAmountMinorUnits).toBe(25000);
    expect(created.value.collectedAmountMinorUnits).toBe(0);
    expect(created.value.collectedDate).toBeNull();

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'INVOICE_CREATED'));
    expect(events).toHaveLength(1);
  });

  it('recordInvoicePayment refuses a non-owner, without step-up, a non-positive amount, and an empty reference/reason', async () => {
    const { periodStart, periodEnd, dueDate } = periodDates();
    const invoice = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-PAY-AUTH',
      invoicedAmountMinorUnits: 10000,
      currency: 'USD',
      dueDate,
    });
    if (!isOk(invoice)) throw new Error('invoice');
    const strangerId = await seedStranger(db, 'pay-auth');

    const notOwner = await recordInvoicePayment(db, {
      actor: { accountId: strangerId, email: 'x@example.com', bootstrapEmails: [] },
      stepUpSatisfied: true,
      invoiceId: invoice.value.id,
      amountMinorUnits: 5000,
      collectedDate: new Date(),
      paymentReference: 'ref-1',
      reason: 'bank transfer',
    });
    expect(isErr(notOwner)).toBe(true);

    const zeroAmount = await recordInvoicePayment(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      invoiceId: invoice.value.id,
      amountMinorUnits: 0,
      collectedDate: new Date(),
      paymentReference: 'ref-1',
      reason: 'bank transfer',
    });
    expect(isErr(zeroAmount)).toBe(true);

    const emptyRef = await recordInvoicePayment(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      invoiceId: invoice.value.id,
      amountMinorUnits: 5000,
      collectedDate: new Date(),
      paymentReference: '  ',
      reason: 'bank transfer',
    });
    expect(isErr(emptyRef)).toBe(true);
  });

  it('refuses an unknown invoice and refuses a payment that would exceed the invoiced amount', async () => {
    const { periodStart, periodEnd, dueDate } = periodDates();
    const invoice = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-OVERPAY',
      invoicedAmountMinorUnits: 10000,
      currency: 'USD',
      dueDate,
    });
    if (!isOk(invoice)) throw new Error('invoice');

    const unknown = await recordInvoicePayment(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      invoiceId: '00000000-0000-0000-0000-000000000000',
      amountMinorUnits: 5000,
      collectedDate: new Date(),
      paymentReference: 'ref',
      reason: 'x',
    });
    expect(isErr(unknown)).toBe(true);
    if (isErr(unknown)) expect(unknown.error.code).toBe('not_found');

    const overpay = await recordInvoicePayment(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      invoiceId: invoice.value.id,
      amountMinorUnits: 10001,
      collectedDate: new Date(),
      paymentReference: 'ref',
      reason: 'x',
    });
    expect(isErr(overpay)).toBe(true);
    if (isErr(overpay)) expect(overpay.error.message).toContain('exceed');
  });

  it('accumulates two partial payments to PARTIALLY_PAID then PAID, each recorded and audited', async () => {
    const { periodStart, periodEnd, dueDate } = periodDates();
    const invoice = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-PARTIAL',
      invoicedAmountMinorUnits: 10000,
      currency: 'USD',
      dueDate,
    });
    if (!isOk(invoice)) throw new Error('invoice');

    const firstPayment = await recordInvoicePayment(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      invoiceId: invoice.value.id,
      amountMinorUnits: 4000,
      collectedDate: new Date('2026-01-01'),
      paymentReference: 'wire-1',
      reason: 'first installment',
    });
    expect(isOk(firstPayment)).toBe(true);
    if (isOk(firstPayment)) {
      expect(firstPayment.value.status).toBe('PARTIALLY_PAID');
      expect(firstPayment.value.collectedAmountMinorUnits).toBe(4000);
    }

    const secondPayment = await recordInvoicePayment(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      invoiceId: invoice.value.id,
      amountMinorUnits: 6000,
      collectedDate: new Date('2026-02-01'),
      paymentReference: 'wire-2',
      reason: 'final installment',
    });
    expect(isOk(secondPayment)).toBe(true);
    if (isOk(secondPayment)) {
      expect(secondPayment.value.status).toBe('PAID');
      expect(secondPayment.value.collectedAmountMinorUnits).toBe(10000);
      expect(secondPayment.value.paymentReference).toBe('wire-2');
    }

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'INVOICE_PAYMENT_RECORDED'));
    expect(events).toHaveLength(2);
  });

  it('refuses recording a payment against a VOID invoice', async () => {
    const { periodStart, periodEnd, dueDate } = periodDates();
    const invoice = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-VOID-PAY',
      invoicedAmountMinorUnits: 10000,
      currency: 'USD',
      dueDate,
    });
    if (!isOk(invoice)) throw new Error('invoice');
    const voided = await voidInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      invoiceId: invoice.value.id,
      reason: 'issued in error',
    });
    expect(isOk(voided)).toBe(true);

    const payment = await recordInvoicePayment(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      invoiceId: invoice.value.id,
      amountMinorUnits: 5000,
      collectedDate: new Date(),
      paymentReference: 'ref',
      reason: 'x',
    });
    expect(isErr(payment)).toBe(true);
    if (isErr(payment)) expect(payment.error.message).toContain('void');
  });

  it('voidInvoice refuses a non-owner, refuses an unknown invoice, is idempotent, and refuses voiding an invoice with any amount collected', async () => {
    const { periodStart, periodEnd, dueDate } = periodDates();
    const invoice = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-VOID-RULES',
      invoicedAmountMinorUnits: 10000,
      currency: 'USD',
      dueDate,
    });
    if (!isOk(invoice)) throw new Error('invoice');
    const strangerId = await seedStranger(db, 'void-auth');

    const notOwner = await voidInvoice(db, {
      actor: { accountId: strangerId, email: 'x@example.com', bootstrapEmails: [] },
      stepUpSatisfied: true,
      invoiceId: invoice.value.id,
      reason: 'x',
    });
    expect(isErr(notOwner)).toBe(true);

    const unknown = await voidInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      invoiceId: '00000000-0000-0000-0000-000000000000',
      reason: 'x',
    });
    expect(isErr(unknown)).toBe(true);
    if (isErr(unknown)) expect(unknown.error.code).toBe('not_found');

    const firstVoid = await voidInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      invoiceId: invoice.value.id,
      reason: 'issued in error',
    });
    expect(isOk(firstVoid)).toBe(true);
    if (isOk(firstVoid)) expect(firstVoid.value.status).toBe('VOID');

    const secondVoid = await voidInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      invoiceId: invoice.value.id,
      reason: 'again',
    });
    expect(isOk(secondVoid)).toBe(true);

    const paidInvoice = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-VOID-AFTER-PAY',
      invoicedAmountMinorUnits: 10000,
      currency: 'USD',
      dueDate,
    });
    if (!isOk(paidInvoice)) throw new Error('invoice');
    await recordInvoicePayment(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      invoiceId: paidInvoice.value.id,
      amountMinorUnits: 1000,
      collectedDate: new Date(),
      paymentReference: 'ref',
      reason: 'partial',
    });
    const voidAfterPayment = await voidInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      invoiceId: paidInvoice.value.id,
      reason: 'trying anyway',
    });
    expect(isErr(voidAfterPayment)).toBe(true);
    if (isErr(voidAfterPayment))
      expect(voidAfterPayment.error.message).toContain('already collected');
  });

  it('listInvoicesForOrganization refuses a non-member and lists newest first', async () => {
    const { periodStart, periodEnd, dueDate } = periodDates();
    const strangerId = await seedStranger(db, 'list-auth');
    const strangerRead = await listInvoicesForOrganization(db, {
      actorAccountId: strangerId,
      organizationId,
    });
    expect(isErr(strangerRead)).toBe(true);

    const first = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-LIST-1',
      invoicedAmountMinorUnits: 1000,
      currency: 'USD',
      dueDate,
    });
    if (!isOk(first)) throw new Error('invoice');
    // S17: a second live invoice for the same plan and period start is refused, so the second
    // invoice is for the next period.
    const samePeriod = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-LIST-SAME',
      invoicedAmountMinorUnits: 2000,
      currency: 'USD',
      dueDate,
    });
    expect(isErr(samePeriod) && samePeriod.error.code).toBe('invalid');
    const second = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart: periodEnd,
      periodEnd: new Date(periodEnd.getTime() + 30 * 24 * 60 * 60 * 1000),
      invoiceRef: 'INV-LIST-2',
      invoicedAmountMinorUnits: 2000,
      currency: 'USD',
      dueDate,
    });
    if (!isOk(second)) throw new Error('invoice');

    const list = await listInvoicesForOrganization(db, {
      actorAccountId: ownerAccountId,
      organizationId,
    });
    expect(isOk(list)).toBe(true);
    if (!isOk(list)) return;
    expect(list.value).toHaveLength(2);
    expect(list.value[0]?.id).toBe(second.value.id);
    expect(list.value[1]?.id).toBe(first.value.id);

    const platformOwnerList = await listInvoicesForOrganization(db, {
      actorAccountId: owner.accountId,
      organizationId,
      actorEmail: owner.actor.email,
      bootstrapEmails: owner.actor.bootstrapEmails,
    });
    expect(isOk(platformOwnerList)).toBe(true);
    if (isOk(platformOwnerList)) expect(platformOwnerList.value).toHaveLength(2);
  });

  it('the database itself refuses collected amount exceeding invoiced amount, even if the service layer were bypassed', async () => {
    const { periodStart, periodEnd, dueDate } = periodDates();
    const invoice = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart,
      periodEnd,
      invoiceRef: 'INV-DB-CONSTRAINT',
      invoicedAmountMinorUnits: 1000,
      currency: 'USD',
      dueDate,
    });
    if (!isOk(invoice)) throw new Error('invoice');

    await expect(
      db
        .update(schema.invoices)
        .set({ collectedAmountMinorUnits: 1001 })
        .where(eq(schema.invoices.id, invoice.value.id)),
    ).rejects.toThrow();
  });

  describe('OPS-04 cash analytics', () => {
    async function cashEvents() {
      return (await db.select().from(schema.productEvents)).filter(
        (e) => e.eventType === 'CASH_COLLECTED',
      );
    }

    async function openInvoice(invoiceRef: string, amount = 10000, currency = 'USD') {
      const { periodStart, periodEnd, dueDate } = periodDates();
      const invoice = await createInvoice(db, {
        actor: owner.actor,
        stepUpSatisfied: true,
        organizationId,
        planId,
        periodStart,
        periodEnd,
        invoiceRef,
        invoicedAmountMinorUnits: amount,
        currency,
        dueDate,
      });
      if (!isOk(invoice)) throw new Error('invoice');
      return invoice.value.id;
    }

    function pay(invoiceId: string, amountMinorUnits: number) {
      return recordInvoicePayment(db, {
        actor: owner.actor,
        stepUpSatisfied: true,
        invoiceId,
        amountMinorUnits,
        collectedDate: new Date(),
        paymentReference: 'bKash TrxID 8N7A6D5E',
        reason: 'Cash handed over by Mr Hasan at the Gulshan office',
      });
    }

    it('records each collection as cash in the invoice currency and minor units, and nothing of the reference or reason', async () => {
      const invoiceId = await openInvoice('INV-OPS04-CASH');
      expect(isOk(await pay(invoiceId, 4000))).toBe(true);
      expect(isOk(await pay(invoiceId, 6000))).toBe(true);

      const events = await cashEvents();
      expect(events.map((e) => e.metricValue).sort()).toEqual([4000, 6000]);
      for (const event of events) {
        expect(event).toMatchObject({
          accountId: null,
          organizationId,
          dimension: 'USD',
        });
      }
      const stored = JSON.stringify(events);
      for (const leaked of ['bKash', '8N7A6D5E', 'Hasan', 'Gulshan', 'INV-OPS04']) {
        expect(stored, leaked).not.toContain(leaked);
      }
    });

    it('writes the currency as a three-letter upper-case code however the invoice spelled it, and drops a spelling that is not a code', async () => {
      const lower = await openInvoice('INV-OPS04-LOWER', 10000, ' bdt ');
      expect(isOk(await pay(lower, 2500))).toBe(true);
      const spelledOut = await openInvoice('INV-OPS04-WORDS', 10000, 'Bangladeshi taka');
      // The payment itself still succeeds; only the analytics label is withheld.
      expect(isOk(await pay(spelledOut, 2500))).toBe(true);

      expect(await cashEvents()).toMatchObject([{ dimension: 'BDT', metricValue: 2500 }]);
    });

    it('records cash only when money is collected, not when an invoice is issued or voided', async () => {
      const invoiceId = await openInvoice('INV-OPS04-NOCASH');
      expect(await cashEvents()).toEqual([]);
      const voided = await voidInvoice(db, {
        actor: owner.actor,
        stepUpSatisfied: true,
        invoiceId,
        reason: 'issued in error',
      });
      expect(isOk(voided)).toBe(true);
      expect(await cashEvents()).toEqual([]);
    });

    it('records nothing for a payment that is refused', async () => {
      const invoiceId = await openInvoice('INV-OPS04-REFUSED');
      const strangerId = await seedStranger(db, 'cash-refused');
      const refused = [
        await pay(invoiceId, 10001),
        await pay(invoiceId, 0),
        await recordInvoicePayment(db, {
          actor: { accountId: strangerId, email: 'x@example.com', bootstrapEmails: [] },
          stepUpSatisfied: true,
          invoiceId,
          amountMinorUnits: 100,
          collectedDate: new Date(),
          paymentReference: 'ref',
          reason: 'x',
        }),
      ];
      expect(refused.map((r) => isErr(r))).toEqual([true, true, true]);
      expect(await cashEvents()).toEqual([]);
    });
  });
});

// Pinned before S17 (recurring invoices and overdue handling) so that work cannot change what a
// person's own billing decisions do: a status a person set keeps naming that person, and paying
// never moves a status a person set.
describe('pinned before S17: a status a person set', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'pinned');
  });

  it('records the person and their reason on every history row, newest first', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'pinned-history');
    await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      initialStatus: 'ACTIVE',
      reason: 'terms agreed',
    });
    const moved = await transitionBillingStatus(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      toStatus: 'GRACE',
      reason: 'late payment agreed by phone',
    });
    expect(isOk(moved)).toBe(true);
    const history = await listBillingStatusHistory(db, {
      actorAccountId: ownerAccountId,
      organizationId,
    });
    if (!isOk(history)) throw new Error('history');
    expect(
      history.value.map((h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        actorAccountId: h.actorAccountId,
        reason: h.reason,
      })),
    ).toEqual([
      {
        fromStatus: 'ACTIVE',
        toStatus: 'GRACE',
        actorAccountId: owner.accountId,
        reason: 'late payment agreed by phone',
      },
      {
        fromStatus: null,
        toStatus: 'ACTIVE',
        actorAccountId: owner.accountId,
        reason: 'terms agreed',
      },
    ]);
  });

  it('keeps a Grace or Suspended status a person set when every invoice is paid in full', async () => {
    const { organizationId } = await seedOrganization(db, 'pinned-paid');
    const plan = await getPlanByKey(db, 'agency_starter');
    if (!plan) throw new Error('seed plan');
    await openBillingAccount(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      initialStatus: 'ACTIVE',
      reason: 'terms agreed',
    });
    for (const toStatus of ['GRACE', 'SUSPENDED'] as const) {
      const moved = await transitionBillingStatus(db, {
        actor: owner.actor,
        stepUpSatisfied: true,
        organizationId,
        toStatus,
        reason: `set by hand to ${toStatus}`,
      });
      expect(isOk(moved)).toBe(true);
      const start = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      const invoice = await createInvoice(db, {
        actor: owner.actor,
        stepUpSatisfied: true,
        organizationId,
        planId: plan.id,
        periodStart: start,
        periodEnd: new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000),
        invoiceRef: `INV-PINNED-${toStatus}`,
        invoicedAmountMinorUnits: 5000,
        currency: 'BDT',
        dueDate: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000),
      });
      if (!isOk(invoice)) throw new Error('invoice');
      const paid = await recordInvoicePayment(db, {
        actor: owner.actor,
        stepUpSatisfied: true,
        invoiceId: invoice.value.id,
        amountMinorUnits: 5000,
        collectedDate: new Date(),
        paymentReference: `bank-${toStatus}`,
        reason: 'paid in full',
      });
      if (!isOk(paid)) throw new Error('payment');
      expect(paid.value.status).toBe('PAID');
      const account = await getBillingAccountForOrganization(db, {
        actorAccountId: owner.accountId,
        organizationId,
        actorEmail: `owner-pinned@platform.example.com`,
      });
      if (!isOk(account)) throw new Error('account');
      expect(account.value?.status).toBe(toStatus);
    }
  });
});
