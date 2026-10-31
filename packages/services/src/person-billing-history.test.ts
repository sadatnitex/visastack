import { randomUUID } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selfPrincipal } from './access/principal';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import { runBillingCycle } from './billing-cycle';
import type { Db } from './db';
import { settlePaymentAttempt, startPersonPayment } from './payments';
import { FakePaymentPort, onePort } from './payments.test-support';
import { setPlanRenewal, startPersonCheckout } from './person-billing';
import {
  PERSON_REFUND_WINDOW_DAYS,
  hasOwnBilling,
  listOwnBilling,
  ownInvoiceDocument,
  ownReceiptDocument,
} from './person-billing-history';
import {
  personInvoices,
  personPaymentAttempts,
  personSubscriptions,
} from './person-billing-tables';
import { grantPlatformRole } from './platform-roles';

/**
 * ADR 0025 T5: a person's own Billing History. What it lists (their purchases, newest first, with
 * status in plain words, paid date, refund window and receipts), what the PDFs hold (the payer
 * only by reference code and their own address), and that nobody ever sees or downloads another
 * person's rows. Purchases are made through the real checkout, payment and recording.
 */

const OWNER_EMAIL = 'owner-history@platform.example.com';
const PRICE = 49_900;
const DAY_MS = 24 * 60 * 60 * 1000;
const urlFor = (kind: string, tran: string) => `https://app.example.test/pay/${kind}?t=${tran}`;

let db: Db;
let port: FakePaymentPort;
let planId: string;
let otherPlanId: string;
let owner: string;
let alice: string;
let bob: string;

const self = (accountId: string) => selfPrincipal(accountId);

async function account(email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!isOk(made)) throw new Error('provision');
  return made.value.id;
}

