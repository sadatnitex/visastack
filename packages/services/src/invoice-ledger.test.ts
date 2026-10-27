import { randomUUID } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createInvoice, getInvoiceLedger, recordInvoicePayment, voidInvoice } from './billing';
import type { Db } from './db';
import {
  type ApplyInvoiceCollectionInput,
  MAX_MINOR_UNITS,
  applyInvoiceCollection,
  invoiceLedgerPresent,
  invoiceStatusForTotals,
  isValidMinorUnitAmount,
  ledgerTotal,
  outstandingMinorUnits,
} from './invoice-ledger';
import { createOrganization, reviewOrganization } from './organizations';
import { getPlanByKey } from './plans';
import { grantPlatformRole } from './platform-roles';

const queries: string[] = [];

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, {
    schema,
    logger: { logQuery: (query: string) => queries.push(query) },
  }) as unknown as Db;
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
  return {
    organizationId: org.value.id,
    ownerAccountId: ownerAcc.value.id,
    email: `org-owner-${tag}@acme.com`,
  };
}

describe('ledger arithmetic', () => {
  it('accepts only whole, positive amounts that the column can hold', () => {
    expect(isValidMinorUnitAmount(1)).toBe(true);
    expect(isValidMinorUnitAmount(MAX_MINOR_UNITS)).toBe(true);
    for (const bad of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MAX_MINOR_UNITS + 1,
      2 ** 53,
    ]) {
      expect(isValidMinorUnitAmount(bad), String(bad)).toBe(false);
    }
  });

  it('sums signed rows so a reversal lowers the balance and the outstanding amount rises', () => {
    const rows = [
      { amountMinorUnits: 6000 },
      { amountMinorUnits: 4000 },
      { amountMinorUnits: -2500 },
    ];
    expect(ledgerTotal(rows)).toBe(7500);
    expect(outstandingMinorUnits(10000, ledgerTotal(rows))).toBe(2500);
    expect(outstandingMinorUnits(10000, 12000)).toBe(0);
    expect(ledgerTotal([])).toBe(0);
  });

  it('derives the invoice status from the totals, moving back down after a reversal, never off void', () => {
    expect(invoiceStatusForTotals('OPEN', 10000, 0)).toBe('OPEN');
    expect(invoiceStatusForTotals('OPEN', 10000, 1)).toBe('PARTIALLY_PAID');
    expect(invoiceStatusForTotals('PARTIALLY_PAID', 10000, 10000)).toBe('PAID');
    expect(invoiceStatusForTotals('PAID', 10000, 7500)).toBe('PARTIALLY_PAID');
    expect(invoiceStatusForTotals('PAID', 10000, 0)).toBe('OPEN');
    expect(invoiceStatusForTotals('VOID', 10000, 5000)).toBe('VOID');
  });
});

