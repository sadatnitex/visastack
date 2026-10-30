import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite, migrationsFolder } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { staffPrincipal } from './access/principal';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import { listAgencyInvoices } from './agency-invoices';
import {
  createInvoice,
  getBillingAccountForOrganization,
  openBillingAccount,
  recordInvoicePayment,
  transitionBillingStatus,
} from './billing';
import { REFUNDED_INVOICE_STAFF_MESSAGE } from './billing';
import { overdueInvoices } from './billing-standing';
import type { Db } from './db';
import { REFUNDED_INVOICE_MESSAGE, applyInvoiceCollection } from './invoice-ledger';
import {
  LEDGER_CSV_COLUMNS,
  exportLedgerMonth,
  ledgerCsvCell,
  ledgerMonthBounds,
} from './ledger-export';
import { submitManualPaymentClaim } from './manual-claims';
import { createOrganization, reviewOrganization } from './organizations';
import {
  newMerchantTranId,
  reconcilePaymentAttempts,
  settlePaymentAttempt,
  startOnlinePayment,
} from './payments';
import { FakePaymentPort } from './payments.test-support';
import { ledgerColumns } from './plans-schema';
import { grantPlatformRole } from './platform-roles';
import {
  AMOUNT_MISMATCH,
  DUPLICATE_REFERENCE_CODE,
  NEEDS_CHECK_CODE,
  REFERENCE_TAKEN,
  REFUNDS_UNAVAILABLE,
  REFUND_WORK_LIMIT,
  RETRY_REFUSED_CODE,
  RETRY_REFUSED_MESSAGE,
  applyHeldPaymentCredit,
  cancelRefund,
  checkRefundsNow,
  confirmUnsentRefund,
  entryRefundableMinorUnits,
  getOrganizationRefundWork,
  heldRemainingMinorUnits,
  reconcileRefunds,
  recordManualRefund,
  requestRefund,
  retryRefund,
} from './refunds';

const DAY = 24 * 60 * 60 * 1000;
const TIMEOUT = 120_000;

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

async function account(db: Db, email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!isOk(made)) throw new Error('provision');
  return made.value.id;
}

interface World {
  readonly db: Db;
  readonly owner: { readonly accountId: string; readonly email: string };
  readonly actor: { accountId: string; email: string; bootstrapEmails: string[] };
  readonly organizationId: string;
  readonly orgOwnerId: string;
  readonly caseManagerId: string;
  readonly planId: string;
}