async function travellerPlan(key: string, name: string): Promise<string> {
  const [plan] = await db
    .insert(schema.plans)
    .values({ key, name, audience: 'TRAVELLER', periodDays: 30 })
    .returning({ id: schema.plans.id });
  if (!plan) throw new Error('plan');
  await db.insert(schema.planPrices).values({
    planId: plan.id,
    priceMinorUnits: PRICE,
    currency: 'BDT',
    effectiveFrom: new Date('2001-01-01T00:00:00Z'),
  });
  return plan.id;
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
  planId = await travellerPlan('traveller_plus_history', 'Traveller Plus');
  otherPlanId = await travellerPlan('traveller_plus_history_b', 'Traveller Plus Yearly');
  alice = await account('alice@example.com');
  bob = await account('bob@example.com');
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

async function checkout(accountId: string, plan = planId) {
  const made = await startPersonCheckout(db, self(accountId), { planId: plan });
  if (!isOk(made)) throw new Error(`checkout: ${made.error.message}`);
  return made.value;
}

/** Pays the invoice online through the fake gateway and records it, as the IPN would. */
async function payAndRecord(accountId: string, invoiceId: string, actorEmail?: string) {
  const started = await startPersonPayment(db, onePort(port), self(accountId), {
    invoiceId,
    urlFor,
    ...(actorEmail ? { actorEmail } : {}),
  });
  if (!isOk(started) || started.value.kind !== 'redirect') throw new Error('start');
  const [attempt] = await db
    .select()
    .from(personPaymentAttempts)
    .where(eq(personPaymentAttempts.id, started.value.attemptId));
  if (!attempt) throw new Error('attempt');
  const paid = port.succeed(attempt.merchantTranId, PRICE);
  const settled = await settlePaymentAttempt(db, port, {
    merchantTranId: attempt.merchantTranId,
    valId: paid.valId,
    source: 'ipn',
  });
  expect(settled.code).toBe('recorded');
}

async function history(accountId: string, now?: Date) {
  const listed = await listOwnBilling(db, self(accountId), now ? { now } : {});
  if (!isOk(listed)) throw new Error(`list: ${listed.error.message}`);
  return listed.value;
}

/** A confirmed refund in the ledger, as the refund services record it (T6 makes this real). */
async function recordRefund(invoiceId: string) {
  await db.insert(schema.invoicePayments).values({
    invoiceId,
    amountMinorUnits: -PRICE,
    currency: 'BDT',
    kind: 'REFUND',
    sourceId: randomUUID(),
    reference: 'RF-HISTORY-1',
    collectedDate: new Date(),
    mode: 'LIVE',
  });
  await db
    .update(personInvoices)
    .set({ collectedAmountMinorUnits: 0 })
    .where(eq(personInvoices.id, invoiceId));
}

describe("a person's own Billing History (ADR 0025 T5)", () => {
  it('is empty for someone who never bought, and says so without a billing row', async () => {
    expect(await history(alice)).toEqual([]);
    expect(await hasOwnBilling(db, self(alice))).toBe(false);
  });

  it('lists purchases newest first with plan, reference, amount, status, period, paid date and receipts', async () => {
    const older = await checkout(alice, otherPlanId);
    const newer = await checkout(alice, planId);
    await payAndRecord(alice, newer.invoiceId);

    const list = await history(alice);
    expect(list.map((p) => p.id)).toEqual([newer.invoiceId, older.invoiceId]);
    const [paid, waiting] = list;
    expect(paid).toMatchObject({
      invoiceRef: newer.invoiceRef,
      planName: 'Traveller Plus',
      amountMinorUnits: PRICE,
      currency: 'BDT',
      status: 'paid',
      statusLabel: 'Paid',
      periodStart: newer.periodStart,
      periodEnd: newer.periodEnd,
      testPayment: false,
    });
    expect(paid?.paidAt).toBeInstanceOf(Date);
    expect(paid?.receipts).toHaveLength(1);
    expect(paid?.receipts[0]).toMatchObject({
      number: 'R-000001',
      receiptNumber: 1,
      amountMinorUnits: PRICE,
      currency: 'BDT',
      mode: 'LIVE',
    });
    expect(waiting).toMatchObject({
      invoiceRef: older.invoiceRef,
      planName: 'Traveller Plus Yearly',
      status: 'waiting',
      statusLabel: 'Waiting for Payment',
      paidAt: null,
      refundableUntil: null,
      receipts: [],
    });
    expect(await hasOwnBilling(db, self(alice))).toBe(true);
    // A day later the unpaid purchase can no longer be paid, and says so (T4).
    const later = await listOwnBilling(db, self(alice), { now: new Date(Date.now() + 2 * DAY_MS) });
    if (!later.ok) throw new Error('history');
    expect(later.value.find((p) => p.invoiceRef === older.invoiceRef)).toMatchObject({
      status: 'not_paid',
      statusLabel: 'Not Paid',
    });
  });

  it('offers a refund for 7 days after paying, and not after (ADR 0025 D8)', async () => {
    const made = await checkout(alice);
    await payAndRecord(alice, made.invoiceId);
    const [paid] = await history(alice);
    const paidAt = paid?.paidAt;
    if (!paidAt) throw new Error('paid date');
    expect(PERSON_REFUND_WINDOW_DAYS).toBe(7);
    expect(paid?.refundableUntil?.getTime()).toBe(paidAt.getTime() + 7 * DAY_MS);
    const lastDay = await history(alice, new Date(paidAt.getTime() + 7 * DAY_MS - 60_000));
    expect(lastDay[0]?.refundableUntil).not.toBeNull();
    const tooLate = await history(alice, new Date(paidAt.getTime() + 7 * DAY_MS));
    expect(tooLate[0]?.refundableUntil).toBeNull();
  });

  it('shows a renewal the daily run made as waiting, from the end of the paid period, and Cancelled after Stop Renewing (T4)', async () => {
    const made = await checkout(alice);
    await payAndRecord(alice, made.invoiceId);
    // Move the paid period so it ends in 5 days, then let the daily run make the renewal.
    const end = new Date(Date.now() + 5 * DAY_MS);
    await db
      .update(personInvoices)
      .set({ periodStart: new Date(end.getTime() - 30 * DAY_MS), periodEnd: end })
      .where(eq(personInvoices.id, made.invoiceId));
    await db
      .update(personSubscriptions)
      .set({ startedAt: new Date(end.getTime() - 30 * DAY_MS) })
      .where(eq(personSubscriptions.payerAccountId, alice));
    await runBillingCycle(db, systemScopeForTest('process-billing-cycle'), { now: new Date() });
    const [renewal, original] = await history(alice);
    expect(original?.status).toBe('paid');
    expect(renewal).toMatchObject({ status: 'waiting', statusLabel: 'Waiting for Payment' });
    expect(renewal?.periodStart.getTime()).toBe(end.getTime());
    // Still waiting through the grace week, and not paid after it.
    expect((await history(alice, new Date(end.getTime() + 6 * DAY_MS)))[0]?.status).toBe('waiting');
    expect((await history(alice, new Date(end.getTime() + 8 * DAY_MS)))[0]?.status).toBe(
      'not_paid',
    );
    expect(isOk(await setPlanRenewal(db, self(alice), { renews: false }))).toBe(true);
    expect((await history(alice))[0]).toMatchObject({
      status: 'cancelled',
      statusLabel: 'Cancelled',
    });
  });

  it('shows a refunded purchase as Refunded, with no further refund offered', async () => {
    const made = await checkout(alice);
    await payAndRecord(alice, made.invoiceId);
    await recordRefund(made.invoiceId);
    const [refunded] = await history(alice);
    expect(refunded).toMatchObject({
      status: 'refunded',
      statusLabel: 'Refunded',
      refundableUntil: null,
    });
    // The day it was paid stays on the record after the refund.
    expect(refunded?.paidAt).toBeInstanceOf(Date);
    // The receipt for the money that came in is still part of the record.
    expect(refunded?.receipts.map((r) => r.number)).toEqual(['R-000001']);
    const doc = await ownInvoiceDocument(db, self(alice), made.invoiceId);
    if (!isOk(doc)) throw new Error('doc');
    expect(doc.value.stamp).toEqual({ label: 'Refunded', tone: 'refunded' });
    expect(doc.value.sections.map((s) => s.heading)).toEqual(['Payments Received', 'Refunds']);
  });

  it('marks a test-mode payment and offers no refund for it', async () => {
    port.mode = 'TEST';
    const made = await checkout(owner);
    await payAndRecord(owner, made.invoiceId, OWNER_EMAIL);
    const [paid] = await history(owner);
    expect(paid).toMatchObject({ status: 'paid', testPayment: true, refundableUntil: null });
    expect(paid?.receipts[0]?.mode).toBe('TEST');
  });
});

describe("the person's Invoice and Receipt PDFs (ADR 0025 T5)", () => {
  it('names the payer only by reference code and their own address, read now', async () => {
    const made = await checkout(alice);
    await payAndRecord(alice, made.invoiceId);
    const [paid] = await history(alice);
    const receiptId = paid?.receipts[0]?.id ?? '';
    const code = alice.replace(/-/g, '').slice(0, 8).toUpperCase();
    const now = new Date();

    const invoice = await ownInvoiceDocument(db, self(alice), made.invoiceId, now);
    if (!isOk(invoice)) throw new Error('invoice');
    expect(invoice.value).toMatchObject({
      kind: 'invoice',
      number: made.invoiceRef,
      fileName: `VisaStack-Invoice-${made.invoiceRef}.pdf`,
      stamp: { label: 'Paid', tone: 'paid' },
      billedTo: { name: 'alice@example.com', lines: [`Reference Code ${code}`] },
    });
    expect(invoice.value.items.rows[0]?.[0]).toBe('Traveller Plus');
    expect(invoice.value.facts.map((f) => f.label)).toEqual([
      'Invoice Number',
      'Issue Date',
      'Paid On',
      'Period',
    ]);
    expect(invoice.value.sections[0]?.rows[0]?.[3]).toBe('R-000001');
    // A traveller never owes money: no due date, no "Still Owed", no overdue.
    const text = JSON.stringify(invoice.value);
    expect(text).not.toMatch(/Due Date|Still Owed|Overdue|Agency Code/);

    const receipt = await ownReceiptDocument(db, self(alice), receiptId, now);
    if (!isOk(receipt)) throw new Error('receipt');
    expect(receipt.value).toMatchObject({
      kind: 'receipt',
      number: 'R-000001',
      fileName: 'VisaStack-Receipt-R-000001.pdf',
      billedTo: { name: 'alice@example.com', lines: [`Reference Code ${code}`] },
    });
    expect(receipt.value.facts).toContainEqual({ label: 'Invoice', value: made.invoiceRef });
  });

  it('says an unpaid invoice is owed by nobody', async () => {
    const made = await checkout(alice);
    const doc = await ownInvoiceDocument(db, self(alice), made.invoiceId);
    if (!isOk(doc)) throw new Error('doc');
    expect(doc.value.stamp).toEqual({ label: 'Waiting for Payment', tone: 'open' });
    expect(doc.value.notes.join(' ')).toContain('you owe nothing');
  });
});

describe("nobody sees or downloads another person's billing (ADR 0025 isolation)", () => {
  it("lists none of Alice's rows for Bob, and reads her documents as not found", async () => {
    const made = await checkout(alice);
    await payAndRecord(alice, made.invoiceId);
    const [paid] = await history(alice);
    const receiptId = paid?.receipts[0]?.id ?? '';
    expect(receiptId).not.toBe('');

    expect(await history(bob)).toEqual([]);
    expect(await hasOwnBilling(db, self(bob))).toBe(false);
    const invoiceAsBob = await ownInvoiceDocument(db, self(bob), made.invoiceId);
    expect(isErr(invoiceAsBob) && invoiceAsBob.error.code).toBe('not_found');
    const receiptAsBob = await ownReceiptDocument(db, self(bob), receiptId);
    expect(isErr(receiptAsBob) && receiptAsBob.error.code).toBe('not_found');
    // The same answer as an id that does not exist at all, and one that is not an id.
    const unknown = await ownInvoiceDocument(db, self(alice), randomUUID());
    expect(isErr(unknown) && unknown.error).toEqual(isErr(invoiceAsBob) && invoiceAsBob.error);
    const malformed = await ownReceiptDocument(db, self(alice), '../etc');
    expect(isErr(malformed) && malformed.error.code).toBe('not_found');

    // Bob's own purchase does not leak into Alice's history either.
    await checkout(bob);
    expect((await history(alice)).map((p) => p.id)).toEqual([made.invoiceId]);
  });

  it('refuses a scope that is not the genuine one minted for the session', async () => {
    const made = await checkout(alice);
    const forged = { ...self(alice) } as unknown as ReturnType<typeof selfPrincipal>;
    const listed = await listOwnBilling(db, forged);
    expect(isErr(listed) && listed.error.code).toBe('forbidden');
    const doc = await ownInvoiceDocument(db, forged, made.invoiceId);
    expect(isErr(doc) && doc.error.code).toBe('forbidden');
    const receipt = await ownReceiptDocument(db, forged, randomUUID());
    expect(isErr(receipt) && receipt.error.code).toBe('forbidden');
    expect(await hasOwnBilling(db, forged)).toBe(false);
  });
});

describe('before migrations 0110 and 0111 (ADR 0025 rollout)', () => {
  it('reads no person billing: an empty history and every document not found', async () => {
    // A separate database holding a person invoice, then put back to before 0111 (what 0111
    // changed, undone), so person billing is not present there even though the row is.
    const client = await createMigratedPglite();
    const before = drizzle(client, { schema }) as unknown as Db;
    try {
      const made = await provisionAccount(before, { email: 'carol@example.com' });
      if (!isOk(made)) throw new Error('provision');
      const carol = made.value.id;
      const [plan] = await before
        .insert(schema.plans)
        .values({ key: 'traveller_plus_old', name: 'Plus', audience: 'TRAVELLER', periodDays: 30 })
        .returning({ id: schema.plans.id });
      const now = new Date();
      const [invoice] = await before
        .insert(personInvoices)
        .values({
          organizationId: null,
          payerAccountId: carol,
          planId: plan?.id ?? '',
          periodStart: now,
          periodEnd: new Date(now.getTime() + 30 * DAY_MS),
          invoiceRef: 'TP-OLD-1',
          invoicedAmountMinorUnits: PRICE,
          currency: 'BDT',
          dueDate: now,
        })
        .returning({ id: personInvoices.id });
      await client.query(
        'alter table subscriptions alter column assigned_by_account_id set not null',
      );
      const listed = await listOwnBilling(before, self(carol));
      expect(isOk(listed) && listed.value).toEqual([]);
      expect(await hasOwnBilling(before, self(carol))).toBe(false);
      const doc = await ownInvoiceDocument(before, self(carol), invoice?.id ?? '');
      expect(isErr(doc) && doc.error.code).toBe('not_found');
    } finally {
      await client.close();
    }
  }, 60_000);
});
