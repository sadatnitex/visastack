import { randomUUID } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { staffPrincipal } from './access/principal';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import { createInvoice, recordInvoicePayment } from './billing';
import type { Db } from './db';
import { countLedgerTestRows, exportLedgerMonth } from './ledger-export';
import { createOrganization, reviewOrganization } from './organizations';
import {
  MODE_CHANGED,
  TEST_PAYMENTS_ONLY,
  reconcilePaymentAttempts,
  settlePaymentAttempt,
  startOnlinePayment,
} from './payments';
import { FakePaymentPort } from './payments.test-support';
import { getPlanByKey } from './plans';
import { grantPlatformRole } from './platform-roles';
import {
  MODE_CHANGED_CODE,
  checkRefundsNow,
  getOrganizationRefundWork,
  requestRefund,
} from './refunds';

/**
 * S29 test payments (ADR 0020 S29 amendment, audit M2): every online payment and ledger row says
 * TEST or LIVE; in test mode only the platform owner can start a payment; test rows never reach
 * the accounting file; a payment never crosses modes.
 */

const DAY = 24 * 60 * 60 * 1000;
const urlFor = (kind: string, tran: string) => `https://app.example.test/pay/${kind}?t=${tran}`;

/** How often the "has migration 0107 run" question reached the database (S29 round 3). */
let schemaProbes = 0;

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), {
    schema,
    logger: {
      logQuery: (query: string) => {
        if (query.includes("to_regclass('plan_prices')")) schemaProbes++;
      },
    },
  }) as unknown as Db;
}

async function account(db: Db, email: string): Promise<string> {
  const created = await provisionAccount(db, { email });
  if (!isOk(created)) throw new Error('provision');
  return created.value.id;
}

