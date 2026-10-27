import { randomUUID } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, desc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import { createInvoice, recordInvoicePayment } from './billing';
import type { Db } from './db';
import { createOrganization, reviewOrganization } from './organizations';
import {
  type PaymentAttempt,
  RECENT_ATTEMPT_MS,
  decideSettlement,
  getInvoicePaymentAttempts,
  getPaymentResultView,
  isMerchantTranId,
  newMerchantTranId,
  paymentResultState,
  reconcilePaymentAttempts,
  refreshInvoicePaymentAttempts,
  settlePaymentAttempt,
  startOnlinePayment,
} from './payments';
import { FakePaymentPort } from './payments.test-support';
import { getPlanByKey } from './plans';
import { grantPlatformRole } from './platform-roles';
import type { PaymentPort, PaymentValidation } from './ports';
import { RATE_LIMITS } from './rate-limit';
import { exhaustRateLimit } from './rate-limit.test-support';

const STORE_PASSWORD_MARKER = 'store-password-that-must-never-appear';

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

async function seedPlatformOwner(db: Db, tag: string) {
  const p = await provisionAccount(db, { email: `owner-${tag}@platform.example.com` });
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

async function seedOrganization(db: Db, tag: string) {
  const ownerAcc = await provisionAccount(db, { email: `org-owner-${tag}@acme.com` });
  if (!isOk(ownerAcc)) throw new Error('provision');
  const org = await createOrganization(db, {
    actorAccountId: ownerAcc.value.id,
    name: `Acme ${tag}`,
  });
  if (!isOk(org)) throw new Error('org');
  const reviewer = await provisionAccount(db, { email: `reviewer-${tag}@platform.example.com` });
  if (!isOk(reviewer)) throw new Error('reviewer');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
  return { organizationId: org.value.id, ownerAccountId: ownerAcc.value.id };
}

const urlFor = (kind: string, tran: string) => `https://app.example.test/pay/${kind}?t=${tran}`;

describe('online invoice payments (S11)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  let org: Awaited<ReturnType<typeof seedOrganization>>;
  let planId: string;
  let port: FakePaymentPort;

  beforeEach(async () => {
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'pay');
    org = await seedOrganization(db, 'pay');
    const plan = await getPlanByKey(db, 'agency_starter');
    if (!plan) throw new Error('seed plan');
    planId = plan.id;
    port = new FakePaymentPort();
  });

  async function openInvoice(ref: string, amount = 125000, currency = 'BDT') {
    const now = new Date();
    const invoice = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId: org.organizationId,
      planId,
      periodStart: now,
      periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      invoiceRef: ref,
      invoicedAmountMinorUnits: amount,
      currency,
      dueDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
    });
    if (!isOk(invoice)) throw new Error('invoice');
    return invoice.value.id;
  }

  async function start(invoiceId: string, overrides: Record<string, unknown> = {}) {
    return startOnlinePayment(db, port, {
      actorAccountId: org.ownerAccountId,
      invoiceId,
      urlFor,
      ...overrides,
    });
  }

  /** An invoice with a started payment; the gateway has been told about it. */
  async function startedAttempt(ref: string, amount = 125000) {
    const invoiceId = await openInvoice(ref, amount);
    const started = await start(invoiceId);
    if (!isOk(started) || started.value.kind !== 'redirect') throw new Error('start');
    const attempt = (await attemptsOf(invoiceId))[0];
    if (!attempt) throw new Error('attempt');
    return { invoiceId, attempt, tran: attempt.merchantTranId };
  }

  const ledger = () => db.select().from(schema.invoicePayments);
  const invoiceRow = async (id: string) =>
    (await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)))[0];
  const attemptRow = async (id: string) =>
    (await db.select().from(schema.paymentAttempts).where(eq(schema.paymentAttempts.id, id)))[0];
  const attemptsOf = (invoiceId: string) =>
    db
      .select()
      .from(schema.paymentAttempts)
      .where(eq(schema.paymentAttempts.invoiceId, invoiceId))
      .orderBy(desc(schema.paymentAttempts.createdAt));
  const settle = (
    tran: string,
    valId: string | null = null,
    source: 'ipn' | 'return' | 'reconcile' | 'refresh' = 'ipn',
    now?: Date,
  ) =>
    settlePaymentAttempt(db, port, {
      merchantTranId: tran,
      valId,
      source,
      ...(now ? { now } : {}),
    });
  const backdate = (attemptId: string, redirectedAt: Date) =>
    db
      .update(schema.paymentAttempts)
      .set({ redirectedAt, createdAt: redirectedAt })
      .where(eq(schema.paymentAttempts.id, attemptId));
  const auditTypes = async (type: string) =>
    db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, type));

  describe('merchant transaction ids', () => {
    it('are long, random, shaped for the gateway and never repeat', () => {
      const ids = new Set(Array.from({ length: 200 }, () => newMerchantTranId()));
      expect(ids.size).toBe(200);
      for (const id of ids) {
        expect(isMerchantTranId(id)).toBe(true);
        expect(id.length).toBeLessThanOrEqual(30);
      }
      for (const bad of ['', 'VSP', 'vsp0123456789abcdef0123456789', 'VSPZZZ', `${[...ids][0]}x`]) {
        expect(isMerchantTranId(bad), bad).toBe(false);
      }
    });
  });

  describe('starting a payment', () => {
    it('opens the gateway for the whole outstanding balance and keeps the attempt redirected', async () => {
      const invoiceId = await openInvoice('INV-S11-1', 125000);
      const result = await start(invoiceId);
      expect(isOk(result) && result.value.kind).toBe('redirect');
      if (!isOk(result) || result.value.kind !== 'redirect') return;
      expect(result.value.redirectUrl).toContain('sandbox.sslcommerz.com');
      const attempt = await attemptRow(result.value.attemptId);
      expect(attempt).toMatchObject({
        invoiceId,
        organizationId: org.organizationId,
        provider: 'sslcommerz',
        amountMinorUnits: 125000,
        currency: 'BDT',
        status: 'REDIRECTED',
        initiatedByAccountId: org.ownerAccountId,
      });
      expect(attempt?.providerSessionKey).toBeTruthy();
      expect(attempt?.redirectedAt).toBeInstanceOf(Date);
      const checkout = port.checkouts[0];
      expect(checkout).toMatchObject({
        amountMinorUnits: 125000,
        currency: 'BDT',
        invoiceRef: 'INV-S11-1',
        merchantTranId: attempt?.merchantTranId,
      });
      expect(checkout?.urls.ipn).toContain('/pay/ipn');
      expect(checkout?.urls.success).toContain(attempt?.merchantTranId ?? 'x');
      // Nothing is counted by starting.
      expect(await ledger()).toHaveLength(0);
      expect((await invoiceRow(invoiceId))?.status).toBe('OPEN');
    });

    it('asks for what is still owed on a part-paid invoice, not the invoiced total', async () => {
      const invoiceId = await openInvoice('INV-S11-PART', 100000);
      const partial = await recordInvoicePayment(db, {
        actor: owner.actor,
        stepUpSatisfied: true,
        invoiceId,
        amountMinorUnits: 40000,
        collectedDate: new Date(),
        paymentReference: 'wire',
        reason: 'confirmed',
        idempotencyKey: randomUUID(),
      });
      expect(isOk(partial)).toBe(true);
      const result = await start(invoiceId);
      expect(isOk(result)).toBe(true);
      expect(port.checkouts[0]?.amountMinorUnits).toBe(60000);
    });

    it('lets only an owner or admin of the agency start, and shows anyone else "not found"', async () => {
      const invoiceId = await openInvoice('INV-S11-AUTH');
      const manager = await provisionAccount(db, { email: 'manager@acme.com' });
      const reviewer = await provisionAccount(db, { email: 'reviewer@acme.com' });
      const formerAdmin = await provisionAccount(db, { email: 'former-admin@acme.com' });
      const outsider = await provisionAccount(db, { email: 'outsider@elsewhere.com' });
      if (!isOk(manager) || !isOk(reviewer) || !isOk(formerAdmin) || !isOk(outsider)) {
        throw new Error('accounts');
      }
      await db.insert(schema.memberships).values([
        { accountId: manager.value.id, organizationId: org.organizationId, role: 'CASE_MANAGER' },
        { accountId: reviewer.value.id, organizationId: org.organizationId, role: 'REVIEWER' },
        {
          accountId: formerAdmin.value.id,
          organizationId: org.organizationId,
          role: 'ADMIN',
          active: false,
        },
      ]);
      for (const actor of [
        manager.value.id,
        reviewer.value.id,
        formerAdmin.value.id,
        outsider.value.id,
        randomUUID(),
      ]) {
        const result = await start(invoiceId, { actorAccountId: actor });
        expect(isErr(result) && result.error.code).toBe('not_found');
      }
      const missing = await start(randomUUID());
      expect(isErr(missing) && missing.error.code).toBe('not_found');
      expect(port.checkouts).toHaveLength(0);
      expect(await db.select().from(schema.paymentAttempts)).toHaveLength(0);
    });

    it('refuses invoices that are paid, void, not in taka, or when payments are not configured', async () => {
      const paid = await openInvoice('INV-S11-PAID', 5000);
      await recordInvoicePayment(db, {
        actor: owner.actor,
        stepUpSatisfied: true,
        invoiceId: paid,
        amountMinorUnits: 5000,
        collectedDate: new Date(),
        paymentReference: 'wire',
        reason: 'confirmed',
        idempotencyKey: randomUUID(),
      });
      expect(isErr(await start(paid))).toBe(true);
      const usd = await openInvoice('INV-S11-USD', 5000, 'USD');
      const usdResult = await start(usd);
      expect(isErr(usdResult) && usdResult.error.message).toContain('taka');
      const open = await openInvoice('INV-S11-OFF', 5000);
      const unconfigured = { ...port, configured: false } as unknown as PaymentPort;
      const off = await startOnlinePayment(db, unconfigured, {
        actorAccountId: org.ownerAccountId,
        invoiceId: open,
        urlFor,
      });
      expect(isErr(off) && off.error.message).toContain('not available');
      expect(port.checkouts).toHaveLength(0);
      expect(await db.select().from(schema.paymentAttempts)).toHaveLength(0);
    });

    it('closes the attempt as failed, tells the payer nothing was charged, and leaves nothing redirected when the gateway cannot open a page', async () => {
      const invoiceId = await openInvoice('INV-S11-FAILSTART');
      port.checkoutBehaviour = 'throw';
      const failed = await start(invoiceId);
      expect(isErr(failed) && failed.error.message).toBe(
        'We could not open the payment page. Nothing was charged. Try again.',
      );
      port.checkoutBehaviour = 'hang';
      const timedOut = await start(invoiceId, { timeoutMs: 20 });
      expect(isErr(timedOut) && timedOut.error.code).toBe('upstream_error');
      const attempts = await attemptsOf(invoiceId);
      expect(attempts).toHaveLength(2);
      expect(attempts.every((a) => a.status === 'FAILED' && a.reasonCode === 'start_failed')).toBe(
        true,
      );
      expect(attempts.some((a) => a.status === 'REDIRECTED')).toBe(false);
      // A failed start can be tried again straight away.
      port.checkoutBehaviour = 'ok';
      expect(isOk(await start(invoiceId))).toBe(true);
    });

    it('offers a recent unfinished payment before starting another, for 30 minutes', async () => {
      const { invoiceId, attempt } = await startedAttempt('INV-S11-RECENT');
      const again = await start(invoiceId);
      expect(isOk(again) && again.value.kind).toBe('recent_attempt');
      if (isOk(again) && again.value.kind === 'recent_attempt') {
        expect(again.value.attemptId).toBe(attempt.id);
      }
      expect(port.checkouts).toHaveLength(1);
      const forced = await start(invoiceId, { startAnother: true });
      expect(isOk(forced) && forced.value.kind).toBe('redirect');
      const later = await start(invoiceId, {
        now: new Date(Date.now() + RECENT_ATTEMPT_MS + 60_000),
      });
      expect(isOk(later) && later.value.kind).toBe('redirect');
    });

    it('starts only one payment when two clicks arrive together, and treats a payment still being opened as recent', async () => {
      const invoiceId = await openInvoice('INV-S11-DOUBLE');
      const results = await Promise.all([start(invoiceId), start(invoiceId)]);
      expect(results.every((r) => isOk(r))).toBe(true);
      const kinds = results.map((r) => (isOk(r) ? r.value.kind : 'error')).sort();
      expect(kinds).toEqual(['recent_attempt', 'redirect']);
      expect(port.checkouts).toHaveLength(1);
      expect(await attemptsOf(invoiceId)).toHaveLength(1);
      // An attempt that is still being opened (no gateway page yet) also counts as recent...
      const other = await openInvoice('INV-S11-INFLIGHT');
      await db.insert(schema.paymentAttempts).values({
        invoiceId: other,
        organizationId: org.organizationId,
        provider: 'sslcommerz',
        merchantTranId: newMerchantTranId(),
        amountMinorUnits: 125000,
        currency: 'BDT',
        status: 'CREATED',
      });
      const blocked = await start(other);
      expect(isOk(blocked) && blocked.value.kind).toBe('recent_attempt');
      // ...but only for a minute: an old unfinished CREATED attempt does not block a new payment.
      const later = await start(other, { now: new Date(Date.now() + 5 * 60 * 1000) });
      expect(isOk(later) && later.value.kind).toBe('redirect');
    });

    it('limits how often one person may start payments', async () => {
      const invoiceId = await openInvoice('INV-S11-LIMIT');
      await exhaustRateLimit(db, org.ownerAccountId, 'payments.start', RATE_LIMITS.PAYMENT_START);
      const result = await start(invoiceId);
      expect(isErr(result) && result.error.code).toBe('rate_limited');
      expect(port.checkouts).toHaveLength(0);
    });

    it('does not let a refused person spend the rest of the agency allowance', async () => {
      const invoiceId = await openInvoice('INV-S11-LIMIT-ORG');
      await exhaustRateLimit(db, org.ownerAccountId, 'payments.start', RATE_LIMITS.PAYMENT_START);
      for (let i = 0; i < 5; i++) await start(invoiceId);
      const buckets = await db
        .select()
        .from(schema.rateLimitBuckets)
        .where(eq(schema.rateLimitBuckets.action, 'payments.start_org'));
      expect(buckets).toHaveLength(0);
    });

    it('audits the start with ids and amounts only, never a credential or address', async () => {
      const { invoiceId } = await startedAttempt('INV-S11-AUDIT');
      const [started] = await auditTypes('PAYMENT_ATTEMPT_STARTED');
      expect(started?.metadata).toMatchObject({
        invoiceId,
        organizationId: org.organizationId,
        amountMinorUnits: 125000,
        currency: 'BDT',
        provider: 'sslcommerz',
      });
      expect(JSON.stringify(started)).not.toMatch(/https?:|passw|session/i);
    });
  });

  describe('settling a payment with the gateway', () => {
    it('counts a gateway-confirmed payment once, in the ledger, as an online payment', async () => {
      const { invoiceId, attempt, tran } = await startedAttempt('INV-S11-HAPPY');
      const gateway = port.succeed(tran, 125000);
      const outcome = await settle(tran, gateway.valId);
      expect(outcome).toEqual({ code: 'recorded', attemptStatus: 'RECORDED' });
      expect(port.validationCalls).toEqual([gateway.valId]);
      const rows = await ledger();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        invoiceId,
        kind: 'ONLINE',
        sourceId: attempt.id,
        amountMinorUnits: 125000,
        currency: 'BDT',
        provider: 'sslcommerz',
        providerTransactionId: gateway.valId,
        recordedByAccountId: null,
      });
      expect(await invoiceRow(invoiceId)).toMatchObject({
        status: 'PAID',
        collectedAmountMinorUnits: 125000,
      });
      expect(await attemptRow(attempt.id)).toMatchObject({
        status: 'RECORDED',
        providerValId: gateway.valId,
        bankTranId: gateway.bankTranId,
        riskLevel: 0,
      });
      expect((await attemptRow(attempt.id))?.recordedAt).toBeInstanceOf(Date);
    });

    it('asks the gateway by transaction id when the callback carried no validation id', async () => {
      const { tran } = await startedAttempt('INV-S11-QUERY');
      port.succeed(tran, 125000);
      expect((await settle(tran, null)).code).toBe('recorded');
      expect(port.queryCalls).toEqual([tran]);
      expect(port.validationCalls).toEqual([]);
    });

    it('records nothing for a forged callback: the gateway does not know the validation id', async () => {
      const { invoiceId, attempt, tran } = await startedAttempt('INV-S11-FORGED');
      const outcome = await settle(tran, 'FORGED12345678');
      expect(outcome).toEqual({ code: 'rejected', attemptStatus: 'REDIRECTED' });
      expect(port.validationCalls).toEqual(['FORGED12345678']);
      expect(await ledger()).toHaveLength(0);
      expect((await invoiceRow(invoiceId))?.status).toBe('OPEN');
      expect((await attemptRow(attempt.id))?.status).toBe('REDIRECTED');
      const rejected = await auditTypes('PAYMENT_CALLBACK_REJECTED');
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBe('provider_invalid');
    });

    it('ignores a callback that claims success while the gateway says the payment failed or is pending', async () => {
      const { invoiceId, tran } = await startedAttempt('INV-S11-CLAIM');
      port.end(tran, 'PENDING');
      expect((await settle(tran, null)).code).toBe('pending');
      port.end(tran, 'FAILED');
      expect((await settle(tran, null)).code).toBe('failed');
      expect(await ledger()).toHaveLength(0);
      expect((await invoiceRow(invoiceId))?.status).toBe('OPEN');
    });

    it('cannot be used to put a payment for one invoice on another', async () => {
      const a = await startedAttempt('INV-S11-A', 50000);
      const b = await startedAttempt('INV-S11-B', 50000);
      const paidA = port.succeed(a.tran, 50000);
      // A callback for B that carries the validation id of A's real payment.
      const outcome = await settle(b.tran, paidA.valId);
      expect(outcome.code).toBe('rejected');
      expect((await invoiceRow(b.invoiceId))?.status).toBe('OPEN');
      expect((await attemptRow(b.attempt.id))?.status).toBe('REDIRECTED');
      expect(await ledger()).toHaveLength(0);
      // A's own callback still lands on A, and only on A.
      expect((await settle(a.tran, paidA.valId)).code).toBe('recorded');
      expect((await ledger()).map((r) => r.invoiceId)).toEqual([a.invoiceId]);
      expect((await invoiceRow(b.invoiceId))?.status).toBe('OPEN');
    });

    it('holds a payment whose amount is not the attempt amount, and counts nothing', async () => {
      const { invoiceId, attempt, tran } = await startedAttempt('INV-S11-AMOUNT');
      const gateway = port.succeed(tran, 100);
      expect(await settle(tran, gateway.valId)).toEqual({
        code: 'held',
        attemptStatus: 'HELD_FOR_REVIEW',
      });
      expect(await attemptRow(attempt.id)).toMatchObject({
        status: 'HELD_FOR_REVIEW',
        reasonCode: 'mismatch',
      });
      expect(await ledger()).toHaveLength(0);
      expect((await invoiceRow(invoiceId))?.collectedAmountMinorUnits).toBe(0);
      const [mismatch] = await auditTypes('PAYMENT_VALIDATION_MISMATCH');
      expect(mismatch?.metadata).toMatchObject({ checks: ['amount'] });
    });

    it('holds a payment in another currency, one with no amount, and one for another store', async () => {
      const cases: Array<[string, Partial<PaymentValidation>, string[]]> = [
        ['INV-S11-CUR', { currency: 'USD' }, ['currency']],
        ['INV-S11-NOCUR', { currency: null }, ['currency']],
        ['INV-S11-NOAMT', { amountMinorUnits: null }, ['amount']],
        ['INV-S11-STORE', { storeId: 'someone-elses-store' }, ['store']],
      ];
      for (const [ref, overrides, checks] of cases) {
        const { invoiceId, attempt, tran } = await startedAttempt(ref);
        const gateway = port.succeed(tran, 125000, overrides);
        expect((await settle(tran, gateway.valId)).code, ref).toBe('held');
        expect((await attemptRow(attempt.id))?.status, ref).toBe('HELD_FOR_REVIEW');
        expect((await invoiceRow(invoiceId))?.collectedAmountMinorUnits, ref).toBe(0);
        const events = await auditTypes('PAYMENT_VALIDATION_MISMATCH');
        expect(events.at(-1)?.metadata, ref).toMatchObject({ checks });
      }
      expect(await ledger()).toHaveLength(0);
    });

    it('holds a risky payment, and one whose risk the gateway did not state, without counting it', async () => {
      for (const [ref, riskLevel, reason] of [
        ['INV-S11-RISK', 1, 'risky_payment'],
        ['INV-S11-NORISK', null, 'risk_unknown'],
      ] as const) {
        const { attempt, tran } = await startedAttempt(ref);
        const gateway = port.succeed(tran, 125000, { riskLevel });
        expect((await settle(tran, gateway.valId)).code, ref).toBe('held');
        expect(await attemptRow(attempt.id), ref).toMatchObject({
          status: 'HELD_FOR_REVIEW',
          reasonCode: reason,
        });
      }
      expect(await ledger()).toHaveLength(0);
    });

    it('records one ledger row however many times and ways the same payment arrives', async () => {
      const { invoiceId, tran } = await startedAttempt('INV-S11-REPLAY');
      const gateway = port.succeed(tran, 125000);
      const first = await settle(tran, gateway.valId, 'ipn');
      const replay = await settle(tran, gateway.valId, 'ipn');
      const browser = await settle(tran, gateway.valId, 'return');
      const refresh = await settle(tran, null, 'refresh');
      const reconcile = await settle(tran, null, 'reconcile');
      expect(first.code).toBe('recorded');
      for (const later of [replay, browser, refresh, reconcile]) {
        expect(later.code).toBe('already_recorded');
      }
      expect(await ledger()).toHaveLength(1);
      expect((await invoiceRow(invoiceId))?.collectedAmountMinorUnits).toBe(125000);
      // Once recorded, the gateway is not asked again.
      expect(port.validationCalls).toHaveLength(1);
      expect(port.queryCalls).toHaveLength(0);
    });

    it('records once when the notification, the browser return and a refresh arrive together', async () => {
      const { invoiceId, tran } = await startedAttempt('INV-S11-RACE');
      const gateway = port.succeed(tran, 125000);
      const results = await Promise.all([
        settle(tran, gateway.valId, 'ipn'),
        settle(tran, gateway.valId, 'return'),
        settle(tran, null, 'refresh'),
      ]);
      expect(results.filter((r) => r.code === 'recorded')).toHaveLength(1);
      expect(results.every((r) => r.code === 'recorded' || r.code === 'already_recorded')).toBe(
        true,
      );
      expect(await ledger()).toHaveLength(1);
      expect((await invoiceRow(invoiceId))?.collectedAmountMinorUnits).toBe(125000);
      expect(await auditTypes('INVOICE_PAYMENT_RECORDED')).toHaveLength(1);
    });

    it('leaves the invoice unpaid when the payment fails, is cancelled or expires, and says so on the attempt only', async () => {
      for (const [ref, ended, code, status] of [
        ['INV-S11-FAIL', 'FAILED', 'failed', 'FAILED'],
        ['INV-S11-CANCEL', 'CANCELLED', 'cancelled', 'CANCELLED'],
        ['INV-S11-EXP', 'EXPIRED', 'expired', 'EXPIRED'],
      ] as const) {
        const { invoiceId, attempt, tran } = await startedAttempt(ref);
        port.end(tran, ended);
        expect((await settle(tran)).code, ref).toBe(code);
        expect((await attemptRow(attempt.id))?.status, ref).toBe(status);
        expect((await invoiceRow(invoiceId))?.status, ref).toBe('OPEN');
        expect(paymentResultState(status)).toBe('not_completed');
      }
      expect(await ledger()).toHaveLength(0);
    });

    it('counts a success that arrives after the payment was closed as failed or expired, once', async () => {
      const { invoiceId, attempt, tran } = await startedAttempt('INV-S11-LATE');
      port.end(tran, 'EXPIRED');
      expect((await settle(tran)).code).toBe('expired');
      const gateway = port.succeed(tran, 125000);
      expect((await settle(tran, gateway.valId)).code).toBe('recorded');
      expect((await settle(tran, gateway.valId)).code).toBe('already_recorded');
      expect(await ledger()).toHaveLength(1);
      expect((await attemptRow(attempt.id))?.status).toBe('RECORDED');
      expect((await invoiceRow(invoiceId))?.status).toBe('PAID');
    });

    it('does not let a closed payment go back or sideways when the gateway reports another ending', async () => {
      const { attempt, tran } = await startedAttempt('INV-S11-SIDEWAYS');
      port.end(tran, 'CANCELLED');
      await settle(tran);
      port.end(tran, 'FAILED');
      expect((await settle(tran)).code).toBe('cancelled');
      expect((await attemptRow(attempt.id))?.status).toBe('CANCELLED');
    });

    it('holds money for an invoice that was settled another way meanwhile, never adding it', async () => {
      const { invoiceId, attempt, tran } = await startedAttempt('INV-S11-ALREADY');
      await recordInvoicePayment(db, {
        actor: owner.actor,
        stepUpSatisfied: true,
        invoiceId,
        amountMinorUnits: 125000,
        collectedDate: new Date(),
        paymentReference: 'bank transfer',
        reason: 'confirmed',
        idempotencyKey: randomUUID(),
      });
      const gateway = port.succeed(tran, 125000);
      expect((await settle(tran, gateway.valId)).code).toBe('held');
      expect(await attemptRow(attempt.id)).toMatchObject({
        status: 'HELD_FOR_REVIEW',
        reasonCode: 'already_paid',
      });
      expect(await ledger()).toHaveLength(1);
      expect((await invoiceRow(invoiceId))?.collectedAmountMinorUnits).toBe(125000);
      expect(paymentResultState('HELD_FOR_REVIEW')).toBe('needs_check');
    });

    it('holds money for a void invoice', async () => {
      const { invoiceId, attempt, tran } = await startedAttempt('INV-S11-VOID');
      await db
        .update(schema.invoices)
        .set({ status: 'VOID' })
        .where(eq(schema.invoices.id, invoiceId));
      const gateway = port.succeed(tran, 125000);
      expect((await settle(tran, gateway.valId)).code).toBe('held');
      expect((await attemptRow(attempt.id))?.reasonCode).toBe('invoice_void');
      expect(await ledger()).toHaveLength(0);
    });

    it('holds a validation id that another payment already used', async () => {
      const first = await startedAttempt('INV-S11-VAL1', 50000);
      const second = await startedAttempt('INV-S11-VAL2', 50000);
      const firstPaid = port.succeed(first.tran, 50000);
      expect((await settle(first.tran, firstPaid.valId)).code).toBe('recorded');
      // The gateway (wrongly) reports the same validation id for the second payment.
      port.succeed(second.tran, 50000, { valId: firstPaid.valId });
      expect((await settle(second.tran, null)).code).toBe('held');
      expect((await attemptRow(second.attempt.id))?.providerValId).toBeNull();
      expect(await ledger()).toHaveLength(1);
    });

    it('fails closed and retries when the gateway cannot be asked', async () => {
      const { invoiceId, attempt, tran } = await startedAttempt('INV-S11-OUTAGE');
      const gateway = port.succeed(tran, 125000);
      port.outage = true;
      expect(await settle(tran, gateway.valId)).toEqual({
        code: 'unavailable',
        attemptStatus: 'REDIRECTED',
      });
      expect(await settle(tran, null)).toEqual({
        code: 'unavailable',
        attemptStatus: 'REDIRECTED',
      });
      expect(await ledger()).toHaveLength(0);
      expect((await attemptRow(attempt.id))?.status).toBe('REDIRECTED');
      expect((await invoiceRow(invoiceId))?.status).toBe('OPEN');
      // The gateway is back: the same payment now settles.
      port.outage = false;
      expect((await settle(tran, gateway.valId)).code).toBe('recorded');
      expect(await ledger()).toHaveLength(1);
    });

    it('does not call the gateway for an unknown or malformed transaction id', async () => {
      expect((await settle(newMerchantTranId(), 'VALID123456')).code).toBe('unknown_transaction');
      expect((await settle('not-a-transaction')).code).toBe('unknown_transaction');
      expect(port.validationCalls).toHaveLength(0);
      expect(port.queryCalls).toHaveLength(0);
    });

    it('ignores a malformed validation id and asks by transaction id instead', async () => {
      const { tran } = await startedAttempt('INV-S11-BADVAL');
      port.succeed(tran, 125000);
      expect((await settle(tran, "x' or '1'='1")).code).toBe('recorded');
      expect(port.validationCalls).toHaveLength(0);
      expect(port.queryCalls).toEqual([tran]);
    });

    it('limits how often one payment may make VisaStack call the gateway', async () => {
      const { tran } = await startedAttempt('INV-S11-RATE');
      port.end(tran, 'PENDING');
      await exhaustRateLimit(db, tran, 'payments.callback', RATE_LIMITS.PAYMENT_CALLBACK_TRAN);
      expect((await settle(tran)).code).toBe('rate_limited');
      expect(port.queryCalls).toHaveLength(0);
      // Reconciliation is not a callback and is not held back by that limit.
      expect((await settle(tran, null, 'reconcile')).code).toBe('pending');
    });

    it('does nothing when payments are not configured', async () => {
      const { tran } = await startedAttempt('INV-S11-NOCONF');
      const unconfigured = { ...port, configured: false } as unknown as PaymentPort;
      const outcome = await settlePaymentAttempt(db, unconfigured, {
        merchantTranId: tran,
        source: 'ipn',
      });
      expect(outcome.code).toBe('not_configured');
    });

    it('leaves the payment open when the cash ledger is not there yet', async () => {
      const { attempt, tran } = await startedAttempt('INV-S11-NOLEDGER');
      const gateway = port.succeed(tran, 125000);
      await db.execute(sql`drop table invoice_payments cascade`);
      expect(await settle(tran, gateway.valId)).toEqual({
        code: 'unavailable',
        attemptStatus: 'REDIRECTED',
      });
      expect((await attemptRow(attempt.id))?.status).toBe('REDIRECTED');
    });

    it('keeps secrets, gateway ids and addresses out of every audit record', async () => {
      const { tran } = await startedAttempt('INV-S11-NOSECRETS');
      const paid = port.succeed(tran, 125000);
      await settle('FORGEDTRAN', 'FORGED12345678');
      await settle(tran, 'FORGED12345678');
      await settle(tran, paid.valId);
      const bad = await startedAttempt('INV-S11-NOSECRETS2');
      const wrong = port.succeed(bad.tran, 5, { storeId: STORE_PASSWORD_MARKER });
      await settle(bad.tran, wrong.valId);
      const events = await db.select().from(schema.auditEvents);
      const text = JSON.stringify(events);
      expect(text).not.toContain(paid.valId ?? 'never');
      expect(text).not.toContain(paid.bankTranId ?? 'never');
      expect(text).not.toContain(STORE_PASSWORD_MARKER);
      expect(text).not.toMatch(/sslcommerz\.com|store_passwd|session/i);
      const types = new Set(events.map((e) => e.eventType));
      expect(types.has('PAYMENT_ATTEMPT_STATUS_CHANGED')).toBe(true);
    });
  });

  describe('deciding what a gateway answer means', () => {
    const attempt: Pick<
      PaymentAttempt,
      'merchantTranId' | 'amountMinorUnits' | 'currency' | 'status' | 'redirectedAt'
    > = {
      merchantTranId: 'VSP00000000000000000000000a',
      amountMinorUnits: 1000,
      currency: 'BDT',
      status: 'REDIRECTED',
      redirectedAt: new Date('2026-10-27T00:00:00Z'),
    };
    const good: PaymentValidation = {
      status: 'VALID',
      merchantTranId: attempt.merchantTranId,
      valId: 'VAL123456',
      amountMinorUnits: 1000,
      currency: 'bdt',
      bankTranId: 'B1',
      riskLevel: 0,
      storeId: 'teststore',
    };
    const decide = (v: Partial<PaymentValidation>, extra: Record<string, unknown> = {}) =>
      decideSettlement({
        attempt,
        validation: { ...good, ...v },
        path: 'validation',
        requestedValId: 'VAL123456',
        storeId: 'teststore',
        now: new Date('2026-10-27T01:00:00Z'),
        mayExpire: false,
        ...extra,
      });

    it('records only when every check passes (currency compared without case)', () => {
      expect(decide({})).toEqual({ kind: 'record', valId: 'VAL123456' });
    });

    it('names each failed check', () => {
      expect(decide({ amountMinorUnits: 999 })).toMatchObject({ kind: 'hold', checks: ['amount'] });
      expect(decide({ currency: 'USD' })).toMatchObject({ kind: 'hold', checks: ['currency'] });
      expect(decide({ storeId: 'other' })).toMatchObject({ kind: 'hold', checks: ['store'] });
      expect(decide({ valId: 'DIFFERENT1' })).toMatchObject({
        kind: 'hold',
        checks: ['payment_id'],
      });
      expect(decide({ amountMinorUnits: 1, currency: 'USD' })).toMatchObject({
        checks: ['amount', 'currency'],
      });
    });

    it('rejects an answer about another payment or an invalid one, and never holds for it', () => {
      expect(decide({ merchantTranId: 'VSP0000000000000000000000ff' })).toEqual({
        kind: 'reject',
        reason: 'transaction_mismatch',
      });
      expect(decide({ merchantTranId: null })).toMatchObject({ kind: 'reject' });
      expect(decide({ status: 'INVALID' })).toEqual({ kind: 'reject', reason: 'provider_invalid' });
    });

    it('accepts an answer that names no transaction only when it came from a query by that transaction', () => {
      expect(decide({ merchantTranId: null }, { path: 'query' })).toEqual({
        kind: 'record',
        valId: 'VAL123456',
      });
    });

    it('expires an unconfirmed payment only after 24 hours and only when allowed to', () => {
      const later = new Date('2026-10-28T00:00:01Z');
      expect(decide({ status: 'PENDING' }, { now: later, mayExpire: true })).toEqual({
        kind: 'close',
        status: 'EXPIRED',
      });
      expect(decide({ status: 'PENDING' }, { now: later, mayExpire: false })).toEqual({
        kind: 'wait',
      });
      expect(decide({ status: 'UNATTEMPTED' }, { mayExpire: true })).toEqual({ kind: 'wait' });
    });
  });

  describe('reconciliation', () => {
    const scope = () => systemScopeForTest('process-payment-reconciliation');

    it('settles payments left open for more than 15 minutes and leaves newer ones alone', async () => {
      const old = await startedAttempt('INV-S11-REC-OLD');
      const fresh = await startedAttempt('INV-S11-REC-NEW');
      port.succeed(old.tran, 125000);
      port.succeed(fresh.tran, 125000);
      await backdate(old.attempt.id, new Date(Date.now() - 30 * 60 * 1000));
      const summary = await reconcilePaymentAttempts(db, scope(), port);
      expect(summary).toMatchObject({ available: true, configured: true, checked: 1, recorded: 1 });
      expect((await attemptRow(old.attempt.id))?.status).toBe('RECORDED');
      expect((await attemptRow(fresh.attempt.id))?.status).toBe('REDIRECTED');
      expect(port.queryCalls).toEqual([old.tran]);
      expect(await ledger()).toHaveLength(1);
    });

    it('closes a payment still unconfirmed after 24 hours as expired, and not before', async () => {
      const young = await startedAttempt('INV-S11-REC-23H');
      const stale = await startedAttempt('INV-S11-REC-25H');
      port.end(young.tran, 'PENDING');
      port.end(stale.tran, 'PENDING');
      await backdate(young.attempt.id, new Date(Date.now() - 23 * 60 * 60 * 1000));
      await backdate(stale.attempt.id, new Date(Date.now() - 25 * 60 * 60 * 1000));
      const summary = await reconcilePaymentAttempts(db, scope(), port);
      expect(summary).toMatchObject({ checked: 2, closed: 1, stillPending: 1 });
      expect((await attemptRow(young.attempt.id))?.status).toBe('REDIRECTED');
      expect((await attemptRow(stale.attempt.id))?.status).toBe('EXPIRED');
      expect((await invoiceRow(stale.invoiceId))?.status).toBe('OPEN');
    });

    it('still finds a late success on an expired payment for 7 days, and then stops asking', async () => {
      const within = await startedAttempt('INV-S11-REC-LATE');
      const beyond = await startedAttempt('INV-S11-REC-VERYLATE');
      for (const a of [within, beyond]) {
        await db
          .update(schema.paymentAttempts)
          .set({ status: 'EXPIRED' })
          .where(eq(schema.paymentAttempts.id, a.attempt.id));
        port.succeed(a.tran, 125000);
      }
      await backdate(within.attempt.id, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
      await backdate(beyond.attempt.id, new Date(Date.now() - 9 * 24 * 60 * 60 * 1000));
      const summary = await reconcilePaymentAttempts(db, scope(), port);
      expect(summary.recorded).toBe(1);
      expect((await attemptRow(within.attempt.id))?.status).toBe('RECORDED');
      expect((await attemptRow(beyond.attempt.id))?.status).toBe('EXPIRED');
      expect(port.queryCalls).toEqual([within.tran]);
    });

    it('asks about live payments before abandoned expired ones, and rotates through the expired', async () => {
      const abandoned = [];
      for (let i = 0; i < 4; i++) {
        const started = await startedAttempt(`INV-S11-REC-ABANDON-${i}`);
        await db
          .update(schema.paymentAttempts)
          .set({
            status: 'EXPIRED',
            redirectedAt: new Date(Date.now() - (6 - i) * 60 * 60 * 1000),
            lastCheckedAt: i < 2 ? new Date(Date.now() - 60 * 60 * 1000) : null,
          })
          .where(eq(schema.paymentAttempts.id, started.attempt.id));
        port.end(started.tran, 'PENDING');
        abandoned.push(started);
      }
      const live = await startedAttempt('INV-S11-REC-LIVE');
      await backdate(live.attempt.id, new Date(Date.now() - 30 * 60 * 1000));
      port.succeed(live.tran, 125000);
      // Room for only two payments: the live one first, then the expired one never asked about.
      const summary = await reconcilePaymentAttempts(
        db,
        systemScopeForTest('process-payment-reconciliation'),
        port,
        { limit: 2 },
      );
      expect(summary.recorded).toBe(1);
      expect((await attemptRow(live.attempt.id))?.status).toBe('RECORDED');
      expect(port.queryCalls).toHaveLength(2);
      expect(port.queryCalls[0]).toBe(live.tran);
      // The one asked about next is a never-asked expired payment, not the longest-waiting one.
      const second = abandoned.find((a) => a.tran === port.queryCalls[1]);
      const row = second ? await attemptRow(second.attempt.id) : undefined;
      expect(row?.lastCheckedAt).not.toBeNull();
      const neverAsked = abandoned.slice(2).map((a) => a.tran);
      expect(neverAsked).toContain(port.queryCalls[1]);
    });

    it('reports how many confirmed payments are waiting for someone to look at them', async () => {
      const a = await startedAttempt('INV-S11-REC-HELD-A');
      const b = await startedAttempt('INV-S11-REC-HELD-B');
      port.succeed(a.tran, 1);
      await settle(a.tran, null);
      port.succeed(b.tran, 2);
      await settle(b.tran, null);
      const summary = await reconcilePaymentAttempts(
        db,
        systemScopeForTest('process-payment-reconciliation'),
        port,
      );
      expect(summary.awaitingReview).toBe(2);
    });

    it('closes an attempt that never reached the gateway as failed after an hour', async () => {
      const invoiceId = await openInvoice('INV-S11-REC-STALE');
      const [attempt] = await db
        .insert(schema.paymentAttempts)
        .values({
          invoiceId,
          organizationId: org.organizationId,
          provider: 'sslcommerz',
          merchantTranId: newMerchantTranId(),
          amountMinorUnits: 1000,
          currency: 'BDT',
          status: 'CREATED',
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        })
        .returning();
      if (!attempt) throw new Error('attempt');
      const summary = await reconcilePaymentAttempts(db, scope(), port);
      expect(summary.closed).toBe(1);
      expect(await attemptRow(attempt.id)).toMatchObject({
        status: 'FAILED',
        reasonCode: 'start_incomplete',
      });
      expect(port.queryCalls).toHaveLength(0);
    });

    it('stops after three gateway outages in a row and reports them, deciding nothing', async () => {
      const attempts = [];
      for (let i = 0; i < 5; i++) {
        const started = await startedAttempt(`INV-S11-REC-DOWN-${i}`);
        await backdate(started.attempt.id, new Date(Date.now() - 60 * 60 * 1000));
        attempts.push(started);
      }
      port.outage = true;
      const summary = await reconcilePaymentAttempts(db, scope(), port);
      expect(summary).toMatchObject({ unavailable: 3, recorded: 0, checked: 3 });
      expect(await ledger()).toHaveLength(0);
      for (const a of attempts) expect((await attemptRow(a.attempt.id))?.status).toBe('REDIRECTED');
    });

    it('reports an unconfigured provider without touching anything, and refuses the wrong job scope', async () => {
      const unconfigured = { ...port, configured: false } as unknown as PaymentPort;
      expect(await reconcilePaymentAttempts(db, scope(), unconfigured)).toMatchObject({
        configured: false,
        checked: 0,
      });
      await expect(
        reconcilePaymentAttempts(
          db,
          systemScopeForTest('process-rate-limit-prune') as unknown as ReturnType<typeof scope>,
          port,
        ),
      ).rejects.toThrow(/wrong job scope/);
    });

    const admin = () => ({
      actorAccountId: org.ownerAccountId,
      organizationId: org.organizationId,
    });

    it('settles the open payments of one invoice when it is opened, with an explicit check ignoring age', async () => {
      const { invoiceId, tran, attempt } = await startedAttempt('INV-S11-REFRESH');
      port.succeed(tran, 125000);
      // Too young for the ordinary refresh.
      const young = await refreshInvoicePaymentAttempts(db, port, { ...admin(), invoiceId });
      expect(isOk(young) && young.value.checked).toBe(0);
      const checked = await refreshInvoicePaymentAttempts(db, port, {
        ...admin(),
        invoiceId,
        minAgeMs: 0,
      });
      expect(isOk(checked) && checked.value).toMatchObject({ checked: 1, recorded: 1 });
      expect((await attemptRow(attempt.id))?.status).toBe('RECORDED');
    });

    it('asks about several open payments together, so opening an invoice waits one gateway call', async () => {
      const invoiceId = await openInvoice('INV-S11-REFRESH-MANY');
      for (let i = 0; i < 3; i++) {
        const started = await start(invoiceId, { startAnother: true });
        expect(isOk(started)).toBe(true);
      }
      const rows = await attemptsOf(invoiceId);
      for (const row of rows) port.end(row.merchantTranId, 'PENDING');
      const result = await refreshInvoicePaymentAttempts(db, port, {
        ...admin(),
        invoiceId,
        minAgeMs: 0,
      });
      expect(isOk(result) && result.value).toMatchObject({ checked: 3, stillPending: 3 });
    });

    it('lets only the agency owners and admins, or platform staff, refresh or list an invoice payments, inside its own agency', async () => {
      const { invoiceId, attempt } = await startedAttempt('INV-S11-SCOPE');
      const stranger = await provisionAccount(db, { email: 'stranger@elsewhere.com' });
      if (!isOk(stranger)) throw new Error('stranger');
      const otherOrg = await seedOrganization(db, 'other');
      const base = { organizationId: org.organizationId, invoiceId };
      // Not a member at all.
      const refused = await refreshInvoicePaymentAttempts(db, port, {
        ...base,
        actorAccountId: stranger.value.id,
      });
      expect(isErr(refused) && refused.error.code).toBe('forbidden');
      const hidden = await getInvoicePaymentAttempts(db, {
        ...base,
        actorAccountId: stranger.value.id,
      });
      expect(isErr(hidden) && hidden.error.code).toBe('forbidden');
      // An admin of another agency, naming their own agency or this one: never this invoice.
      for (const organizationId of [otherOrg.organizationId, org.organizationId]) {
        const result = await getInvoicePaymentAttempts(db, {
          actorAccountId: otherOrg.ownerAccountId,
          organizationId,
          invoiceId,
        });
        expect(isErr(result)).toBe(true);
      }
      expect(port.queryCalls).toHaveLength(0);
      // The agency sees its attempt without gateway identifiers, reason codes or the transaction id.
      const agency = await getInvoicePaymentAttempts(db, { ...admin(), invoiceId });
      expect(isOk(agency) && agency.value).toHaveLength(1);
      if (!isOk(agency)) return;
      expect(agency.value[0]).toMatchObject({
        id: attempt.id,
        status: 'REDIRECTED',
        amountMinorUnits: 125000,
        reasonCode: null,
        merchantTranId: null,
      });
      expect(JSON.stringify(agency.value)).not.toMatch(/Session|BANK|VAL|S1/);
      // Platform staff also see the plain reason and the transaction id.
      const staff = await getInvoicePaymentAttempts(db, {
        actorAccountId: owner.accountId,
        actorEmail: owner.actor.email,
        bootstrapEmails: [],
        organizationId: org.organizationId,
        invoiceId,
      });
      expect(isOk(staff) && staff.value[0]?.merchantTranId).toBe(attempt.merchantTranId);
    });
  });

  describe('what the payer is told', () => {
    it('maps every attempt state to one of four plain results', async () => {
      expect(paymentResultState('RECORDED')).toBe('received');
      expect(paymentResultState('REDIRECTED')).toBe('confirming');
      expect(paymentResultState('CREATED')).toBe('confirming');
      expect(paymentResultState(null)).toBe('confirming');
      expect(paymentResultState('HELD_FOR_REVIEW')).toBe('needs_check');
      for (const s of ['FAILED', 'CANCELLED', 'EXPIRED'] as const) {
        expect(paymentResultState(s)).toBe('not_completed');
      }
    });

    it('shows the payment own state from the database, and nothing for an unknown id', async () => {
      const { tran } = await startedAttempt('INV-S11-VIEW');
      expect(await getPaymentResultView(db, tran)).toMatchObject({
        state: 'confirming',
        invoiceRef: 'INV-S11-VIEW',
        amountMinorUnits: 125000,
        currency: 'BDT',
      });
      const gateway = port.succeed(tran, 125000);
      await settle(tran, gateway.valId);
      expect((await getPaymentResultView(db, tran))?.state).toBe('received');
      expect(await getPaymentResultView(db, newMerchantTranId())).toBeNull();
      expect(await getPaymentResultView(db, 'garbage')).toBeNull();
    });
  });

  describe('before migration 0096 (the attempts table is missing)', () => {
    beforeEach(async () => {
      await db.execute(sql`drop table payment_attempts`);
    });

    it('reports not available yet instead of failing, and records nothing', async () => {
      const invoiceId = await openInvoice('INV-S11-NOTABLE');
      const started = await start(invoiceId);
      expect(isErr(started) && started.error.message).toContain('not available');
      expect(port.checkouts).toHaveLength(0);
      expect((await settle(newMerchantTranId(), 'VALID123456')).code).toBe('unavailable');
      expect(
        await reconcilePaymentAttempts(
          db,
          systemScopeForTest('process-payment-reconciliation'),
          port,
        ),
      ).toMatchObject({ available: false });
      const refreshed = await refreshInvoicePaymentAttempts(db, port, {
        actorAccountId: org.ownerAccountId,
        organizationId: org.organizationId,
        invoiceId,
      });
      expect(isOk(refreshed) && refreshed.value).toMatchObject({ available: false });
      expect(await getPaymentResultView(db, newMerchantTranId())).toBeNull();
      const listed = await getInvoicePaymentAttempts(db, {
        actorAccountId: org.ownerAccountId,
        organizationId: org.organizationId,
        invoiceId,
      });
      expect(isOk(listed) && listed.value).toEqual([]);
      expect(await ledger()).toHaveLength(0);
      expect(
        (
          await db
            .select()
            .from(schema.invoices)
            .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.status, 'OPEN')))
        ).length,
      ).toBe(1);
    });
  });
});