describe('cash ledger and the one recording function (S10)', () => {
  let db: Db;
  let owner: Awaited<ReturnType<typeof seedPlatformOwner>>;
  let org: Awaited<ReturnType<typeof seedOrganization>>;
  let planId: string;

  beforeEach(async () => {
    queries.length = 0;
    db = await freshDb();
    owner = await seedPlatformOwner(db, 'ledger');
    org = await seedOrganization(db, 'ledger');
    const plan = await getPlanByKey(db, 'agency_starter');
    if (!plan) throw new Error('seed plan');
    planId = plan.id;
  });

  async function openInvoice(
    invoiceRef: string,
    amount = 10000,
    currency = 'BDT',
    organizationId = org.organizationId,
  ) {
    const now = new Date();
    const invoice = await createInvoice(db, {
      actor: owner.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart: now,
      periodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      invoiceRef,
      invoicedAmountMinorUnits: amount,
      currency,
      dueDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
    });
    if (!isOk(invoice)) throw new Error('invoice');
    return invoice.value.id;
  }

  function collect(invoiceId: string, overrides: Partial<ApplyInvoiceCollectionInput> = {}) {
    return db.transaction((tx) =>
      applyInvoiceCollection(tx, {
        invoiceId,
        amountMinorUnits: 1000,
        currency: 'BDT',
        kind: 'ADMIN_RECORDED',
        reference: 'transfer-1',
        collectedDate: new Date('2026-10-01T00:00:00Z'),
        recordedByAccountId: owner.accountId,
        ...overrides,
      }),
    );
  }

  const ledgerRows = () => db.select().from(schema.invoicePayments);
  const invoiceRow = async (id: string) =>
    (await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)))[0];

  describe('recording', () => {
    it('writes one ledger row, moves the invoice total and status, and audits it without the reference', async () => {
      const invoiceId = await openInvoice('INV-L-1');
      const result = await collect(invoiceId, {
        amountMinorUnits: 4000,
        reference: 'bKash 8N7A6D5E',
      });
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.alreadyRecorded).toBe(false);
      expect(result.value.invoice).toMatchObject({
        collectedAmountMinorUnits: 4000,
        status: 'PARTIALLY_PAID',
      });
      const rows = await ledgerRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        invoiceId,
        amountMinorUnits: 4000,
        currency: 'BDT',
        kind: 'ADMIN_RECORDED',
        reference: 'bKash 8N7A6D5E',
        recordedByAccountId: owner.accountId,
      });
      const audit = (
        await db
          .select()
          .from(schema.auditEvents)
          .where(eq(schema.auditEvents.eventType, 'INVOICE_PAYMENT_RECORDED'))
      )[0];
      expect(audit?.metadata).toMatchObject({
        kind: 'ADMIN_RECORDED',
        currency: 'BDT',
        amountMinorUnits: 4000,
        newCollectedAmountMinorUnits: 4000,
        newStatus: 'PARTIALLY_PAID',
        ledgerEntryId: rows[0]?.id,
      });
      expect(JSON.stringify(audit)).not.toContain('8N7A6D5E');
    });

    it('keeps the invoice total equal to the ledger total after several recordings', async () => {
      const invoiceId = await openInvoice('INV-L-SUM');
      for (const amount of [1500, 2500, 3000]) {
        expect(isOk(await collect(invoiceId, { amountMinorUnits: amount }))).toBe(true);
      }
      const invoice = await invoiceRow(invoiceId);
      expect(invoice?.collectedAmountMinorUnits).toBe(ledgerTotal(await ledgerRows()));
      expect(invoice?.collectedAmountMinorUnits).toBe(7000);
    });

    it('counts a gateway payment as cash and a credit as no cash', async () => {
      const invoiceId = await openInvoice('INV-L-KINDS');
      const online = await collect(invoiceId, {
        kind: 'ONLINE',
        sourceId: randomUUID(),
        provider: 'sslcommerz',
        providerTransactionId: 'VAL-1',
        recordedByAccountId: null,
        amountMinorUnits: 3000,
      });
      expect(isOk(online)).toBe(true);
      const credit = await collect(invoiceId, {
        kind: 'CREDIT',
        sourceId: randomUUID(),
        amountMinorUnits: 2000,
        recordedByAccountId: null,
      });
      expect(isOk(credit)).toBe(true);
      const cash = (await db.select().from(schema.productEvents)).filter(
        (e) => e.eventType === 'CASH_COLLECTED',
      );
      expect(cash.map((e) => e.metricValue)).toEqual([3000]);
      const audits = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'INVOICE_PAYMENT_RECORDED'));
      expect(audits.map((a) => a.method).sort()).toEqual(['API', 'SYSTEM']);
      expect(audits.every((a) => a.actorAccountId === null)).toBe(true);
    });
  });

  describe('idempotency', () => {
    it('records the same source key once: a replay returns the first row and changes nothing', async () => {
      const invoiceId = await openInvoice('INV-L-IDEM');
      const sourceId = randomUUID();
      const first = await collect(invoiceId, {
        kind: 'MANUAL_CLAIM',
        sourceId,
        amountMinorUnits: 4000,
      });
      const second = await collect(invoiceId, {
        kind: 'MANUAL_CLAIM',
        sourceId,
        amountMinorUnits: 4000,
      });
      expect(isOk(first) && isOk(second)).toBe(true);
      if (!isOk(first) || !isOk(second)) return;
      expect(second.value.alreadyRecorded).toBe(true);
      expect(second.value.payment?.id).toBe(first.value.payment?.id);
      expect(await ledgerRows()).toHaveLength(1);
      expect((await invoiceRow(invoiceId))?.collectedAmountMinorUnits).toBe(4000);
      const audits = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'INVOICE_PAYMENT_RECORDED'));
      expect(audits).toHaveLength(1);
      const cash = (await db.select().from(schema.productEvents)).filter(
        (e) => e.eventType === 'CASH_COLLECTED',
      );
      expect(cash).toHaveLength(1);
    });

    it('answers a replay of the payment that paid the invoice in full, even though nothing is outstanding now', async () => {
      const invoiceId = await openInvoice('INV-L-IDEM-PAID', 5000);
      const sourceId = randomUUID();
      expect(
        isOk(await collect(invoiceId, { kind: 'MANUAL_CLAIM', sourceId, amountMinorUnits: 5000 })),
      ).toBe(true);
      const replay = await collect(invoiceId, {
        kind: 'MANUAL_CLAIM',
        sourceId,
        amountMinorUnits: 5000,
      });
      expect(isOk(replay) && replay.value.alreadyRecorded).toBe(true);
    });

    it('treats the same provider transaction as the same money even under a new source key', async () => {
      const invoiceId = await openInvoice('INV-L-PROVIDER');
      const base = {
        kind: 'ONLINE' as const,
        provider: 'sslcommerz',
        providerTransactionId: 'VAL-77',
        recordedByAccountId: null,
        amountMinorUnits: 2000,
      };
      expect(isOk(await collect(invoiceId, { ...base, sourceId: randomUUID() }))).toBe(true);
      const again = await collect(invoiceId, { ...base, sourceId: randomUUID() });
      expect(isOk(again) && again.value.alreadyRecorded).toBe(true);
      expect(await ledgerRows()).toHaveLength(1);
    });

    it('refuses a key reused for a different amount or a different invoice, and writes nothing', async () => {
      const invoiceId = await openInvoice('INV-L-KEY-A');
      const otherId = await openInvoice('INV-L-KEY-B');
      const sourceId = randomUUID();
      expect(isOk(await collect(invoiceId, { kind: 'MANUAL_CLAIM', sourceId }))).toBe(true);
      const otherAmount = await collect(invoiceId, {
        kind: 'MANUAL_CLAIM',
        sourceId,
        amountMinorUnits: 999,
      });
      expect(isErr(otherAmount) && otherAmount.error.code).toBe('key_conflict');
      const otherInvoice = await collect(otherId, { kind: 'MANUAL_CLAIM', sourceId });
      expect(isErr(otherInvoice) && otherInvoice.error.code).toBe('key_conflict');
      expect(await ledgerRows()).toHaveLength(1);
      expect((await invoiceRow(otherId))?.collectedAmountMinorUnits).toBe(0);
    });

    it('makes recordInvoicePayment idempotent when the caller sends the same key', async () => {
      const invoiceId = await openInvoice('INV-L-ADMIN-KEY');
      const idempotencyKey = randomUUID();
      const send = () =>
        recordInvoicePayment(db, {
          actor: owner.actor,
          stepUpSatisfied: true,
          invoiceId,
          amountMinorUnits: 3000,
          collectedDate: new Date(),
          paymentReference: 'wire-1',
          reason: 'confirmed',
          idempotencyKey,
        });
      const [a, b] = [await send(), await send()];
      expect(isOk(a) && isOk(b)).toBe(true);
      if (isOk(b)) expect(b.value.collectedAmountMinorUnits).toBe(3000);
      expect(await ledgerRows()).toHaveLength(1);
      // Without a key, every call is a new payment (as before the ledger).
      const keyless = () =>
        recordInvoicePayment(db, {
          actor: owner.actor,
          stepUpSatisfied: true,
          invoiceId,
          amountMinorUnits: 100,
          collectedDate: new Date(),
          paymentReference: 'wire-2',
          reason: 'confirmed',
        });
      await keyless();
      await keyless();
      expect(await ledgerRows()).toHaveLength(3);
    });

    it('lets the database refuse a second row with the same source or provider transaction', async () => {
      const invoiceId = await openInvoice('INV-L-DB-UNIQUE');
      const sourceId = randomUUID();
      const row = {
        invoiceId,
        amountMinorUnits: 100,
        currency: 'BDT',
        kind: 'MANUAL_CLAIM' as const,
        sourceId,
        reference: 'r',
        collectedDate: new Date(),
      };
      await db.insert(schema.invoicePayments).values(row);
      await expect(db.insert(schema.invoicePayments).values(row)).rejects.toThrow();
      const online = {
        ...row,
        kind: 'ONLINE' as const,
        provider: 'sslcommerz',
        providerTransactionId: 'X1',
      };
      await db.insert(schema.invoicePayments).values({ ...online, sourceId: randomUUID() });
      await expect(
        db.insert(schema.invoicePayments).values({ ...online, sourceId: randomUUID() }),
      ).rejects.toThrow();
    });
  });

  describe('refusals', () => {
    async function expectNothingWritten(invoiceId: string, collected = 0) {
      expect(await ledgerRows()).toHaveLength(0);
      expect((await invoiceRow(invoiceId))?.collectedAmountMinorUnits).toBe(collected);
      const audits = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'INVOICE_PAYMENT_RECORDED'));
      expect(audits).toHaveLength(0);
    }

    it('refuses a payment in a different currency, ignoring case and spaces in the same currency', async () => {
      const invoiceId = await openInvoice('INV-L-CUR', 10000, ' bdt ');
      const wrong = await collect(invoiceId, { currency: 'USD' });
      expect(isErr(wrong) && wrong.error.code).toBe('currency_mismatch');
      await expectNothingWritten(invoiceId);
      const same = await collect(invoiceId, { currency: 'Bdt' });
      expect(isOk(same)).toBe(true);
      const row = (await ledgerRows())[0];
      expect(row?.currency).toBe('BDT');
    });

    it('refuses a currency mismatch through recordInvoicePayment, and accepts the matching currency', async () => {
      const invoiceId = await openInvoice('INV-L-CUR-ADMIN', 10000, 'USD');
      const base = {
        actor: owner.actor,
        stepUpSatisfied: true,
        invoiceId,
        amountMinorUnits: 1000,
        collectedDate: new Date(),
        paymentReference: 'wire',
        reason: 'confirmed',
      };
      const wrong = await recordInvoicePayment(db, { ...base, currency: 'BDT' });
      expect(isErr(wrong) && wrong.error.message).toContain('different currency');
      const malformed = await recordInvoicePayment(db, { ...base, currency: 'taka' });
      expect(isErr(malformed) && malformed.error.code).toBe('invalid');
      await expectNothingWritten(invoiceId);
      const right = await recordInvoicePayment(db, { ...base, currency: 'usd' });
      expect(isOk(right)).toBe(true);
    });

    it('refuses a void invoice', async () => {
      const invoiceId = await openInvoice('INV-L-VOID');
      const voided = await voidInvoice(db, {
        actor: owner.actor,
        stepUpSatisfied: true,
        invoiceId,
        reason: 'issued in error',
      });
      expect(isOk(voided)).toBe(true);
      const result = await collect(invoiceId);
      expect(isErr(result) && result.error.code).toBe('void_invoice');
      await expectNothingWritten(invoiceId);
    });

    it('refuses more than is outstanding, accepts exactly the balance, then refuses anything else', async () => {
      const invoiceId = await openInvoice('INV-L-OVER', 10000);
      expect(isOk(await collect(invoiceId, { amountMinorUnits: 6000 }))).toBe(true);
      const over = await collect(invoiceId, { amountMinorUnits: 4001 });
      expect(isErr(over) && over.error.code).toBe('exceeds_outstanding');
      expect(isOk(await collect(invoiceId, { amountMinorUnits: 4000 }))).toBe(true);
      const more = await collect(invoiceId, { amountMinorUnits: 1 });
      expect(isErr(more) && more.error.code).toBe('exceeds_outstanding');
      expect(await ledgerRows()).toHaveLength(2);
      expect((await invoiceRow(invoiceId))?.status).toBe('PAID');
    });

    it('refuses an unknown invoice', async () => {
      const result = await collect('00000000-0000-0000-0000-000000000000');
      expect(isErr(result) && result.error.code).toBe('not_found');
    });

    it('refuses zero, negative, fractional, huge and not-a-number amounts', async () => {
      const invoiceId = await openInvoice('INV-L-AMOUNTS', MAX_MINOR_UNITS);
      for (const amount of [
        0,
        -5,
        0.5,
        1.0000001,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        MAX_MINOR_UNITS + 1,
        2 ** 40,
      ]) {
        const result = await collect(invoiceId, { amountMinorUnits: amount });
        expect(isErr(result) && result.error.code, String(amount)).toBe('invalid');
      }
      await expectNothingWritten(invoiceId);
      // The largest amount the column holds is accepted and cannot overflow.
      const max = await collect(invoiceId, { amountMinorUnits: MAX_MINOR_UNITS });
      expect(isOk(max)).toBe(true);
      const more = await collect(invoiceId, { amountMinorUnits: 1 });
      expect(isErr(more) && more.error.code).toBe('exceeds_outstanding');
    });

    it('refuses through recordInvoicePayment a fractional or oversized amount with a plain message', async () => {
      const invoiceId = await openInvoice('INV-L-ADMIN-AMOUNTS');
      for (const amount of [10.5, MAX_MINOR_UNITS + 1]) {
        const result = await recordInvoicePayment(db, {
          actor: owner.actor,
          stepUpSatisfied: true,
          invoiceId,
          amountMinorUnits: amount,
          collectedDate: new Date(),
          paymentReference: 'wire',
          reason: 'confirmed',
        });
        expect(isErr(result) && result.error.code).toBe('invalid');
      }
      await expectNothingWritten(invoiceId);
    });

    it('needs a reference, a valid date, a UUID source and a source key for everything except an admin recording', async () => {
      const invoiceId = await openInvoice('INV-L-SHAPE');
      const cases: Partial<ApplyInvoiceCollectionInput>[] = [
        { reference: '   ' },
        { collectedDate: new Date('not a date') },
        { currency: ' ' },
        { sourceId: 'not-a-uuid' },
        { kind: 'MANUAL_CLAIM' },
        { kind: 'CREDIT' },
        { kind: 'ONLINE', sourceId: randomUUID() },
        { provider: 'sslcommerz' },
        { providerTransactionId: 'X' },
      ];
      for (const overrides of cases) {
        const result = await collect(invoiceId, overrides);
        expect(isErr(result) && result.error.code, JSON.stringify(overrides)).toBe('invalid');
      }
      await expectNothingWritten(invoiceId);
    });

    it('refuses the recording of a refund through the collection function', async () => {
      const invoiceId = await openInvoice('INV-L-NOREFUND');
      // biome-ignore lint/suspicious/noExplicitAny: proving the guard against a caller that bypasses the type
      const result = await collect(invoiceId, { kind: 'REFUND' as any, sourceId: randomUUID() });
      expect(isErr(result)).toBe(true);
      await expectNothingWritten(invoiceId);
    });
  });

  describe('concurrency', () => {
    it('lets only one of two recordings of the same balance through', async () => {
      const invoiceId = await openInvoice('INV-L-RACE', 10000);
      const results = await Promise.all([
        collect(invoiceId, {
          kind: 'MANUAL_CLAIM',
          sourceId: randomUUID(),
          amountMinorUnits: 10000,
        }),
        collect(invoiceId, {
          kind: 'ONLINE',
          sourceId: randomUUID(),
          provider: 'sslcommerz',
          providerTransactionId: 'VAL-RACE',
          recordedByAccountId: null,
          amountMinorUnits: 10000,
        }),
      ]);
      expect(results.filter((r) => isOk(r))).toHaveLength(1);
      const codes = results.map((r) => (isErr(r) ? r.error.code : 'ok')).sort();
      expect(codes).toEqual(['exceeds_outstanding', 'ok']);
      expect(await ledgerRows()).toHaveLength(1);
      expect((await invoiceRow(invoiceId))?.collectedAmountMinorUnits).toBe(10000);
    });

    it('lets the same replayed key win once when two requests arrive together', async () => {
      const invoiceId = await openInvoice('INV-L-RACE-KEY', 10000);
      const sourceId = randomUUID();
      const results = await Promise.all([
        collect(invoiceId, { kind: 'MANUAL_CLAIM', sourceId, amountMinorUnits: 7000 }),
        collect(invoiceId, { kind: 'MANUAL_CLAIM', sourceId, amountMinorUnits: 7000 }),
      ]);
      expect(results.every((r) => isOk(r))).toBe(true);
      expect(await ledgerRows()).toHaveLength(1);
      expect((await invoiceRow(invoiceId))?.collectedAmountMinorUnits).toBe(7000);
    });

    it('locks the invoice row before it checks the balance', async () => {
      const invoiceId = await openInvoice('INV-L-LOCK');
      queries.length = 0;
      await collect(invoiceId);
      const select = queries.find((q) => /from "invoices"/.test(q) && /^select/i.test(q));
      expect(select).toMatch(/for update/i);
    });
  });

  describe('append-only', () => {
    it('refuses to edit or delete a ledger row, and to empty the ledger', async () => {
      const invoiceId = await openInvoice('INV-L-APPEND');
      expect(isOk(await collect(invoiceId, { amountMinorUnits: 2000 }))).toBe(true);
      // The driver wraps the database's message, so the cause is what carries it.
      const refusal = async (attempt: PromiseLike<unknown>): Promise<string> => {
        try {
          await attempt;
        } catch (error) {
          const cause = (error as { cause?: { message?: string } }).cause;
          return `${cause?.message ?? ''} ${(error as Error).message}`;
        }
        return 'not refused';
      };
      expect(await refusal(db.update(schema.invoicePayments).set({ amountMinorUnits: 1 }))).toMatch(
        /append-only/,
      );
      expect(await refusal(db.delete(schema.invoicePayments))).toMatch(/append-only/);
      expect(await refusal(db.execute(sql`truncate table invoice_payments`))).toMatch(
        /append-only/,
      );
      const rows = await ledgerRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.amountMinorUnits).toBe(2000);
    });

    it('computes the balance across a reversal written as a new row', async () => {
      const invoiceId = await openInvoice('INV-L-REVERSAL', 10000);
      expect(isOk(await collect(invoiceId, { amountMinorUnits: 6000 }))).toBe(true);
      expect(isOk(await collect(invoiceId, { amountMinorUnits: 4000 }))).toBe(true);
      // A refund (S18) is a negative row; nothing earlier is touched.
      await db.insert(schema.invoicePayments).values({
        invoiceId,
        amountMinorUnits: -2500,
        currency: 'BDT',
        kind: 'REFUND',
        sourceId: randomUUID(),
        reference: 'refund-1',
        collectedDate: new Date(),
      });
      const ledger = await getInvoiceLedger(db, {
        actorAccountId: owner.accountId,
        organizationId: org.organizationId,
        invoiceId,
        actorEmail: owner.actor.email,
        bootstrapEmails: [],
      });
      expect(isOk(ledger)).toBe(true);
      if (!isOk(ledger)) return;
      expect(ledger.value.entries).toHaveLength(3);
      expect(ledger.value.totalMinorUnits).toBe(7500);
      expect(outstandingMinorUnits(10000, ledger.value.totalMinorUnits)).toBe(2500);
      expect(invoiceStatusForTotals('PAID', 10000, ledger.value.totalMinorUnits)).toBe(
        'PARTIALLY_PAID',
      );
    });
  });

  describe('who can see the ledger', () => {
    async function paidInvoice(ref: string, organizationId: string) {
      const invoiceId = await openInvoice(ref, 10000, 'BDT', organizationId);
      expect(isOk(await collect(invoiceId, { amountMinorUnits: 2000 }))).toBe(true);
      return invoiceId;
    }

    it('shows an agency member its own ledger without the staff account that recorded it', async () => {
      const invoiceId = await paidInvoice('INV-L-VIS-OWN', org.organizationId);
      const seen = await getInvoiceLedger(db, {
        actorAccountId: org.ownerAccountId,
        organizationId: org.organizationId,
        invoiceId,
      });
      expect(isOk(seen)).toBe(true);
      if (!isOk(seen)) return;
      expect(seen.value.available).toBe(true);
      expect(seen.value.entries).toHaveLength(1);
      expect(seen.value.entries[0]?.recordedByAccountId).toBeNull();
      expect(seen.value.totalMinorUnits).toBe(2000);
    });

    it('shows platform staff the recording account', async () => {
      const invoiceId = await paidInvoice('INV-L-VIS-STAFF', org.organizationId);
      const seen = await getInvoiceLedger(db, {
        actorAccountId: owner.accountId,
        organizationId: org.organizationId,
        invoiceId,
        actorEmail: owner.actor.email,
        bootstrapEmails: [],
      });
      expect(isOk(seen) && seen.value.entries[0]?.recordedByAccountId).toBe(owner.accountId);
    });

    it("hides another agency's ledger: a stranger, another agency's member and a mismatched pair all fail", async () => {
      const other = await seedOrganization(db, 'other');
      const invoiceId = await paidInvoice('INV-L-VIS-A', org.organizationId);
      const otherInvoiceId = await paidInvoice('INV-L-VIS-B', other.organizationId);
      const stranger = await provisionAccount(db, { email: 'stranger-ledger@example.com' });
      if (!isOk(stranger)) throw new Error('stranger');

      const asStranger = await getInvoiceLedger(db, {
        actorAccountId: stranger.value.id,
        organizationId: org.organizationId,
        invoiceId,
      });
      expect(isErr(asStranger) && asStranger.error.code).toBe('forbidden');

      // A member of the other agency, naming this agency.
      const asOther = await getInvoiceLedger(db, {
        actorAccountId: other.ownerAccountId,
        organizationId: org.organizationId,
        invoiceId,
      });
      expect(isErr(asOther) && asOther.error.code).toBe('forbidden');

      // A member of the other agency, naming their own agency but this agency's invoice.
      const mismatched = await getInvoiceLedger(db, {
        actorAccountId: other.ownerAccountId,
        organizationId: other.organizationId,
        invoiceId,
      });
      expect(isErr(mismatched) && mismatched.error.code).toBe('not_found');

      // An email that is not a platform owner does not widen access.
      const notStaff = await getInvoiceLedger(db, {
        actorAccountId: stranger.value.id,
        organizationId: other.organizationId,
        invoiceId: otherInvoiceId,
        actorEmail: 'stranger-ledger@example.com',
        bootstrapEmails: [],
      });
      expect(isErr(notStaff) && notStaff.error.code).toBe('forbidden');
    });

    it('refuses to record when the caller is not a platform owner, and writes nothing', async () => {
      const invoiceId = await openInvoice('INV-L-PRINCIPAL');
      const result = await recordInvoicePayment(db, {
        actor: { accountId: org.ownerAccountId, email: org.email, bootstrapEmails: [] },
        stepUpSatisfied: true,
        invoiceId,
        amountMinorUnits: 100,
        collectedDate: new Date(),
        paymentReference: 'x',
        reason: 'x',
      });
      expect(isErr(result) && result.error.code).toBe('forbidden');
      expect(await ledgerRows()).toHaveLength(0);
    });
  });

  describe('before migration 0094 (the table is missing)', () => {
    beforeEach(async () => {
      await db.execute(sql`drop table invoice_payments`);
    });

    it('reports the ledger as absent', async () => {
      expect(await invoiceLedgerPresent(db)).toBe(false);
    });

    it('still records an admin payment exactly as before the ledger', async () => {
      const invoiceId = await openInvoice('INV-L-MISSING');
      const paid = await recordInvoicePayment(db, {
        actor: owner.actor,
        stepUpSatisfied: true,
        invoiceId,
        amountMinorUnits: 4000,
        collectedDate: new Date(),
        paymentReference: 'wire',
        reason: 'confirmed',
        idempotencyKey: randomUUID(),
      });
      expect(isOk(paid)).toBe(true);
      expect(isOk(paid) && paid.value.collectedAmountMinorUnits).toBe(4000);
      const audit = (
        await db
          .select()
          .from(schema.auditEvents)
          .where(eq(schema.auditEvents.eventType, 'INVOICE_PAYMENT_RECORDED'))
      )[0];
      expect(audit?.metadata).toMatchObject({ ledgerEntryId: null, kind: 'ADMIN_RECORDED' });
    });

    it('still refuses a currency mismatch, a void invoice and an overpayment', async () => {
      const invoiceId = await openInvoice('INV-L-MISSING-RULES', 1000);
      const wrong = await collect(invoiceId, { currency: 'USD' });
      expect(isErr(wrong) && wrong.error.code).toBe('currency_mismatch');
      const over = await collect(invoiceId, { amountMinorUnits: 1001 });
      expect(isErr(over) && over.error.code).toBe('exceeds_outstanding');
    });

    it('refuses gateway, claim and credit recordings as not available yet', async () => {
      const invoiceId = await openInvoice('INV-L-MISSING-ONLINE');
      const online = await collect(invoiceId, {
        kind: 'ONLINE',
        sourceId: randomUUID(),
        provider: 'sslcommerz',
        providerTransactionId: 'VAL-9',
        recordedByAccountId: null,
      });
      expect(isErr(online) && online.error.code).toBe('unavailable');
      const claim = await collect(invoiceId, { kind: 'MANUAL_CLAIM', sourceId: randomUUID() });
      expect(isErr(claim) && claim.error.code).toBe('unavailable');
      expect((await invoiceRow(invoiceId))?.collectedAmountMinorUnits).toBe(0);
    });

    it('lists an empty, unavailable ledger instead of failing', async () => {
      const invoiceId = await openInvoice('INV-L-MISSING-LIST');
      const ledger = await getInvoiceLedger(db, {
        actorAccountId: org.ownerAccountId,
        organizationId: org.organizationId,
        invoiceId,
      });
      expect(isOk(ledger) && ledger.value).toEqual({
        available: false,
        entries: [],
        totalMinorUnits: 0,
      });
    });
  });
});