describe('test payments (S29)', () => {
  let db: Db;
  let port: FakePaymentPort;
  let ownerId: string;
  const ownerEmail = 'owner-s29@platform.example.com';
  let organizationId: string;
  let agencyOwnerId: string;
  let planId: string;
  let seq = 0;

  beforeEach(async () => {
    db = await freshDb();
    port = new FakePaymentPort();
    port.mode = 'TEST';
    ownerId = await account(db, ownerEmail);
    const granted = await grantPlatformRole(db, {
      actor: { accountId: ownerId, email: ownerEmail, bootstrapEmails: [ownerEmail] },
      targetAccountId: ownerId,
      role: 'PLATFORM_OWNER',
      reason: 'seed',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');
    agencyOwnerId = await account(db, 'agency-owner-s29@acme.example.com');
    const org = await createOrganization(db, { actorAccountId: agencyOwnerId, name: 'Acme S29' });
    if (!isOk(org)) throw new Error('org');
    organizationId = org.value.id;
    const reviewer = await account(db, 'reviewer-s29@platform.example.com');
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: reviewer,
      organizationId,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('review');
    // The platform owner also runs this (test) agency, as the owner would in the pilot.
    await db
      .insert(schema.memberships)
      .values({ accountId: ownerId, organizationId, role: 'ADMIN', active: true });
    const plan = await getPlanByKey(db, 'agency_starter');
    if (!plan) throw new Error('plan');
    planId = plan.id;
  });

  async function openInvoice(ref: string, amount = 5000): Promise<string> {
    const now = Date.now();
    const created = await createInvoice(db, {
      actor: { accountId: ownerId, email: ownerEmail, bootstrapEmails: [] },
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart: new Date(now + seq * 31 * DAY),
      periodEnd: new Date(now + (seq++ * 31 + 30) * DAY),
      invoiceRef: ref,
      invoicedAmountMinorUnits: amount,
      currency: 'BDT',
      dueDate: new Date(now + 14 * DAY),
    });
    if (!isOk(created)) throw new Error('invoice');
    return created.value.id;
  }

  const start = (invoiceId: string, actorAccountId: string, email: string) =>
    startOnlinePayment(db, port, {
      actorAccountId,
      actorEmail: email,
      bootstrapEmails: [],
      invoiceId,
      urlFor,
    });

  const attemptsOf = (invoiceId: string) =>
    db.select().from(schema.paymentAttempts).where(eq(schema.paymentAttempts.invoiceId, invoiceId));

  async function paidTestPayment(ref: string) {
    const invoiceId = await openInvoice(ref);
    const started = await start(invoiceId, ownerId, ownerEmail);
    expect(isOk(started)).toBe(true);
    const [attempt] = await attemptsOf(invoiceId);
    if (!attempt) throw new Error('attempt');
    const paid = port.succeed(attempt.merchantTranId, 5000);
    const settled = await settlePaymentAttempt(db, port, {
      merchantTranId: attempt.merchantTranId,
      valId: paid.valId,
      source: 'ipn',
    });
    expect(settled.code).toBe('recorded');
    return { invoiceId, attempt };
  }

  it('lets only the platform owner start a payment in test mode, with a typed reason for anyone else', async () => {
    const invoiceId = await openInvoice('INV-S29-AGENCY');
    const refused = await start(invoiceId, agencyOwnerId, 'agency-owner-s29@acme.example.com');
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) {
      expect(refused.error.reason).toBe('test_mode_owner_only');
      expect(refused.error.message).toBe(TEST_PAYMENTS_ONLY);
    }
    // Nothing was written and the gateway was never asked.
    expect(await attemptsOf(invoiceId)).toHaveLength(0);
    expect(port.checkouts).toHaveLength(0);

    const started = await start(invoiceId, ownerId, ownerEmail);
    expect(isOk(started)).toBe(true);
    const [attempt] = await attemptsOf(invoiceId);
    expect(attempt?.mode).toBe('TEST');
  });

  it('lets an agency owner pay in live mode and marks the payment LIVE', async () => {
    port.mode = 'LIVE';
    const invoiceId = await openInvoice('INV-S29-LIVE');
    const started = await start(invoiceId, agencyOwnerId, 'agency-owner-s29@acme.example.com');
    expect(isOk(started)).toBe(true);
    const [attempt] = await attemptsOf(invoiceId);
    expect(attempt?.mode).toBe('LIVE');
  });

  it('copies TEST to the ledger row and leaves test rows out of the accounting file', async () => {
    const { invoiceId } = await paidTestPayment('INV-S29-PAID');
    const rows = await db
      .select()
      .from(schema.invoicePayments)
      .where(eq(schema.invoicePayments.invoiceId, invoiceId));
    expect(rows.map((r) => [r.kind, r.mode])).toEqual([['ONLINE', 'TEST']]);

    // A real payment recorded by staff the same month is LIVE and is in the file.
    const other = await openInvoice('INV-S29-CASH');
    const recorded = await recordInvoicePayment(db, {
      actor: { accountId: ownerId, email: ownerEmail, bootstrapEmails: [] },
      stepUpSatisfied: true,
      invoiceId: other,
      amountMinorUnits: 5000,
      collectedDate: new Date(),
      paymentReference: 'CASH-S29',
      reason: 'Paid in cash at the office',
    });
    expect(isOk(recorded)).toBe(true);

    const scope = await staffPrincipal(
      db,
      { accountId: ownerId, email: ownerEmail, bootstrapEmails: [] },
      'BILLING_LEDGER_EXPORT',
    );
    if (!isOk(scope)) throw new Error('scope');
    const month = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: '2-digit',
    })
      .format(new Date())
      .slice(0, 7);
    const file = await exportLedgerMonth(db, scope.value, { month, stepUpSatisfied: true });
    if (!isOk(file)) throw new Error('export');
    expect(file.value.rowCount).toBe(1);
    expect(file.value.testRowsLeftOut).toBe(1);
    expect(file.value.csv).toContain('CASH-S29');
    expect(file.value.csv).not.toContain('INV-S29-PAID');
    const counted = await countLedgerTestRows(db, scope.value, month);
    expect(isOk(counted) && counted.value).toBe(1);
  });

  it('closes an open payment as expired (mode_changed) when the mode changed, without asking the gateway', async () => {
    const invoiceId = await openInvoice('INV-S29-SWITCH');
    expect(isOk(await start(invoiceId, ownerId, ownerEmail))).toBe(true);
    const [attempt] = await attemptsOf(invoiceId);
    if (!attempt) throw new Error('attempt');
    port.mode = 'LIVE';
    const settled = await settlePaymentAttempt(db, port, {
      merchantTranId: attempt.merchantTranId,
      valId: null,
      source: 'reconcile',
    });
    expect(settled.code).toBe('expired');
    const [after] = await attemptsOf(invoiceId);
    expect(after?.status).toBe('EXPIRED');
    expect(after?.reasonCode).toBe(MODE_CHANGED);
    expect(port.queryCalls).toHaveLength(0);
    expect(port.validationCalls).toHaveLength(0);
  });

  it('never refunds a test payment through the live gateway', async () => {
    const { invoiceId } = await paidTestPayment('INV-S29-REFUND');
    const [entry] = await db
      .select()
      .from(schema.invoicePayments)
      .where(eq(schema.invoicePayments.invoiceId, invoiceId));
    if (!entry) throw new Error('entry');
    port.mode = 'LIVE';
    const scope = await staffPrincipal(
      db,
      { accountId: ownerId, email: ownerEmail, bootstrapEmails: [] },
      'BILLING_REFUND_MANAGE',
    );
    if (!isOk(scope)) throw new Error('scope');
    const asked = await requestRefund(db, port, scope.value, {
      organizationId,
      source: { kind: 'entry', invoicePaymentId: entry.id },
      amountMinorUnits: 1000,
      reason: 'Test refund',
      idempotencyKey: randomUUID(),
      stepUpSatisfied: true,
    });
    expect(isErr(asked)).toBe(true);
    if (isErr(asked)) expect(asked.error.reason).toBe('test_payment_live_gateway');
    expect(port.refundCalls).toHaveLength(0);
  });

  it('refuses a test-mode row for a reported or staff-recorded payment at the database', async () => {
    const invoiceId = await openInvoice('INV-S29-CHECK');
    await expect(
      db.insert(schema.invoicePayments).values({
        invoiceId,
        amountMinorUnits: 100,
        currency: 'BDT',
        kind: 'ADMIN_RECORDED',
        reference: 'X',
        collectedDate: new Date(),
        recordedByAccountId: ownerId,
        mode: 'TEST',
      }),
    ).rejects.toThrow();
  });

  it('leaves a live payment open and unasked while the gateway is in test mode (round 2)', async () => {
    port.mode = 'LIVE';
    const invoiceId = await openInvoice('INV-S29-LIVE-OPEN');
    expect(isOk(await start(invoiceId, agencyOwnerId, 'agency-owner-s29@acme.example.com'))).toBe(
      true,
    );
    const [attempt] = await attemptsOf(invoiceId);
    if (!attempt) throw new Error('attempt');
    port.mode = 'TEST';
    const seen = await settlePaymentAttempt(db, port, {
      merchantTranId: attempt.merchantTranId,
      valId: null,
      source: 'reconcile',
    });
    expect(seen.code).toBe('pending');
    const [still] = await attemptsOf(invoiceId);
    expect(still?.status).toBe(attempt.status);
    expect(still?.reasonCode).toBeNull();
    expect(port.queryCalls).toHaveLength(0);
    // Live again: the usual check, late success included, records it.
    port.mode = 'LIVE';
    const paid = port.succeed(attempt.merchantTranId, 5000);
    const settled = await settlePaymentAttempt(db, port, {
      merchantTranId: attempt.merchantTranId,
      valId: paid.valId,
      source: 'ipn',
    });
    expect(settled.code).toBe('recorded');
  });

  it('never asks the other mode about a sent refund: it is marked Needs a Check once (round 2)', async () => {
    const { invoiceId } = await paidTestPayment('INV-S29-REFUND-CHECK');
    const [entry] = await db
      .select()
      .from(schema.invoicePayments)
      .where(eq(schema.invoicePayments.invoiceId, invoiceId));
    if (!entry) throw new Error('entry');
    const scope = await staffPrincipal(
      db,
      { accountId: ownerId, email: ownerEmail, bootstrapEmails: [] },
      'BILLING_REFUND_MANAGE',
    );
    if (!isOk(scope)) throw new Error('scope');
    // Sent while the gateway was in test mode.
    const sent = await requestRefund(db, port, scope.value, {
      organizationId,
      source: { kind: 'entry', invoicePaymentId: entry.id },
      amountMinorUnits: 1000,
      reason: 'Test refund',
      idempotencyKey: randomUUID(),
      stepUpSatisfied: true,
    });
    expect(isOk(sent)).toBe(true);
    // The panel does not offer a gateway refund of a test payment to the live gateway.
    const work = await getOrganizationRefundWork(db, scope.value, {
      organizationId,
      gatewayProvider: 'sslcommerz',
      gatewayMode: 'LIVE',
    });
    expect(isOk(work) && work.value.entries.every((e) => !e.viaGateway)).toBe(true);
    port.mode = 'LIVE';
    for (let run = 0; run < 2; run++) {
      const checked = await checkRefundsNow(db, port, scope.value, { organizationId });
      expect(isOk(checked) && checked.value.needsCheck).toBe(1);
    }
    expect(port.refundQueries).toHaveLength(0);
    const [request] = await db.select().from(schema.refundRequests);
    expect(request?.failureCode).toBe(MODE_CHANGED_CODE);
    const marks = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'INVOICE_REFUND_NEEDS_CHECK'));
    expect(marks).toHaveLength(1);
  });

  it('keeps an earlier Needs a Check mark when the mode changes, and does not record it again (round 3)', async () => {
    const { invoiceId } = await paidTestPayment('INV-S29-KEEP-MARK');
    const [entry] = await db
      .select()
      .from(schema.invoicePayments)
      .where(eq(schema.invoicePayments.invoiceId, invoiceId));
    if (!entry) throw new Error('entry');
    const scope = await staffPrincipal(
      db,
      { accountId: ownerId, email: ownerEmail, bootstrapEmails: [] },
      'BILLING_REFUND_MANAGE',
    );
    if (!isOk(scope)) throw new Error('scope');
    const sent = await requestRefund(db, port, scope.value, {
      organizationId,
      source: { kind: 'entry', invoicePaymentId: entry.id },
      amountMinorUnits: 1000,
      reason: 'Test refund',
      idempotencyKey: randomUUID(),
      stepUpSatisfied: true,
    });
    expect(isOk(sent)).toBe(true);
    // An earlier check already marked it (the ledger refused the refund row).
    await db.update(schema.refundRequests).set({ failureCode: 'ledger_refused' });
    const marksBefore = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'INVOICE_REFUND_NEEDS_CHECK'));
    port.mode = 'LIVE';
    const checked = await checkRefundsNow(db, port, scope.value, { organizationId });
    expect(isOk(checked) && checked.value.needsCheck).toBe(1);
    const [request] = await db.select().from(schema.refundRequests);
    expect(request?.failureCode).toBe('ledger_refused');
    const marksAfter = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'INVOICE_REFUND_NEEDS_CHECK'));
    expect(marksAfter).toHaveLength(marksBefore.length);
    expect(port.refundQueries).toHaveLength(0);
  });

  it('gives live payments no room in the check while the gateway is in test mode (round 3)', async () => {
    port.mode = 'LIVE';
    const liveIds: string[] = [];
    for (const ref of ['INV-S29-LIVE-A', 'INV-S29-LIVE-B', 'INV-S29-LIVE-C']) {
      const invoiceId = await openInvoice(ref);
      expect(isOk(await start(invoiceId, agencyOwnerId, 'agency-owner-s29@acme.example.com'))).toBe(
        true,
      );
      liveIds.push(invoiceId);
    }
    // One live payment was already closed as expired (it could still turn out paid, live only).
    const [closedLive] = await attemptsOf(liveIds[2] ?? '');
    if (!closedLive) throw new Error('attempt');
    await db
      .update(schema.paymentAttempts)
      .set({ status: 'EXPIRED', reasonCode: 'expired' })
      .where(eq(schema.paymentAttempts.id, closedLive.id));
    port.mode = 'TEST';
    const testInvoice = await openInvoice('INV-S29-TEST-LATE');
    expect(isOk(await start(testInvoice, ownerId, ownerEmail))).toBe(true);
    const [testAttempt] = await attemptsOf(testInvoice);
    if (!testAttempt) throw new Error('attempt');
    port.succeed(testAttempt.merchantTranId, 5000);
    const summary = await reconcilePaymentAttempts(
      db,
      systemScopeForTest('process-payment-reconciliation'),
      port,
      { now: new Date(Date.now() + 60 * 60 * 1000), limit: 2 },
    );
    expect(summary.recorded).toBe(1);
    expect(summary.stillPending).toBe(0);
    const [paid] = await attemptsOf(testInvoice);
    expect(paid?.status).toBe('RECORDED');
    for (const invoiceId of liveIds) {
      const [live] = await attemptsOf(invoiceId);
      expect(live?.reasonCode === null || live?.reasonCode === 'expired').toBe(true);
    }
    const [stillLive] = await attemptsOf(liveIds[0] ?? '');
    expect(stillLive?.status).toBe('REDIRECTED');
  });

  it('asks whether the plans tables exist once, not inside every settlement (round 3)', async () => {
    await paidTestPayment('INV-S29-WARM');
    const invoiceId = await openInvoice('INV-S29-PROBES');
    expect(isOk(await start(invoiceId, ownerId, ownerEmail))).toBe(true);
    const [attempt] = await attemptsOf(invoiceId);
    if (!attempt) throw new Error('attempt');
    const paid = port.succeed(attempt.merchantTranId, 5000);
    schemaProbes = 0;
    const settled = await settlePaymentAttempt(db, port, {
      merchantTranId: attempt.merchantTranId,
      valId: paid.valId,
      source: 'ipn',
    });
    expect(settled.code).toBe('recorded');
    expect(schemaProbes).toBe(0);
  });
});