async function world(db: Db, tag: string, platform?: World): Promise<World> {
  const ownerEmail = platform?.owner.email ?? `owner-${tag}@platform.example.com`;
  const ownerId = platform?.owner.accountId ?? (await account(db, ownerEmail));
  if (!platform) {
    const granted = await grantPlatformRole(db, {
      actor: { accountId: ownerId, email: ownerEmail, bootstrapEmails: [ownerEmail] },
      targetAccountId: ownerId,
      role: 'PLATFORM_OWNER',
      reason: 'seed',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');
  }
  const actor = { accountId: ownerId, email: ownerEmail, bootstrapEmails: [] as string[] };
  const orgOwnerId = await account(db, `agency-owner-${tag}@acme.example.com`);
  const org = await createOrganization(db, { actorAccountId: orgOwnerId, name: `Acme ${tag}` });
  if (!isOk(org)) throw new Error('org');
  const reviewer = await account(db, `reviewer-${tag}@platform.example.com`);
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
  const caseManagerId = await account(db, `agency-cm-${tag}@acme.example.com`);
  await db.insert(schema.memberships).values({
    accountId: caseManagerId,
    organizationId: org.value.id,
    role: 'CASE_MANAGER',
    active: true,
  });
  const plan = (
    await db
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(eq(schema.plans.key, 'agency_pro'))
  )[0];
  if (!plan) throw new Error('plan');
  const opened = await openBillingAccount(db, {
    actor,
    stepUpSatisfied: true,
    organizationId: org.value.id,
    initialStatus: 'ACTIVE',
    reason: 'terms agreed',
  });
  if (!isOk(opened)) throw new Error('billing account');
  return {
    db,
    owner: { accountId: ownerId, email: ownerEmail },
    actor,
    organizationId: org.value.id,
    orgOwnerId,
    caseManagerId,
    planId: plan.id,
  };
}

let periodSeq = 0;
async function invoice(
  w: World,
  ref: string,
  amount: number,
  due = new Date(Date.now() + 14 * DAY),
) {
  const start = new Date(Date.UTC(2020, 0, 1) + periodSeq++ * 40 * DAY);
  const made = await createInvoice(w.db, {
    actor: w.actor,
    stepUpSatisfied: true,
    organizationId: w.organizationId,
    planId: w.planId,
    periodStart: start,
    periodEnd: new Date(start.getTime() + 30 * DAY),
    invoiceRef: ref,
    invoicedAmountMinorUnits: amount,
    currency: 'BDT',
    dueDate: due,
  });
  if (!isOk(made)) throw new Error(`invoice: ${made.error.message}`);
  return made.value.id;
}

/** A payment typed in by the platform owner: a ledger entry that can only be refunded outside VisaStack. */
async function paidByHand(w: World, invoiceId: string, amount: number) {
  const recorded = await recordInvoicePayment(w.db, {
    actor: w.actor,
    stepUpSatisfied: true,
    invoiceId,
    amountMinorUnits: amount,
    collectedDate: new Date(),
    paymentReference: 'BANK-IN-1',
    reason: 'transfer seen',
    idempotencyKey: randomUUID(),
  });
  if (!isOk(recorded)) throw new Error(`pay: ${recorded.error.message}`);
  return entryOf(w, invoiceId, 'ADMIN_RECORDED');
}

/** A gateway-confirmed online payment, counted: an attempt RECORDED and its ONLINE ledger entry. */
async function paidOnline(w: World, invoiceId: string, amount: number) {
  const tran = newMerchantTranId();
  const valId = `VAL${tran.slice(3, 15)}`;
  const [attempt] = await w.db
    .insert(schema.paymentAttempts)
    .values({
      mode: 'LIVE',
      invoiceId,
      organizationId: w.organizationId,
      provider: 'sslcommerz',
      merchantTranId: tran,
      amountMinorUnits: amount,
      currency: 'BDT',
      status: 'RECORDED',
      providerValId: valId,
      bankTranId: `BANK${tran.slice(3, 11)}`,
      riskLevel: 0,
      recordedAt: new Date(),
    })
    .returning();
  if (!attempt) throw new Error('attempt');
  await w.db.transaction(async (tx) => {
    const applied = await applyInvoiceCollection(tx, {
      invoiceId,
      amountMinorUnits: amount,
      currency: 'BDT',
      kind: 'ONLINE',
      sourceId: attempt.id,
      provider: 'sslcommerz',
      providerTransactionId: valId,
      reference: attempt.bankTranId ?? tran,
      collectedDate: new Date(),
      recordedByAccountId: null,
    });
    if (!applied.ok) throw new Error(`online: ${applied.error.message}`);
  });
  return { attempt, entry: await entryOf(w, invoiceId, 'ONLINE') };
}

/** Money the gateway confirmed that VisaStack held (the invoice was settled another way). */
async function heldPayment(
  w: World,
  invoiceId: string,
  amount: number,
  reasonCode = 'already_paid',
) {
  const tran = newMerchantTranId();
  const [attempt] = await w.db
    .insert(schema.paymentAttempts)
    .values({
      mode: 'LIVE',
      invoiceId,
      organizationId: w.organizationId,
      provider: 'sslcommerz',
      merchantTranId: tran,
      amountMinorUnits: amount,
      currency: 'BDT',
      status: 'HELD_FOR_REVIEW',
      reasonCode,
      providerValId: `VAL${tran.slice(3, 15)}`,
      bankTranId: `BANK${tran.slice(3, 11)}`,
      riskLevel: 0,
    })
    .returning();
  if (!attempt) throw new Error('held');
  return attempt;
}

async function entryOf(w: World, invoiceId: string, kind: 'ONLINE' | 'ADMIN_RECORDED' | 'CREDIT') {
  const rows = await w.db
    .select(ledgerColumns())
    .from(schema.invoicePayments)
    .where(
      and(eq(schema.invoicePayments.invoiceId, invoiceId), eq(schema.invoicePayments.kind, kind)),
    );
  const row = rows.at(-1);
  if (!row) throw new Error('entry');
  return row;
}

async function scopeOf(w: World) {
  const minted = await staffPrincipal(
    w.db,
    { accountId: w.owner.accountId, email: w.owner.email, bootstrapEmails: [] },
    'BILLING_REFUND_MANAGE',
  );
  if (!isOk(minted)) throw new Error('scope');
  return minted.value;
}

async function exportScopeOf(w: World) {
  const minted = await staffPrincipal(
    w.db,
    { accountId: w.owner.accountId, email: w.owner.email, bootstrapEmails: [] },
    'BILLING_LEDGER_EXPORT',
  );
  if (!isOk(minted)) throw new Error('scope');
  return minted.value;
}

async function invoiceRow(w: World, id: string) {
  return (await w.db.select().from(schema.invoices).where(eq(schema.invoices.id, id)))[0];
}

async function refundRows(w: World, invoiceId?: string) {
  const rows = await w.db
    .select()
    .from(schema.invoicePayments)
    .where(eq(schema.invoicePayments.kind, 'REFUND'));
  return invoiceId ? rows.filter((r) => r.invoiceId === invoiceId) : rows;
}

async function requests(w: World) {
  return w.db.select().from(schema.refundRequests);
}

const entrySource = (id: string) => ({ kind: 'entry' as const, invoicePaymentId: id });
const heldSource = (id: string) => ({ kind: 'held' as const, paymentAttemptId: id });

describe('refund limits (pure)', () => {
  it('counts every request that is asked for, sent or confirmed, and nothing that ended', () => {
    const r = (
      status: 'REQUESTED' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'CANCELLED',
      amount: number,
    ) => ({
      status,
      amountMinorUnits: amount,
    });
    expect(entryRefundableMinorUnits(10_000, [])).toBe(10_000);
    expect(
      entryRefundableMinorUnits(10_000, [
        r('REQUESTED', 1000),
        r('SUBMITTED', 2000),
        r('CONFIRMED', 3000),
      ]),
    ).toBe(4000);
    expect(entryRefundableMinorUnits(10_000, [r('FAILED', 9000), r('CANCELLED', 9000)])).toBe(
      10_000,
    );
    expect(heldRemainingMinorUnits(10_000, 6000, [r('SUBMITTED', 1000)])).toBe(3000);
    expect(heldRemainingMinorUnits(10_000, 6000, [r('CONFIRMED', 9000)])).toBe(0);
  });
});

describe('refunds through the gateway (S18)', () => {
  let db: Db;
  let w: World;
  let port: FakePaymentPort;
  beforeEach(async () => {
    db = await freshDb();
    w = await world(db, 'refund');
    port = new FakePaymentPort();
  });

  it(
    'never refunds more than one payment took, counting refunds still on their way',
    async () => {
      const inv = await invoice(w, 'INV-LIMIT', 10_000);
      const { entry } = await paidOnline(w, inv, 10_000);
      const staff = await scopeOf(w);
      const ask = (amount: number) =>
        requestRefund(db, port, staff, {
          organizationId: w.organizationId,
          source: entrySource(entry.id),
          amountMinorUnits: amount,
          reason: 'Agency asked for part back',
          idempotencyKey: randomUUID(),
          stepUpSatisfied: true,
        });
      // The first one's sending cannot be confirmed: it stays asked for and still counts.
      port.refundBehaviour = 'throw';
      const first = await ask(6000);
      expect(isOk(first) && first.value.code).toBe('unconfirmed');
      port.refundBehaviour = 'accept';
      const second = await ask(4001);
      expect(isErr(second) && second.error.message).toContain('more than can still be refunded');
      const third = await ask(4000);
      expect(isOk(third) && third.value.code).toBe('sent');
      const fourth = await ask(1);
      expect(isErr(fourth) && fourth.error.message).toContain('already been refunded');
      // Cancelling the unconfirmed one gives its amount back to the limit.
      if (!isOk(first)) throw new Error('first');
      const cancelled = await cancelRefund(db, staff, {
        organizationId: w.organizationId,
        refundRequestId: first.value.request.id,
        reason: 'Not in the gateway panel',
        stepUpSatisfied: true,
      });
      expect(isOk(cancelled) && cancelled.value.status).toBe('CANCELLED');
      expect(isOk(await ask(6000))).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'lets only one of two refunds for the same money through when they arrive together',
    async () => {
      const inv = await invoice(w, 'INV-RACE', 10_000);
      const { entry } = await paidOnline(w, inv, 10_000);
      const staff = await scopeOf(w);
      const both = await Promise.all(
        [0, 1].map(() =>
          requestRefund(db, port, staff, {
            organizationId: w.organizationId,
            source: entrySource(entry.id),
            amountMinorUnits: 10_000,
            reason: 'Duplicate payment',
            idempotencyKey: randomUUID(),
            stepUpSatisfied: true,
          }),
        ),
      );
      expect(both.filter(isOk)).toHaveLength(1);
      expect(await requests(w)).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'writes no ledger row until the gateway confirms, then exactly one',
    async () => {
      const inv = await invoice(w, 'INV-CONFIRM', 10_000);
      const { entry } = await paidOnline(w, inv, 10_000);
      const staff = await scopeOf(w);
      const ask = (amount: number) =>
        requestRefund(db, port, staff, {
          organizationId: w.organizationId,
          source: entrySource(entry.id),
          amountMinorUnits: amount,
          reason: 'Refund',
          idempotencyKey: randomUUID(),
          stepUpSatisfied: true,
        });
      // Unknown outcome: REQUESTED. A refusal: FAILED. Sent: SUBMITTED. None writes the ledger.
      port.refundBehaviour = 'throw';
      const unknown = await ask(1000);
      port.refundBehaviour = 'refuse';
      const refused = await ask(1000);
      expect(isOk(refused) && refused.value.code).toBe('refused');
      port.refundBehaviour = 'accept';
      const sent = await ask(3000);
      if (!isOk(sent) || !isOk(unknown)) throw new Error('requests');
      expect(sent.value.request.status).toBe('SUBMITTED');
      // The gateway gets the request id as its refund id and a fixed remark, never the typed reason.
      expect(port.refundCalls.at(-1)).toMatchObject({
        refundId: sent.value.request.id,
        amountMinorUnits: 3000,
        remarks: 'Refund for invoice INV-CONFIRM',
      });
      expect((await requests(w)).map((r) => r.status).sort()).toEqual([
        'FAILED',
        'REQUESTED',
        'SUBMITTED',
      ]);
      expect(await refundRows(w)).toHaveLength(0);
      expect((await invoiceRow(w, inv))?.collectedAmountMinorUnits).toBe(10_000);

      // Still processing at the gateway: nothing.
      const scope = systemScopeForTest('process-payment-reconciliation');
      expect(await reconcileRefunds(db, scope, port)).toMatchObject({
        checked: 1,
        stillProcessing: 1,
        confirmed: 0,
        awaitingCheck: 1,
      });
      expect(await refundRows(w)).toHaveLength(0);

      // The gateway confirms: one negative row, the invoice drops to part paid.
      const ref = sent.value.request.reference ?? '';
      port.refundStatus.set(ref, 'REFUNDED');
      expect(await reconcileRefunds(db, scope, port)).toMatchObject({ confirmed: 1 });
      const rows = await refundRows(w);
      expect(
        rows.map((r) => [
          r.amountMinorUnits,
          r.provider,
          r.providerTransactionId,
          r.recordedByAccountId,
        ]),
      ).toEqual([[-3000, 'sslcommerz', ref, null]]);
      expect(await invoiceRow(w, inv)).toMatchObject({
        collectedAmountMinorUnits: 7000,
        status: 'PARTIALLY_PAID',
      });
      // Asked again (the daily job and Check Now): still exactly one.
      expect(await reconcileRefunds(db, scope, port)).toMatchObject({ checked: 0 });
      expect(
        isOk(await checkRefundsNow(db, port, staff, { organizationId: w.organizationId })),
      ).toBe(true);
      expect(await refundRows(w)).toHaveLength(1);

      // The one whose sending was never confirmed is sent again with the same refund id.
      const retried = await retryRefund(db, port, staff, {
        organizationId: w.organizationId,
        refundRequestId: unknown.value.request.id,
        stepUpSatisfied: true,
      });
      expect(isOk(retried) && retried.value.code).toBe('sent');
      expect(port.refundCalls.filter((c) => c.refundId === unknown.value.request.id)).toHaveLength(
        2,
      );
      expect(await refundRows(w)).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'turns a refund the gateway cancelled into Not Completed, with nothing in the ledger',
    async () => {
      const inv = await invoice(w, 'INV-CANCEL', 10_000);
      const { entry } = await paidOnline(w, inv, 10_000);
      const staff = await scopeOf(w);
      const sent = await requestRefund(db, port, staff, {
        organizationId: w.organizationId,
        source: entrySource(entry.id),
        amountMinorUnits: 10_000,
        reason: 'Refund',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
      if (!isOk(sent)) throw new Error('sent');
      port.refundStatus.set(sent.value.request.reference ?? '', 'CANCELLED');
      const checked = await checkRefundsNow(db, port, staff, { organizationId: w.organizationId });
      expect(isOk(checked) && checked.value.failed).toBe(1);
      expect((await requests(w))[0]).toMatchObject({
        status: 'FAILED',
        failureCode: 'provider_cancelled',
      });
      expect(await refundRows(w)).toHaveLength(0);
    },
    TIMEOUT,
  );

  it(
    'answers a repeated send from the first request and never sends it twice',
    async () => {
      const inv = await invoice(w, 'INV-TWICE', 10_000);
      const { entry } = await paidOnline(w, inv, 10_000);
      const staff = await scopeOf(w);
      const key = randomUUID();
      const send = () =>
        requestRefund(db, port, staff, {
          organizationId: w.organizationId,
          source: entrySource(entry.id),
          amountMinorUnits: 2000,
          reason: 'Refund',
          idempotencyKey: key,
          stepUpSatisfied: true,
        });
      expect(isOk(await send())).toBe(true);
      const again = await send();
      expect(isOk(again) && again.value.code).toBe('already_requested');
      expect(port.refundCalls).toHaveLength(1);
      expect(await requests(w)).toHaveLength(1);
    },
    TIMEOUT,
  );

  it("reads a typed refund amount in the payment's own stored currency, with a typed reason (S30)", async () => {
    const inv = await invoice(w, 'INV-TYPED-REFUND', 10_000);
    const entry = await paidByHand(w, inv, 10_000);
    const staff = await scopeOf(w);
    const record = (amountText: string) =>
      recordManualRefund(db, staff, {
        organizationId: w.organizationId,
        source: entrySource(entry.id),
        amountText,
        reference: `BANK-${amountText}`,
        refundedOn: new Date(),
        reason: 'Typed',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
    // More places than BDT has, nonsense, and more than was paid are refused with their reason.
    const bad = await record('1.005');
    expect(isErr(bad) && bad.error.reason).toBe('amount_invalid');
    const over = await record('100.01');
    expect(isErr(over) && over.error.reason).toBe('amount_over_balance');
    // "25.00" is 2500 minor units in BDT, whatever a form might have said the currency was.
    const done = await record('25.00');
    expect(isOk(done)).toBe(true);
    expect((await refundRows(w, inv)).map((r) => r.amountMinorUnits)).toEqual([-2500]);
  });

  it(
    'refunds a payment typed in by hand only outside VisaStack, then records it with its reference',
    async () => {
      const inv = await invoice(w, 'INV-HAND', 10_000);
      const entry = await paidByHand(w, inv, 10_000);
      const staff = await scopeOf(w);
      const viaGateway = await requestRefund(db, port, staff, {
        organizationId: w.organizationId,
        source: entrySource(entry.id),
        amountMinorUnits: 1000,
        reason: 'Refund',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
      expect(isErr(viaGateway) && viaGateway.error.message).toContain(
        'cannot be refunded through the payment gateway',
      );
      expect(port.refundCalls).toHaveLength(0);
      expect(await requests(w)).toHaveLength(0);

      const key = randomUUID();
      const record = () =>
        recordManualRefund(db, staff, {
          organizationId: w.organizationId,
          source: entrySource(entry.id),
          amountMinorUnits: 10_000,
          reference: 'BANK-OUT-77',
          refundedOn: new Date(),
          reason: 'Agency closed',
          idempotencyKey: key,
          stepUpSatisfied: true,
        });
      const recorded = await record();
      expect(isOk(recorded) && recorded.value.code).toBe('recorded');
      expect(isOk(await record())).toBe(true);
      const rows = await refundRows(w, inv);
      expect(
        rows.map((r) => [r.amountMinorUnits, r.reference, r.recordedByAccountId, r.provider]),
      ).toEqual([[-10_000, 'BANK-OUT-77', w.owner.accountId, null]]);
      // Paid becomes Open with nothing collected, and is never chased again.
      expect(await invoiceRow(w, inv)).toMatchObject({
        collectedAmountMinorUnits: 0,
        status: 'OPEN',
      });
      const later = await recordManualRefund(db, staff, {
        organizationId: w.organizationId,
        source: entrySource(entry.id),
        amountMinorUnits: 1,
        reference: 'BANK-OUT-78',
        refundedOn: new Date(),
        reason: 'Again',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
      expect(isErr(later)).toBe(true);
      const future = await recordManualRefund(db, staff, {
        organizationId: w.organizationId,
        source: entrySource(entry.id),
        amountMinorUnits: 1,
        reference: 'X',
        refundedOn: new Date(Date.now() + 3 * DAY),
        reason: 'Future',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
      expect(isErr(future) && future.error.message).toContain('future');
    },
    TIMEOUT,
  );

  it(
    'keeps a refunded invoice out of overdue, reminders and payment, and shows it as refunded',
    async () => {
      const overdueDue = new Date(Date.now() - 20 * DAY);
      const partly = await invoice(w, 'INV-PARTLY', 10_000, overdueDue);
      const fully = await invoice(w, 'INV-FULLY', 10_000, overdueDue);
      const untouched = await invoice(w, 'INV-UNTOUCHED', 10_000, overdueDue);
      const partlyEntry = await paidByHand(w, partly, 10_000);
      const fullyEntry = await paidByHand(w, fully, 4000);
      const staff = await scopeOf(w);
      for (const [entry, amount] of [
        [partlyEntry, 3000],
        [fullyEntry, 4000],
      ] as const) {
        const done = await recordManualRefund(db, staff, {
          organizationId: w.organizationId,
          source: entrySource(entry.id),
          amountMinorUnits: amount,
          reference: `BANK-OUT-${amount}`,
          refundedOn: new Date(),
          reason: 'Discount agreed',
          idempotencyKey: randomUUID(),
          stepUpSatisfied: true,
        });
        if (!isOk(done)) throw new Error(done.error.message);
      }
      const overdue = await overdueInvoices(db, [w.organizationId], new Date());
      expect(overdue.map((o) => o.invoiceRef)).toEqual(['INV-UNTOUCHED']);

      const listed = await listAgencyInvoices(db, {
        actorAccountId: w.orgOwnerId,
        organizationId: w.organizationId,
      });
      if (!isOk(listed)) throw new Error('list');
      const byRef = new Map(listed.value.map((v) => [v.invoiceRef, v]));
      expect(byRef.get('INV-PARTLY')).toMatchObject({
        state: 'PARTLY_REFUNDED',
        outstandingMinorUnits: 0,
        refundedMinorUnits: 3000,
      });
      expect(byRef.get('INV-FULLY')).toMatchObject({ state: 'REFUNDED', outstandingMinorUnits: 0 });
      expect(byRef.get('INV-UNTOUCHED')).toMatchObject({ state: 'OPEN', refundedMinorUnits: 0 });

      // Neither paying online nor reporting a payment is possible on a refunded invoice.
      const started = await startOnlinePayment(db, port, {
        actorAccountId: w.orgOwnerId,
        invoiceId: partly,
        urlFor: (kind, tran) => `https://app.example.test/${kind}?t=${tran}`,
      });
      expect(isErr(started) && started.error.message).toBe(REFUNDED_INVOICE_MESSAGE);
      const claimed = await submitManualPaymentClaim(db, null, {
        actorAccountId: w.orgOwnerId,
        invoiceId: fully,
        method: 'BANK_TRANSFER',
        reference: 'TRF-1',
        amountMinorUnits: 1000,
        currency: 'BDT',
        paidOn: new Date(),
      });
      expect(isErr(claimed) && claimed.error.message).toBe(REFUNDED_INVOICE_MESSAGE);
      void untouched;
    },
    TIMEOUT,
  );

  it(
    'tells the agency owners and admins, naming the invoice and never an amount',
    async () => {
      const inv = await invoice(w, 'INV-NOTICE', 10_000);
      const entry = await paidByHand(w, inv, 10_000);
      const staff = await scopeOf(w);
      const done = await recordManualRefund(db, staff, {
        organizationId: w.organizationId,
        source: entrySource(entry.id),
        amountMinorUnits: 2500,
        reference: 'BANK-OUT',
        refundedOn: new Date(),
        reason: 'Discount',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
      if (!isOk(done)) throw new Error('done');
      const notes = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.eventType, 'INVOICE_REFUNDED'));
      expect(new Set(notes.map((n) => n.recipientAccountId))).toEqual(new Set([w.orgOwnerId]));
      expect(notes.map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
      for (const note of notes) {
        const text = JSON.stringify(note.payload);
        expect(text).toContain('INV-NOTICE');
        expect(text).not.toMatch(/25\.00|2500|BDT/);
      }
    },
    TIMEOUT,
  );
});

describe('held payments: refund and Apply to Next Invoice (S18)', () => {
  let db: Db;
  let w: World;
  let port: FakePaymentPort;
  beforeEach(async () => {
    db = await freshDb();
    w = await world(db, 'held');
    port = new FakePaymentPort();
  });

  it(
    'applies held money once, to the open invoice due first, and refunds only the rest',
    async () => {
      const paidInv = await invoice(w, 'INV-PAID', 10_000);
      await paidByHand(w, paidInv, 10_000);
      const held = await heldPayment(w, paidInv, 10_000);
      const later = await invoice(w, 'INV-LATER', 8000, new Date(Date.now() + 30 * DAY));
      const sooner = await invoice(w, 'INV-SOONER', 6000, new Date(Date.now() + 10 * DAY));
      const staff = await scopeOf(w);
      const apply = () =>
        applyHeldPaymentCredit(db, staff, {
          organizationId: w.organizationId,
          paymentAttemptId: held.id,
          stepUpSatisfied: true,
        });
      // Two at once: one credit.
      const [a, b] = await Promise.all([apply(), apply()]);
      expect(isOk(a) && isOk(b)).toBe(true);
      if (!isOk(a) || !isOk(b)) throw new Error('apply');
      expect([a.value.alreadyApplied, b.value.alreadyApplied].sort()).toEqual([false, true]);
      const credits = await db
        .select()
        .from(schema.invoicePayments)
        .where(eq(schema.invoicePayments.kind, 'CREDIT'));
      expect(credits.map((c) => [c.invoiceId, c.amountMinorUnits, c.recordedByAccountId])).toEqual([
        [sooner, 6000, w.owner.accountId],
      ]);
      expect(a.value.remainingMinorUnits).toBe(4000);
      // Again later: still one.
      const again = await apply();
      expect(isOk(again) && again.value.alreadyApplied).toBe(true);
      void later;

      // The same gateway money can never also be counted as an online payment.
      const online = await db.transaction((tx) =>
        applyInvoiceCollection(tx, {
          invoiceId: later,
          amountMinorUnits: 6000,
          currency: 'BDT',
          kind: 'ONLINE',
          sourceId: randomUUID(),
          provider: 'sslcommerz',
          providerTransactionId: held.providerValId,
          reference: 'replay',
          collectedDate: new Date(),
          recordedByAccountId: null,
        }),
      );
      expect(isErr(online) && online.error.code).toBe('key_conflict');

      // What is left can only be refunded, up to what is left.
      const tooMuch = await requestRefund(db, port, staff, {
        organizationId: w.organizationId,
        source: heldSource(held.id),
        amountMinorUnits: 4001,
        reason: 'Overpaid',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
      expect(isErr(tooMuch)).toBe(true);
      const rest = await requestRefund(db, port, staff, {
        organizationId: w.organizationId,
        source: heldSource(held.id),
        amountMinorUnits: 4000,
        reason: 'Overpaid',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
      if (!isOk(rest)) throw new Error(rest.error.message);
      port.refundStatus.set(rest.value.request.reference ?? '', 'REFUNDED');
      await reconcileRefunds(db, systemScopeForTest('process-payment-reconciliation'), port);
      // Held money never was in the ledger, so its refund writes no ledger row; the held payment is closed.
      expect(await refundRows(w)).toHaveLength(0);
      const closed = (
        await db.select().from(schema.paymentAttempts).where(eq(schema.paymentAttempts.id, held.id))
      )[0];
      expect(closed?.status).toBe('RECORDED');
      expect(closed?.recordedAt).not.toBeNull();
    },
    TIMEOUT,
  );

  it(
    'closes held money refunded in full as Refunded, and says so when there is no open invoice',
    async () => {
      const paidInv = await invoice(w, 'INV-ONLY', 10_000);
      await paidByHand(w, paidInv, 10_000);
      const held = await heldPayment(w, paidInv, 10_000);
      const staff = await scopeOf(w);
      const noTarget = await applyHeldPaymentCredit(db, staff, {
        organizationId: w.organizationId,
        paymentAttemptId: held.id,
        stepUpSatisfied: true,
      });
      expect(isErr(noTarget) && noTarget.error.message).toContain('no open invoice yet');
      const recorded = await recordManualRefund(db, staff, {
        organizationId: w.organizationId,
        source: heldSource(held.id),
        amountMinorUnits: 10_000,
        reference: 'PANEL-REFUND-1',
        refundedOn: new Date(),
        reason: 'Refunded in the gateway panel',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
      expect(isOk(recorded)).toBe(true);
      const closed = (
        await db.select().from(schema.paymentAttempts).where(eq(schema.paymentAttempts.id, held.id))
      )[0];
      expect(closed?.status).toBe('REFUNDED');
      expect(await refundRows(w)).toHaveLength(0);
    },
    TIMEOUT,
  );

  it(
    'never applies held money that did not match the gateway, and lets it be recorded as refunded only',
    async () => {
      const paidInv = await invoice(w, 'INV-MISMATCH', 10_000);
      const open = await invoice(w, 'INV-OPEN', 10_000);
      const held = await heldPayment(w, paidInv, 10_000, 'mismatch');
      const staff = await scopeOf(w);
      const credit = await applyHeldPaymentCredit(db, staff, {
        organizationId: w.organizationId,
        paymentAttemptId: held.id,
        targetInvoiceId: open,
        stepUpSatisfied: true,
      });
      expect(isErr(credit)).toBe(true);
      const viaGateway = await requestRefund(db, port, staff, {
        organizationId: w.organizationId,
        source: heldSource(held.id),
        amountMinorUnits: 10_000,
        reason: 'Refund',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
      expect(isErr(viaGateway)).toBe(true);
      expect(port.refundCalls).toHaveLength(0);
    },
    TIMEOUT,
  );

  it(
    'ends a suspension VisaStack set when a credit pays everything off, and never one a person set',
    async () => {
      for (const [tag, bySystem] of [
        ['sys', true],
        ['hand', false],
      ] as const) {
        const v = await world(db, `react-${tag}`, w);
        const overdue = await invoice(
          v,
          `INV-OVERDUE-${tag}`,
          5000,
          new Date(Date.now() - 40 * DAY),
        );
        const paidInv = await invoice(
          v,
          `INV-PAIDOFF-${tag}`,
          5000,
          new Date(Date.now() - 50 * DAY),
        );
        await paidByHand(v, paidInv, 5000);
        const held = await heldPayment(v, paidInv, 5000);
        if (bySystem) {
          const account = (
            await db
              .select()
              .from(schema.billingAccounts)
              .where(eq(schema.billingAccounts.organizationId, v.organizationId))
          )[0];
          if (!account) throw new Error('account');
          await db
            .update(schema.billingAccounts)
            .set({ status: 'SUSPENDED' })
            .where(eq(schema.billingAccounts.id, account.id));
          await db.insert(schema.billingStatusHistory).values({
            billingAccountId: account.id,
            fromStatus: 'ACTIVE',
            toStatus: 'SUSPENDED',
            actorAccountId: null,
            reason: 'system: overdue 40 days (test)',
            cause: 'NONPAYMENT',
          });
        } else {
          const moved = await transitionBillingStatus(db, {
            actor: v.actor,
            stepUpSatisfied: true,
            organizationId: v.organizationId,
            toStatus: 'SUSPENDED',
            reason: 'agreed by phone',
          });
          if (!isOk(moved)) throw new Error('suspend');
        }
        const applied = await applyHeldPaymentCredit(db, await scopeOf(v), {
          organizationId: v.organizationId,
          paymentAttemptId: held.id,
          targetInvoiceId: overdue,
          stepUpSatisfied: true,
        });
        if (!isOk(applied)) throw new Error(applied.error.message);
        expect((await invoiceRow(v, overdue))?.status).toBe('PAID');
        const status = await getBillingAccountForOrganization(db, {
          actorAccountId: v.orgOwnerId,
          organizationId: v.organizationId,
        });
        expect(isOk(status) && status.value?.status).toBe(bySystem ? 'ACTIVE' : 'SUSPENDED');
      }
    },
    TIMEOUT * 2,
  );
});

describe('who may refund (S18)', () => {
  it(
    'is the platform owner only, with a fresh sign-in check, and a forged scope gets nothing',
    async () => {
      const db = await freshDb();
      const w = await world(db, 'access');
      const port = new FakePaymentPort();
      const inv = await invoice(w, 'INV-ACCESS', 10_000);
      const entry = await paidByHand(w, inv, 10_000);
      const support = await account(db, 'support@platform.example.com');
      const granted = await grantPlatformRole(db, {
        actor: { accountId: w.owner.accountId, email: w.owner.email, bootstrapEmails: [] },
        targetAccountId: support,
        role: 'SUPPORT_ADMIN',
        reason: 'seed',
        stepUpSatisfied: true,
      });
      expect(isOk(granted)).toBe(true);
      for (const [accountId, email] of [
        [support, 'support@platform.example.com'],
        [w.orgOwnerId, 'agency-owner-access@acme.example.com'],
      ] as const) {
        for (const action of ['BILLING_REFUND_MANAGE', 'BILLING_LEDGER_EXPORT'] as const) {
          expect(
            isErr(await staffPrincipal(db, { accountId, email, bootstrapEmails: [] }, action)),
          ).toBe(true);
        }
      }
      const real = await scopeOf(w);
      const forged = { ...real } as typeof real;
      const manual = (staff: typeof real, stepUpSatisfied: boolean) =>
        recordManualRefund(db, staff, {
          organizationId: w.organizationId,
          source: entrySource(entry.id),
          amountMinorUnits: 100,
          reference: 'X',
          refundedOn: new Date(),
          reason: 'Test',
          idempotencyKey: randomUUID(),
          stepUpSatisfied,
        });
      const forgedResult = await manual(forged, true);
      expect(isErr(forgedResult) && forgedResult.error.code).toBe('forbidden');
      const stale = await manual(real, false);
      expect(isErr(stale) && stale.error.code).toBe('step_up_required');
      const noStepUpCredit = await applyHeldPaymentCredit(db, real, {
        organizationId: w.organizationId,
        paymentAttemptId: randomUUID(),
        stepUpSatisfied: false,
      });
      expect(isErr(noStepUpCredit) && noStepUpCredit.error.code).toBe('step_up_required');
      const noStepUpGateway = await requestRefund(db, port, real, {
        organizationId: w.organizationId,
        source: entrySource(entry.id),
        amountMinorUnits: 100,
        reason: 'x',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: false,
      });
      expect(isErr(noStepUpGateway) && noStepUpGateway.error.code).toBe('step_up_required');
      expect(
        isErr(
          await getOrganizationRefundWork(db, forged, {
            organizationId: w.organizationId,
            gatewayProvider: null,
          }),
        ),
      ).toBe(true);
      const exportScope = await exportScopeOf(w);
      const noStepUpExport = await exportLedgerMonth(db, exportScope, {
        month: '2026-10',
        stepUpSatisfied: false,
      });
      expect(isErr(noStepUpExport) && noStepUpExport.error.code).toBe('step_up_required');
      // Another agency's money looks like missing money.
      const other = await world(db, 'access-other', w);
      const crossed = await recordManualRefund(db, real, {
        organizationId: other.organizationId,
        source: entrySource(entry.id),
        amountMinorUnits: 100,
        reference: 'X',
        refundedOn: new Date(),
        reason: 'Test',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
      expect(isErr(crossed) && crossed.error.code).toBe('not_found');
      expect(await db.select().from(schema.refundRequests)).toHaveLength(0);
    },
    TIMEOUT,
  );
});

describe('the monthly accounting export (S18)', () => {
  it('quotes every cell and defuses anything a spreadsheet would read as a formula', () => {
    expect(ledgerCsvCell('plain')).toBe('"plain"');
    expect(ledgerCsvCell(null)).toBe('""');
    expect(ledgerCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(ledgerCsvCell('line one\nline two')).toBe('"line one\nline two"');
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      expect(ledgerCsvCell(`${lead}SUM(A1)`)).toBe(`"'${lead}SUM(A1)"`);
      expect(ledgerCsvCell(`   ${lead}SUM(A1)`)).toBe(`"'   ${lead}SUM(A1)"`);
    }
    expect(ledgerCsvCell('a=b')).toBe('"a=b"');
  });

  it('keys a month on Bangladesh time: 31 October 18:00 UTC is already November', () => {
    const october = ledgerMonthBounds('2026-10');
    const november = ledgerMonthBounds('2026-11');
    expect(october?.start.toISOString()).toBe('2026-09-30T18:00:00.000Z');
    expect(october?.end.toISOString()).toBe('2026-10-31T18:00:00.000Z');
    const at = new Date('2026-10-31T18:00:00Z');
    expect(at >= (november?.start ?? at) && at < (november?.end ?? at)).toBe(true);
    expect(at < (october?.end ?? at)).toBe(false);
    expect(ledgerMonthBounds('2026-13')).toBeNull();
    expect(ledgerMonthBounds('2026-1')).toBeNull();
    expect(ledgerMonthBounds('2026-12')?.end.toISOString()).toBe('2026-12-31T18:00:00.000Z');
  });

  it(
    'holds only ledger rows of the month, the allowed columns, and no traveller data',
    async () => {
      const db = await freshDb();
      const w = await world(db, 'csv');
      await db
        .update(schema.organizations)
        .set({ name: '=HYPERLINK("http://bad.example")' })
        .where(eq(schema.organizations.id, w.organizationId));
      // A traveller with a name and a passport number exists; nothing of them may appear.
      const traveller = await account(db, 'rahim.uddin@traveller.example.com');
      await db
        .insert(schema.applicants)
        .values({ ownerAccountId: traveller, displayName: 'Rahim Uddin P0X1234567' });
      const inv = await invoice(w, 'INV-CSV', 10_000);
      const entry = await paidByHand(w, inv, 10_000);
      const staff = await scopeOf(w);
      const refund = await recordManualRefund(db, staff, {
        organizationId: w.organizationId,
        source: entrySource(entry.id),
        amountMinorUnits: 2550,
        reference: '-5 refund',
        refundedOn: new Date(),
        reason: 'Discount',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
      if (!isOk(refund)) throw new Error('refund');
      const month = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: '2-digit',
      })
        .format(new Date())
        .slice(0, 7);
      const exported = await exportLedgerMonth(db, await exportScopeOf(w), {
        month,
        stepUpSatisfied: true,
      });
      if (!isOk(exported)) throw new Error(exported.error.message);
      const text = exported.value.csv;
      expect(exported.value.filename).toBe(`visastack-ledger-${month}.csv`);
      // A UTF-8 byte-order mark first, so Excel reads non-ASCII names right.
      expect([...Buffer.from(text, 'utf8').subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const header = text.slice(1).split('\r\n')[0];
      expect(header).toBe(LEDGER_CSV_COLUMNS.map((c) => `"${c}"`).join(','));
      expect(text).not.toContain('Rahim');
      expect(text).not.toContain('P0X1234567');
      expect(text).not.toContain('traveller.example.com');
      expect(text).toContain(`"'=HYPERLINK(""http://bad.example"")"`);
      expect(text).toContain(`"'-5 refund"`);
      // The refund row: OUT, an exact unsigned amount, and its refund request id.
      const refundLine = text.split('\r\n').find((line) => line.includes('"REFUND"'));
      expect(refundLine).toContain('"OUT","25.50","BDT"');
      expect(refundLine).toContain(`"${refund.value.request.id}"`);
      expect(refundLine).toContain('"staff"');
      const audits = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'BILLING_LEDGER_EXPORTED'));
      expect(audits).toHaveLength(1);
    },
    TIMEOUT,
  );
});

describe('before migration 0104', () => {
  it(
    'says refunds are not available yet, crashes nothing, and still exports the ledger',
    async () => {
      const journal = JSON.parse(
        readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
      ) as {
        entries: { tag: string }[];
      };
      const at = journal.entries.findIndex((e) => e.tag === '0104_refunds_credits');
      const prior = journal.entries.slice(0, at);
      const folder = mkdtempSync(join(tmpdir(), 'visastack-before-0104-'));
      mkdirSync(join(folder, 'meta'), { recursive: true });
      writeFileSync(
        join(folder, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: prior }),
      );
      for (const entry of prior) {
        copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
      }
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder: folder });
      const db = drizzle(client, { schema }) as unknown as Db;
      const w = await world(db, 'before');
      const port = new FakePaymentPort();
      const inv = await invoice(w, 'INV-BEFORE', 10_000);
      const entry = await paidByHand(w, inv, 10_000);
      const staff = await scopeOf(w);
      const work = await getOrganizationRefundWork(db, staff, {
        organizationId: w.organizationId,
        gatewayProvider: 'sslcommerz',
      });
      expect(isOk(work) && work.value.available).toBe(false);
      const manual = await recordManualRefund(db, staff, {
        organizationId: w.organizationId,
        source: entrySource(entry.id),
        amountMinorUnits: 100,
        reference: 'X',
        refundedOn: new Date(),
        reason: 'Test',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
      expect(isErr(manual) && manual.error.message).toBe(REFUNDS_UNAVAILABLE);
      const viaGateway = await requestRefund(db, port, staff, {
        organizationId: w.organizationId,
        source: entrySource(entry.id),
        amountMinorUnits: 100,
        reason: 'Test',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
      expect(isErr(viaGateway) && viaGateway.error.message).toBe(REFUNDS_UNAVAILABLE);
      expect(
        await reconcileRefunds(db, systemScopeForTest('process-payment-reconciliation'), port),
      ).toMatchObject({
        available: false,
      });
      // The agency's invoices and the overdue rules still read as before.
      const listed = await listAgencyInvoices(db, {
        actorAccountId: w.orgOwnerId,
        organizationId: w.organizationId,
      });
      expect(isOk(listed) && listed.value[0]?.state).toBe('PAID');
      const month = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: '2-digit',
      })
        .format(new Date())
        .slice(0, 7);
      const exported = await exportLedgerMonth(db, await exportScopeOf(w), {
        month,
        stepUpSatisfied: true,
      });
      expect(isOk(exported) && exported.value.rowCount).toBe(1);
    },
    TIMEOUT * 2,
  );
});

describe('lock order (S18)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, 'refunds.ts'), 'utf8');
  const body = (start: string, end: string) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    expect(from, start).toBeGreaterThan(-1);
    return source.slice(from, to === -1 ? undefined : to);
  };

  it('takes the held payment, then the request, then the invoice, then the audit chain', () => {
    // Confirming: held payment, request, ledger write (invoice), then audit.
    const confirm = body('async function confirmOne', 'const MAX_CONSECUTIVE_OUTAGES');
    const attemptLock = confirm.indexOf('lockAttempt(tx');
    const requestLock = confirm.indexOf(".for('update')");
    const ledgerWrite = confirm.indexOf('applyInvoiceRefund(tx');
    expect(attemptLock).toBeGreaterThan(-1);
    expect(attemptLock).toBeLessThan(requestLock);
    expect(requestLock).toBeLessThan(ledgerWrite);
    expect(ledgerWrite).toBeLessThan(confirm.indexOf("auditRefund(tx, 'INVOICE_REFUND_CONFIRMED'"));
    // Cancelling: held payment before the request.
    const cancel = body('export async function cancelRefund', '// --- Confirming');
    expect(cancel.indexOf('lockAttempt(tx')).toBeGreaterThan(-1);
    expect(cancel.indexOf('lockAttempt(tx')).toBeLessThan(cancel.indexOf(".for('update')"));
    // A credit: the held payment, then the invoice, then the recording function (billing account
    // and audit inside), then its own audit record.
    const credit = body('export async function applyHeldPaymentCredit', '// --- What the admin');
    const held = credit.indexOf('lockAttempt(tx');
    const invoiceLock = credit.indexOf(".for('update')");
    expect(held).toBeGreaterThan(-1);
    expect(held).toBeLessThan(invoiceLock);
    expect(invoiceLock).toBeLessThan(credit.indexOf('applyInvoiceCollection(tx'));
    expect(credit.indexOf('applyInvoiceCollection(tx')).toBeLessThan(
      credit.indexOf('appendAuditEvent(tx'),
    );
    // A new request (by the gateway or recorded by hand): its source is locked before it is written.
    for (const name of [
      'export async function requestRefund',
      'export async function recordManualRefund',
    ]) {
      const fn = body(name, 'export ');
      expect(fn.indexOf('lockSource(tx'), name).toBeGreaterThan(-1);
      expect(fn.indexOf('lockSource(tx'), name).toBeLessThan(
        fn.indexOf('.insert(schema.refundRequests)'),
      );
      expect(fn.indexOf('.insert(schema.refundRequests)'), name).toBeLessThan(
        fn.indexOf('auditRefund(tx'),
      );
    }
    // The source lock itself: a held payment, or the invoice of a ledger entry.
    const lock = body('async function lockSource', '/** Why this source');
    expect(lock.indexOf('lockAttempt(tx')).toBeGreaterThan(-1);
    expect(lock.indexOf(".for('update')")).toBeGreaterThan(-1);
    // The gateway is never called inside a transaction.
    const send = body('async function sendToGateway', 'export interface RefundRequestActionInput');
    expect(send.indexOf('gateway.refund(')).toBeLessThan(send.indexOf('db.transaction('));
    // Nothing here locks a billing account directly (only the recording function does).
    expect(source).not.toContain('lockBillingAccount(');
  });
});

describe('S18 round 2: resends, It Went Through, refunded invoices, durable checks', () => {
  let db: Db;
  let w: World;
  let port: FakePaymentPort;
  beforeEach(async () => {
    db = await freshDb();
    w = await world(db, 'round2');
    port = new FakePaymentPort();
  });

  const ask = async (entryId: string, amount: number) =>
    requestRefund(db, port, await scopeOf(w), {
      organizationId: w.organizationId,
      source: entrySource(entryId),
      amountMinorUnits: amount,
      reason: 'Refund',
      idempotencyKey: randomUUID(),
      stepUpSatisfied: true,
    });

  it(
    'keeps the amount blocked when Send Again is answered "failed" after an unclear first send',
    async () => {
      const inv = await invoice(w, 'INV-RESEND', 10_000);
      const { entry } = await paidOnline(w, inv, 10_000);
      port.refundBehaviour = 'throw';
      const first = await ask(entry.id, 10_000);
      if (!isOk(first)) throw new Error('first');
      expect(first.value.code).toBe('unconfirmed');
      port.refundBehaviour = 'refuse';
      const again = await retryRefund(db, port, await scopeOf(w), {
        organizationId: w.organizationId,
        refundRequestId: first.value.request.id,
        stepUpSatisfied: true,
      });
      expect(isOk(again) && again.value.code).toBe('unconfirmed');
      const row = (await requests(w))[0];
      expect(row).toMatchObject({ status: 'REQUESTED', failureCode: RETRY_REFUSED_CODE });
      // Still counted: nothing more can be asked for until staff decide from the panel.
      port.refundBehaviour = 'accept';
      const more = await ask(entry.id, 1);
      expect(isErr(more) && more.error.message).toContain('already been refunded');
      expect(await refundRows(w)).toHaveLength(0);
    },
    TIMEOUT,
  );

  it(
    'confirms a refund found in the panel (It Went Through) once, with its reference and day, never before the request day',
    async () => {
      const inv = await invoice(w, 'INV-WENT', 10_000);
      const { entry } = await paidOnline(w, inv, 10_000);
      port.refundBehaviour = 'throw';
      const first = await ask(entry.id, 4000);
      if (!isOk(first)) throw new Error('first');
      const staff = await scopeOf(w);
      const confirm = (refundedOn: Date) =>
        confirmUnsentRefund(db, staff, {
          organizationId: w.organizationId,
          refundRequestId: first.value.request.id,
          reference: 'PANEL-RR-1',
          amountMinorUnits: 4000,
          refundedOn,
          stepUpSatisfied: true,
        });
      const early = await confirm(new Date(Date.now() - 3 * DAY));
      expect(isErr(early) && early.error.message).toContain('cannot be before');
      const future = await confirm(new Date(Date.now() + 3 * DAY));
      expect(isErr(future) && future.error.message).toContain('future');
      const noStepUp = await confirmUnsentRefund(db, staff, {
        organizationId: w.organizationId,
        refundRequestId: first.value.request.id,
        reference: 'PANEL-RR-1',
        amountMinorUnits: 4000,
        refundedOn: new Date(),
        stepUpSatisfied: false,
      });
      expect(isErr(noStepUp) && noStepUp.error.code).toBe('step_up_required');
      expect(await refundRows(w)).toHaveLength(0);
      const done = await confirm(new Date());
      expect(isOk(done) && done.value.status).toBe('CONFIRMED');
      expect(
        (await refundRows(w)).map((r) => [
          r.amountMinorUnits,
          r.providerTransactionId,
          r.recordedByAccountId,
        ]),
      ).toEqual([[-4000, 'PANEL-RR-1', w.owner.accountId]]);
      expect(isErr(await confirm(new Date()))).toBe(true);
      expect(await refundRows(w)).toHaveLength(1);
      expect((await invoiceRow(w, inv))?.collectedAmountMinorUnits).toBe(6000);
    },
    TIMEOUT,
  );

  it(
    'holds an online payment that arrives on an invoice refunded meanwhile, and refuses recording one by hand',
    async () => {
      const inv = await invoice(w, 'INV-LATE-PAY', 10_000);
      const handEntry = await paidByHand(w, inv, 4000);
      const started = await startOnlinePayment(db, port, {
        actorAccountId: w.orgOwnerId,
        invoiceId: inv,
        urlFor: (kind, tran) => `https://app.example.test/${kind}?t=${tran}`,
      });
      if (!isOk(started) || started.value.kind !== 'redirect') throw new Error('start');
      const attempt = (
        await db
          .select()
          .from(schema.paymentAttempts)
          .where(eq(schema.paymentAttempts.invoiceId, inv))
      )[0];
      if (!attempt) throw new Error('attempt');
      const refunded = await recordManualRefund(db, await scopeOf(w), {
        organizationId: w.organizationId,
        source: entrySource(handEntry.id),
        amountMinorUnits: 1000,
        reference: 'BANK-OUT',
        refundedOn: new Date(),
        reason: 'Discount',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
      if (!isOk(refunded)) throw new Error('refund');
      const paid = port.succeed(attempt.merchantTranId, attempt.amountMinorUnits);
      const settled = await settlePaymentAttempt(db, port, {
        merchantTranId: attempt.merchantTranId,
        valId: paid.valId,
        source: 'ipn',
      });
      expect(settled.code).toBe('held');
      const after = (
        await db
          .select()
          .from(schema.paymentAttempts)
          .where(eq(schema.paymentAttempts.id, attempt.id))
      )[0];
      expect(after).toMatchObject({ status: 'HELD_FOR_REVIEW', reasonCode: 'invoice_refunded' });
      const online = await db
        .select()
        .from(schema.invoicePayments)
        .where(
          and(eq(schema.invoicePayments.invoiceId, inv), eq(schema.invoicePayments.kind, 'ONLINE')),
        );
      expect(online).toHaveLength(0);
      const byHand = await recordInvoicePayment(db, {
        actor: w.actor,
        stepUpSatisfied: true,
        invoiceId: inv,
        amountMinorUnits: 100,
        collectedDate: new Date(),
        paymentReference: 'BANK-IN-2',
        reason: 'late transfer',
        idempotencyKey: randomUUID(),
      });
      // Staff get their own words, not the agency's.
      expect(isErr(byHand) && byHand.error.message).toBe(REFUNDED_INVOICE_STAFF_MESSAGE);
      // The held money is verified, so it can go to another invoice or back to the agency.
      const work = await getOrganizationRefundWork(db, await scopeOf(w), {
        organizationId: w.organizationId,
        gatewayProvider: 'sslcommerz',
      });
      expect(isOk(work) && work.value.held.map((h) => [h.id, h.verified])).toEqual([
        [attempt.id, true],
      ]);
    },
    TIMEOUT,
  );

  it(
    'marks a confirmed refund the ledger refused as needing a check, once, and never lets it starve the others',
    async () => {
      const stuckInv = await invoice(w, 'INV-STUCK', 10_000);
      const { entry: stuckEntry } = await paidOnline(w, stuckInv, 10_000);
      const okInv = await invoice(w, 'INV-OK', 10_000);
      const { entry: okEntry } = await paidOnline(w, okInv, 10_000);
      const stuck = await ask(stuckEntry.id, 5000);
      if (!isOk(stuck)) throw new Error('stuck');
      // The invoice no longer holds the money (an inconsistency only a person can sort out).
      await db
        .update(schema.invoices)
        .set({ collectedAmountMinorUnits: 0, status: 'OPEN' })
        .where(eq(schema.invoices.id, stuckInv));
      port.refundStatus.set(stuck.value.request.reference ?? '', 'REFUNDED');
      const scope = systemScopeForTest('process-payment-reconciliation');
      expect(await reconcileRefunds(db, scope, port)).toMatchObject({ needsCheck: 1 });
      expect(await reconcileRefunds(db, scope, port)).toMatchObject({ needsCheck: 1 });
      const row = (await requests(w)).find((r) => r.id === stuck.value.request.id);
      expect(row).toMatchObject({ status: 'SUBMITTED', failureCode: NEEDS_CHECK_CODE });
      expect(row?.lastCheckedAt).not.toBeNull();
      const audits = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'INVOICE_REFUND_NEEDS_CHECK'));
      expect(audits).toHaveLength(1);
      // A healthy refund sent later is still asked about first, with room for only one.
      const healthy = await ask(okEntry.id, 1000);
      if (!isOk(healthy)) throw new Error('healthy');
      port.refundStatus.set(healthy.value.request.reference ?? '', 'REFUNDED');
      expect(await reconcileRefunds(db, scope, port, { limit: 1 })).toMatchObject({ confirmed: 1 });
      const view = await getOrganizationRefundWork(db, await scopeOf(w), {
        organizationId: w.organizationId,
        gatewayProvider: 'sslcommerz',
      });
      expect(
        isOk(view) && view.value.requests.find((r) => r.id === stuck.value.request.id)?.failureCode,
      ).toBe(NEEDS_CHECK_CODE);
    },
    TIMEOUT,
  );

  it(
    'never records a refund made outside VisaStack before the money came in',
    async () => {
      const inv = await invoice(w, 'INV-DAY', 10_000);
      const entry = await paidByHand(w, inv, 10_000);
      const record = async (refundedOn: Date) =>
        recordManualRefund(db, await scopeOf(w), {
          organizationId: w.organizationId,
          source: entrySource(entry.id),
          amountMinorUnits: 100,
          reference: 'BANK-OUT',
          refundedOn,
          reason: 'Discount',
          idempotencyKey: randomUUID(),
          stepUpSatisfied: true,
        });
      const early = await record(new Date(Date.now() - 2 * DAY));
      expect(isErr(early) && early.error.message).toContain('cannot be before');
      expect(isOk(await record(new Date()))).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'lists at most 25 payments that can still be refunded, newest first, and says when there are more',
    async () => {
      const inv = await invoice(w, 'INV-MANY', 1_000_000);
      const base = Date.now() - 60 * DAY;
      for (let i = 0; i < REFUND_WORK_LIMIT + 2; i++) {
        await db.insert(schema.invoicePayments).values({
          invoiceId: inv,
          amountMinorUnits: 100,
          currency: 'BDT',
          kind: 'ADMIN_RECORDED',
          mode: 'LIVE',
          sourceId: randomUUID(),
          reference: `BANK-${i}`,
          collectedDate: new Date(base + i * DAY),
          recordedByAccountId: w.owner.accountId,
          createdAt: new Date(base + i * DAY),
        });
      }
      const work = await getOrganizationRefundWork(db, await scopeOf(w), {
        organizationId: w.organizationId,
        gatewayProvider: null,
      });
      if (!isOk(work)) throw new Error('work');
      expect(work.value.entries).toHaveLength(REFUND_WORK_LIMIT);
      expect(work.value.moreEntries).toBe(true);
      expect(work.value.moreHeld).toBe(false);
      expect(work.value.entries[0]?.reference).toBe(`BANK-${REFUND_WORK_LIMIT + 1}`);
      // The older payments stay reachable: page 2 holds payment 26 and 27 (the two oldest).
      const older = await getOrganizationRefundWork(db, await scopeOf(w), {
        organizationId: w.organizationId,
        gatewayProvider: null,
        page: 2,
      });
      if (!isOk(older)) throw new Error('older');
      expect(older.value.entries.map((e) => e.reference)).toEqual(['BANK-1', 'BANK-0']);
      expect(older.value.moreEntries).toBe(false);
      // And so does a search by invoice reference, which finds nothing for another invoice.
      const other = await invoice(w, 'INV-ELSE', 5000);
      await paidByHand(w, other, 5000);
      const found = await getOrganizationRefundWork(db, await scopeOf(w), {
        organizationId: w.organizationId,
        gatewayProvider: null,
        invoiceRef: 'inv-else',
      });
      expect(isOk(found) && found.value.entries.map((e) => e.invoiceRef)).toEqual(['INV-ELSE']);
      // A payment fully refunded is no longer listed: the limit is worked out in the database.
      const staff = await scopeOf(w);
      const elseEntry = await entryOf(w, other, 'ADMIN_RECORDED');
      const done = await recordManualRefund(db, staff, {
        organizationId: w.organizationId,
        source: entrySource(elseEntry.id),
        amountMinorUnits: 5000,
        reference: 'BANK-OUT-ELSE',
        refundedOn: new Date(),
        reason: 'Closed',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
      expect(isOk(done)).toBe(true);
      const after = await getOrganizationRefundWork(db, staff, {
        organizationId: w.organizationId,
        gatewayProvider: null,
        invoiceRef: 'INV-ELSE',
      });
      expect(isOk(after) && after.value.entries).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'starts no new gateway call once the time budget is spent, and says how many were left',
    async () => {
      const inv = await invoice(w, 'INV-BUDGET', 10_000);
      const { entry } = await paidOnline(w, inv, 10_000);
      const sent = await ask(entry.id, 1000);
      if (!isOk(sent)) throw new Error('sent');
      const scope = systemScopeForTest('process-payment-reconciliation');
      const queries = port.refundQueries.length;
      expect(await reconcileRefunds(db, scope, port, { deadline: Date.now() - 1 })).toMatchObject({
        checked: 0,
        leftForLater: 1,
      });
      expect(port.refundQueries.length).toBe(queries);
      const startedPay = await startOnlinePayment(db, port, {
        actorAccountId: w.orgOwnerId,
        invoiceId: await invoice(w, 'INV-BUDGET-2', 5000),
        urlFor: (kind, tran) => `https://app.example.test/${kind}?t=${tran}`,
      });
      if (!isOk(startedPay)) throw new Error('start');
      await db
        .update(schema.paymentAttempts)
        .set({ redirectedAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(schema.paymentAttempts.status, 'REDIRECTED'));
      const summary = await reconcilePaymentAttempts(db, scope, port, { deadline: Date.now() - 1 });
      expect(summary).toMatchObject({ checked: 0, leftForLater: 1 });
    },
    TIMEOUT,
  );
});

describe('S18 round 3: one panel refund counted once, safe resends, typed panel amounts', () => {
  let db: Db;
  let w: World;
  let port: FakePaymentPort;
  beforeEach(async () => {
    db = await freshDb();
    w = await world(db, 'round3');
    port = new FakePaymentPort();
  });

  const ask = async (entryId: string, amount: number) =>
    requestRefund(db, port, await scopeOf(w), {
      organizationId: w.organizationId,
      source: entrySource(entryId),
      amountMinorUnits: amount,
      reason: 'Refund',
      idempotencyKey: randomUUID(),
      stepUpSatisfied: true,
    });
  const recordByHand = async (entryId: string, amount: number, reference: string) =>
    recordManualRefund(db, await scopeOf(w), {
      organizationId: w.organizationId,
      source: entrySource(entryId),
      amountMinorUnits: amount,
      reference,
      refundedOn: new Date(),
      reason: 'Refunded in the panel',
      idempotencyKey: randomUUID(),
      stepUpSatisfied: true,
    });
  const wentThrough = async (requestId: string, amount: number, reference: string) =>
    confirmUnsentRefund(db, await scopeOf(w), {
      organizationId: w.organizationId,
      refundRequestId: requestId,
      reference,
      amountMinorUnits: amount,
      refundedOn: new Date(),
      stepUpSatisfied: true,
    });

  it(
    'never lets one panel refund reach the ledger twice, by hand or through It Went Through, in either order',
    async () => {
      const a = await invoice(w, 'INV-A', 10_000);
      const { entry: entryA } = await paidOnline(w, a, 10_000);
      const b = await invoice(w, 'INV-B', 10_000);
      const { entry: entryB } = await paidOnline(w, b, 10_000);
      port.refundBehaviour = 'throw';
      const unsent = await ask(entryA.id, 3000);
      if (!isOk(unsent)) throw new Error('unsent');
      // The reviewer's scenario: recorded by hand from the panel first, then It Went Through with it.
      expect(isOk(await recordByHand(entryB.id, 3000, 'PANEL-77'))).toBe(true);
      const second = await wentThrough(unsent.value.request.id, 3000, ' panel-77 ');
      expect(isErr(second) && second.error.message).toBe(REFERENCE_TAKEN);
      // The other order: It Went Through first, then by hand with the same reference.
      expect(isOk(await wentThrough(unsent.value.request.id, 3000, 'PANEL-88'))).toBe(true);
      const byHand = await recordByHand(entryB.id, 1000, 'PANEL-88');
      expect(isErr(byHand) && byHand.error.message).toBe(REFERENCE_TAKEN);
      expect((await refundRows(w)).map((row) => row.reference).sort()).toEqual([
        'PANEL-77',
        'PANEL-88',
      ]);
      // And the gateway confirming a sent refund under a reference already recorded by hand.
      port.refundBehaviour = 'accept';
      const sent = await ask(entryB.id, 1000);
      if (!isOk(sent)) throw new Error('sent');
      const gatewayRef = sent.value.request.reference ?? '';
      // Recording it by hand now is refused...
      const c = await invoice(w, 'INV-C', 10_000);
      const entryC = await paidByHand(w, c, 10_000);
      const late = await recordByHand(entryC.id, 1000, gatewayRef);
      expect(isErr(late) && late.error.message).toBe(REFERENCE_TAKEN);
      // ...and one written at the same moment (inserted directly here) never doubles the ledger.
      await db.insert(schema.refundRequests).values({
        organizationId: w.organizationId,
        invoiceId: c,
        invoicePaymentId: entryC.id,
        method: 'MANUAL',
        status: 'CONFIRMED',
        amountMinorUnits: 1000,
        currency: 'BDT',
        idempotencyKey: randomUUID(),
        reason: 'Recorded at the same moment',
        reference: gatewayRef.toLowerCase(),
        requestedByAccountId: w.owner.accountId,
        confirmedAt: new Date(),
      });
      port.refundStatus.set(gatewayRef, 'REFUNDED');
      expect(
        await reconcileRefunds(db, systemScopeForTest('process-payment-reconciliation'), port),
      ).toMatchObject({ needsCheck: 1, confirmed: 0 });
      const row = (await requests(w)).find((x) => x.id === sent.value.request.id);
      expect(row).toMatchObject({ status: 'SUBMITTED', failureCode: DUPLICATE_REFERENCE_CODE });
      expect((await refundRows(w)).filter((x) => x.reference === gatewayRef)).toHaveLength(0);
    },
    TIMEOUT,
  );

  it(
    'confirms It Went Through only with the amount the panel shows, and keeps the request amount',
    async () => {
      const inv = await invoice(w, 'INV-AMOUNT', 10_000);
      const { entry } = await paidOnline(w, inv, 10_000);
      port.refundBehaviour = 'throw';
      const unsent = await ask(entry.id, 4000);
      if (!isOk(unsent)) throw new Error('unsent');
      const wrong = await wentThrough(unsent.value.request.id, 3999, 'PANEL-1');
      expect(isErr(wrong) && wrong.error.message).toBe(AMOUNT_MISMATCH);
      expect((await requests(w))[0]).toMatchObject({ status: 'REQUESTED', amountMinorUnits: 4000 });
      expect(await refundRows(w)).toHaveLength(0);
      const right = await wentThrough(unsent.value.request.id, 4000, 'PANEL-1');
      expect(isOk(right) && right.value.status).toBe('CONFIRMED');
    },
    TIMEOUT,
  );

  it(
    'refuses Send Again after a refused resend, sends a double-clicked resend once, and clears the mark when confirmed',
    async () => {
      const inv = await invoice(w, 'INV-RETRY', 10_000);
      const { entry } = await paidOnline(w, inv, 10_000);
      port.refundBehaviour = 'throw';
      const unsent = await ask(entry.id, 5000);
      if (!isOk(unsent)) throw new Error('unsent');
      const id = unsent.value.request.id;
      const retry = async (now?: Date) =>
        retryRefund(db, port, await scopeOf(w), {
          organizationId: w.organizationId,
          refundRequestId: id,
          stepUpSatisfied: true,
          ...(now ? { now } : {}),
        });
      const callsFor = () => port.refundCalls.filter((c) => c.refundId === id).length;
      // A double click: two resends at once reach the gateway once.
      const before = callsFor();
      const both = await Promise.all([retry(), retry()]);
      expect(both.filter(isErr)).toHaveLength(1);
      expect(callsFor()).toBe(before + 1);
      // Once a resend was answered "failed", the server refuses another one.
      port.refundBehaviour = 'refuse';
      expect(isOk(await retry(new Date(Date.now() + 60_000)))).toBe(true);
      expect((await requests(w))[0]?.failureCode).toBe(RETRY_REFUSED_CODE);
      const calls = callsFor();
      const refused = await retry(new Date(Date.now() + 120_000));
      expect(isErr(refused) && refused.error.message).toBe(RETRY_REFUSED_MESSAGE);
      expect(callsFor()).toBe(calls);
      // It Went Through clears the mark.
      expect(isOk(await wentThrough(id, 5000, 'PANEL-R'))).toBe(true);
      expect((await requests(w))[0]).toMatchObject({ status: 'CONFIRMED', failureCode: null });
    },
    TIMEOUT,
  );

  it(
    'answers a write of the same reference at the same moment (a unique violation) with the plain refusal',
    async () => {
      const inv = await invoice(w, 'INV-RACE3', 10_000);
      const { entry } = await paidOnline(w, inv, 10_000);
      port.refundBehaviour = 'throw';
      const unsent = await ask(entry.id, 1000);
      if (!isOk(unsent)) throw new Error('unsent');
      const violation = Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      });
      const racing = new Proxy(db, {
        get(target, key, receiver) {
          if (key === 'transaction') {
            return async () => {
              throw new Error('failed query', { cause: violation });
            };
          }
          return Reflect.get(target, key, receiver);
        },
      }) as Db;
      const staff = await scopeOf(w);
      const confirm = await confirmUnsentRefund(racing, staff, {
        organizationId: w.organizationId,
        refundRequestId: unsent.value.request.id,
        reference: 'PANEL-RACE',
        amountMinorUnits: 1000,
        refundedOn: new Date(),
        stepUpSatisfied: true,
      });
      expect(isErr(confirm) && confirm.error.message).toBe(REFERENCE_TAKEN);
      const manual = await recordManualRefund(racing, staff, {
        organizationId: w.organizationId,
        source: entrySource(entry.id),
        amountMinorUnits: 100,
        reference: 'PANEL-RACE',
        refundedOn: new Date(),
        reason: 'Race',
        idempotencyKey: randomUUID(),
        stepUpSatisfied: true,
      });
      expect(isErr(manual) && manual.error.message).toBe(REFERENCE_TAKEN);
    },
    TIMEOUT,
  );

  it(
    'leaves refunds for the next run when a slow gateway uses up the time budget',
    async () => {
      const inv = await invoice(w, 'INV-SLOW', 50_000);
      const { entry } = await paidOnline(w, inv, 50_000);
      for (let i = 0; i < 5; i++) {
        const sent = await ask(entry.id, 1000);
        if (!isOk(sent)) throw new Error('sent');
      }
      const slow = port.queryRefund.bind(port);
      port.queryRefund = async (ref: string) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return slow(ref);
      };
      const summary = await reconcileRefunds(
        db,
        systemScopeForTest('process-payment-reconciliation'),
        port,
        { deadline: Date.now() + 100 },
      );
      expect(summary.checked).toBeGreaterThan(0);
      expect(summary.checked).toBeLessThan(5);
      expect(summary.checked + summary.leftForLater).toBe(5);
    },
    TIMEOUT,
  );
});
