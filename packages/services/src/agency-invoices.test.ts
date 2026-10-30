import { randomUUID } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  type InvoicePaymentState,
  deriveInvoicePaymentState,
  listAgencyInvoices,
} from './agency-invoices';
import { createInvoice, recordInvoicePayment, voidInvoice } from './billing';
import type { Db } from './db';
import { IMAGE_TOO_LARGE_CODE, type ImageSanitizerPort } from './image-sanitizer';
import type { MalwareScannerPort } from './intake';
import { type ApplyInvoiceCollectionInput, applyInvoiceCollection } from './invoice-ledger';
import {
  CLAIM_NOTE_MAX,
  MANUAL_CLAIM_METHODS,
  PROOF_FILE_MAX_BYTES,
  type ProofFilePorts,
  approveManualPaymentClaim,
  listManualClaims,
  readClaimProofFile,
  rejectManualPaymentClaim,
  submitManualPaymentClaim,
} from './manual-claims';
import { addMembership, createOrganization, reviewOrganization } from './organizations';
import { startOnlinePayment } from './payments';
import { FakePaymentPort, onePort } from './payments.test-support';
import { getPlanByKey } from './plans';
import { grantPlatformRole } from './platform-roles';
import { RATE_LIMITS } from './rate-limit';
import { exhaustRateLimit } from './rate-limit.test-support';
import { getReceipt, listReceipts } from './receipt-views';
import { formatReceiptNumber, issueReceiptForPayment } from './receipts';
import { reconcileOrphans } from './reconciliation';
import type {
  BlobStore,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoredBytes,
} from './storage';

class FakeBlobStore implements BlobStore {
  readonly objects = new Map<string, StoredBytes & { readonly bucket: StorageBucket }>();
  async putObject(input: PutObjectInput): Promise<void> {
    if (this.objects.has(input.objectKey)) throw new Error('key reused');
    this.objects.set(input.objectKey, {
      bucket: input.bucket,
      contentType: input.contentType,
      bytes: input.bytes,
    });
  }
  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    return this.objects.get(objectKey);
  }
  async deleteObject(_bucket: StorageBucket, objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }
  async listObjectKeys(): Promise<ListObjectsPage> {
    return { objectKeys: [...this.objects.keys()], cursor: undefined };
  }
}

/** Flags any upload whose sixth byte is the marker, the way a real scanner flags a known-bad file. */
const UNSAFE_MARKER = 0x66;
function fakeScanner(storage: BlobStore): MalwareScannerPort {
  return {
    name: 'fake-scanner',
    version: '1',
    async scan(input) {
      const object = await storage.getObject(input.objectKey);
      return { safe: object !== undefined && object.bytes[5] !== UNSAFE_MARKER };
    },
  };
}

/** Re-encodes a photo the way the real sanitizer does: a fresh file of the real type, nothing else kept. */
const REENCODED_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
const fakeImages: ImageSanitizerPort = {
  name: 'fake-sanitizer',
  version: '1',
  async sanitize({ bytes }) {
    if (bytes[0] !== 0x89 && bytes[0] !== 0xff) throw new Error('not an image');
    return {
      bytes: bytes[0] === 0x89 ? REENCODED_PNG : new Uint8Array([0xff, 0xd8, 0xff, 7, 7]),
      contentType: bytes[0] === 0x89 ? 'image/png' : 'image/jpeg',
      width: 100,
      height: 50,
    };
  },
};

function pdf(seed: string = randomUUID()): { contentType: string; bytes: Uint8Array } {
  return {
    contentType: 'application/pdf',
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, ...Buffer.from(seed)]),
  };
}

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
    email: p.value.email,
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
  const memberAcc = await provisionAccount(db, { email: `case-manager-${tag}@acme.com` });
  if (!isOk(memberAcc)) throw new Error('provision');
  const added = await addMembership(db, {
    actorAccountId: ownerAcc.value.id,
    organizationId: org.value.id,
    accountId: memberAcc.value.id,
    role: 'CASE_MANAGER',
  });
  if (!isOk(added)) throw new Error('member');
  const adminAcc = await provisionAccount(db, { email: `admin-${tag}@acme.com` });
  if (!isOk(adminAcc)) throw new Error('provision');
  const adminAdded = await addMembership(db, {
    actorAccountId: ownerAcc.value.id,
    organizationId: org.value.id,
    accountId: adminAcc.value.id,
    role: 'ADMIN',
  });
  if (!isOk(adminAdded)) throw new Error('admin');
  return {
    organizationId: org.value.id,
    ownerAccountId: ownerAcc.value.id,
    adminAccountId: adminAcc.value.id,
    memberAccountId: memberAcc.value.id,
  };
}

const DAY = 24 * 60 * 60 * 1000;

describe('the plain payment state of an invoice', () => {
  const now = new Date('2026-10-27T10:00:00Z');
  const attempt = (status: string, ageMs = 60_000) => ({
    status: status as 'REDIRECTED',
    createdAt: new Date(now.getTime() - ageMs),
    redirectedAt: new Date(now.getTime() - ageMs),
  });
  const state = (
    status: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'VOID',
    attempts: ReturnType<typeof attempt>[] = [],
    waitingClaim = false,
  ): InvoicePaymentState => deriveInvoicePaymentState({ status, attempts, waitingClaim, now });

  it('is Open when nothing is under way, also while part paid', () => {
    expect(state('OPEN')).toBe('OPEN');
    expect(state('PARTIALLY_PAID')).toBe('OPEN');
    expect(state('OPEN', [attempt('FAILED'), attempt('CANCELLED'), attempt('EXPIRED')])).toBe(
      'OPEN',
    );
  });

  it('is Payment Started only for a payment page opened in the last 30 minutes', () => {
    expect(state('OPEN', [attempt('REDIRECTED', 5 * 60_000)])).toBe('PAYMENT_STARTED');
    expect(state('OPEN', [attempt('REDIRECTED', 31 * 60_000)])).toBe('OPEN');
  });

  it('is Payment Reported while a report waits', () => {
    expect(state('OPEN', [], true)).toBe('PAYMENT_REPORTED');
    expect(state('PARTIALLY_PAID', [attempt('REDIRECTED')], true)).toBe('PAYMENT_REPORTED');
  });

  it('is Payment Needs a Check when the gateway confirmed money that was not counted', () => {
    expect(state('OPEN', [attempt('HELD_FOR_REVIEW')], true)).toBe('NEEDS_CHECK');
  });

  it('is Paid or Void whatever else is recorded, except money held for a check', () => {
    expect(state('PAID', [attempt('REDIRECTED')], true)).toBe('PAID');
    expect(state('PAID', [attempt('HELD_FOR_REVIEW')], true)).toBe('NEEDS_CHECK');
    expect(state('VOID', [attempt('REDIRECTED')], true)).toBe('VOID');
    expect(state('VOID', [attempt('HELD_FOR_REVIEW')], true)).toBe('VOID');
  });
});

describe('numbered receipts (S12)', () => {
  let db: Db;
  let platform: Awaited<ReturnType<typeof seedPlatformOwner>>;
  let org: Awaited<ReturnType<typeof seedOrganization>>;
  let other: Awaited<ReturnType<typeof seedOrganization>>;
  let planId: string;

  beforeEach(async () => {
    db = await freshDb();
    platform = await seedPlatformOwner(db, 'rcpt');
    org = await seedOrganization(db, 'rcpt');
    other = await seedOrganization(db, 'rcpt-other');
    const plan = await getPlanByKey(db, 'agency_starter');
    if (!plan) throw new Error('seed plan');
    planId = plan.id;
  });

  // Each invoice gets its own period start: since S17 two live invoices for the same plan and
  // overlapping period are refused, so each one starts 31 days after the one before.
  let periods = 0;
  async function openInvoice(
    organizationId: string,
    ref: string,
    amount = 100000,
    currency = 'BDT',
  ): Promise<string> {
    const now = new Date(Date.now() + ++periods * 31 * DAY);
    const created = await createInvoice(db, {
      actor: platform.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart: now,
      periodEnd: new Date(now.getTime() + 30 * DAY),
      invoiceRef: ref,
      invoicedAmountMinorUnits: amount,
      currency,
      dueDate: new Date(now.getTime() + 14 * DAY),
    });
    if (!isOk(created)) throw new Error('invoice');
    return created.value.id;
  }

  function collect(invoiceId: string, overrides: Partial<ApplyInvoiceCollectionInput> = {}) {
    return db.transaction((tx) =>
      applyInvoiceCollection(tx, {
        invoiceId,
        amountMinorUnits: 1000,
        currency: 'BDT',
        kind: 'ADMIN_RECORDED',
        reference: 'wire-1',
        collectedDate: new Date(),
        recordedByAccountId: platform.accountId,
        ...overrides,
      }),
    );
  }

  const receiptRows = () => db.select().from(schema.paymentReceipts);

  it('issues a receipt for every kind of collection, numbered from 1 in each agency', async () => {
    const a = await openInvoice(org.organizationId, 'INV-R-A');
    const b = await openInvoice(other.organizationId, 'INV-R-B');
    const first = await collect(a);
    const second = await collect(a, {
      kind: 'MANUAL_CLAIM',
      sourceId: randomUUID(),
      amountMinorUnits: 2000,
    });
    const third = await collect(a, {
      kind: 'ONLINE',
      sourceId: randomUUID(),
      provider: 'sslcommerz',
      providerTransactionId: 'VAL-R-1',
      recordedByAccountId: null,
      amountMinorUnits: 3000,
    });
    const credit = await collect(a, {
      kind: 'CREDIT',
      sourceId: randomUUID(),
      amountMinorUnits: 500,
      recordedByAccountId: null,
    });
    const otherFirst = await collect(b);
    for (const result of [first, second, third, credit, otherFirst]) {
      expect(isOk(result)).toBe(true);
    }
    const numbers = (r: typeof first) => (isOk(r) ? r.value.receipt?.receiptNumber : undefined);
    expect([first, second, third, credit].map(numbers)).toEqual([1, 2, 3, 4]);
    expect(numbers(otherFirst)).toBe(1);
    expect(formatReceiptNumber(42)).toBe('R-000042');
    const rows = await receiptRows();
    expect(rows).toHaveLength(5);
    // One receipt per ledger row, matching its amount and currency.
    const ledger = await db.select().from(schema.invoicePayments);
    for (const row of ledger) {
      const receipt = rows.find((r) => r.invoicePaymentId === row.id);
      expect(receipt?.amountMinorUnits).toBe(row.amountMinorUnits);
      expect(receipt?.currency).toBe(row.currency);
    }
  });

  it('issues nothing for a refused recording and leaves no gap in the numbers', async () => {
    const invoiceId = await openInvoice(org.organizationId, 'INV-R-GAP', 5000);
    const voided = await openInvoice(org.organizationId, 'INV-R-VOID', 5000);
    expect(
      isOk(
        await voidInvoice(db, {
          actor: platform.actor,
          stepUpSatisfied: true,
          invoiceId: voided,
          reason: 'error',
        }),
      ),
    ).toBe(true);

    const one = await collect(invoiceId, { amountMinorUnits: 1000 });
    const tooMuch = await collect(invoiceId, { amountMinorUnits: 99999 });
    const wrongCurrency = await collect(invoiceId, { currency: 'USD' });
    const onVoid = await collect(voided);
    const invalid = await collect(invoiceId, { amountMinorUnits: 0 });
    for (const refused of [tooMuch, wrongCurrency, onVoid, invalid]) {
      expect(isErr(refused)).toBe(true);
    }
    const two = await collect(invoiceId, { amountMinorUnits: 1000 });
    expect(isOk(one) && one.value.receipt?.receiptNumber).toBe(1);
    expect(isOk(two) && two.value.receipt?.receiptNumber).toBe(2);
    expect(await receiptRows()).toHaveLength(2);
  });

  it('gives a number back when the recording that took it rolls back', async () => {
    const invoiceId = await openInvoice(org.organizationId, 'INV-R-ROLLBACK');
    await expect(
      db.transaction(async (tx) => {
        const applied = await applyInvoiceCollection(tx, {
          invoiceId,
          amountMinorUnits: 1000,
          currency: 'BDT',
          kind: 'ADMIN_RECORDED',
          reference: 'wire-x',
          collectedDate: new Date(),
          recordedByAccountId: platform.accountId,
        });
        expect(isOk(applied) && applied.value.receipt?.receiptNumber).toBe(1);
        throw new Error('the caller failed after recording');
      }),
    ).rejects.toThrow('the caller failed');
    expect(await receiptRows()).toHaveLength(0);
    const again = await collect(invoiceId);
    expect(isOk(again) && again.value.receipt?.receiptNumber).toBe(1);
  });

  it('numbers receipts without gaps or repeats when many are issued together, across invoices', async () => {
    const invoices = await Promise.all(
      ['A', 'B', 'C', 'D'].map((tag) => openInvoice(org.organizationId, `INV-R-C-${tag}`, 100000)),
    );
    const otherInvoice = await openInvoice(other.organizationId, 'INV-R-C-OTHER', 100000);
    const results = await Promise.all([
      ...invoices.flatMap((id) => [
        collect(id, { amountMinorUnits: 100 }),
        collect(id, { amountMinorUnits: 200 }),
        collect(id, { amountMinorUnits: 300 }),
      ]),
      collect(otherInvoice, { amountMinorUnits: 100 }),
      collect(otherInvoice, { amountMinorUnits: 200 }),
    ]);
    expect(results.every((r) => isOk(r))).toBe(true);
    const rows = await receiptRows();
    const of = (organizationId: string) =>
      rows
        .filter((r) => r.organizationId === organizationId)
        .map((r) => r.receiptNumber)
        .sort((x, y) => x - y);
    expect(of(org.organizationId)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(of(other.organizationId)).toEqual([1, 2]);
    const [counter] = await db
      .select()
      .from(schema.paymentReceiptCounters)
      .where(eq(schema.paymentReceiptCounters.organizationId, org.organizationId));
    expect(counter?.lastNumber).toBe(12);
  });

  it('never hands out a number twice, even when the counter has fallen behind the receipts', async () => {
    const invoiceId = await openInvoice(org.organizationId, 'INV-R-DRIFT');
    const numberOf = (r: Awaited<ReturnType<typeof collect>>) =>
      isOk(r) ? r.value.receipt?.receiptNumber : undefined;
    expect(numberOf(await collect(invoiceId))).toBe(1);
    expect(numberOf(await collect(invoiceId))).toBe(2);
    await db
      .update(schema.paymentReceiptCounters)
      .set({ lastNumber: 0 })
      .where(eq(schema.paymentReceiptCounters.organizationId, org.organizationId));
    expect(numberOf(await collect(invoiceId))).toBe(3);
    await db.delete(schema.paymentReceiptCounters);
    expect(numberOf(await collect(invoiceId))).toBe(4);
    const numbers = (await receiptRows()).map((r) => r.receiptNumber).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4]);
  });

  it('gives a replay of the same recording the same receipt and issues no second one', async () => {
    const invoiceId = await openInvoice(org.organizationId, 'INV-R-REPLAY');
    const sourceId = randomUUID();
    const first = await collect(invoiceId, { kind: 'MANUAL_CLAIM', sourceId });
    const replay = await collect(invoiceId, { kind: 'MANUAL_CLAIM', sourceId });
    const both = await Promise.all([
      collect(invoiceId, { kind: 'MANUAL_CLAIM', sourceId }),
      collect(invoiceId, { kind: 'MANUAL_CLAIM', sourceId }),
    ]);
    expect(isOk(first) && isOk(replay)).toBe(true);
    const receiptOf = (r: typeof first) => (isOk(r) ? r.value.receipt : undefined);
    expect(receiptOf(replay)?.id).toBe(receiptOf(first)?.id);
    for (const r of both) expect(receiptOf(r)?.id).toBe(receiptOf(first)?.id);
    expect(isOk(replay) && replay.value.alreadyRecorded).toBe(true);
    expect(await receiptRows()).toHaveLength(1);
    // A different payment after the replays takes the next number, with nothing skipped.
    const next = await collect(invoiceId, { kind: 'MANUAL_CLAIM', sourceId: randomUUID() });
    expect(isOk(next) && next.value.receipt?.receiptNumber).toBe(2);
  });

  it('gives a replayed recording that predates the receipts its receipt the first time it is seen', async () => {
    const invoiceId = await openInvoice(org.organizationId, 'INV-R-LATE');
    const sourceId = randomUUID();
    const first = await collect(invoiceId, { kind: 'MANUAL_CLAIM', sourceId });
    expect(isOk(first)).toBe(true);
    // As if the money had been recorded before the receipt tables existed.
    await db.execute(
      sql`alter table payment_receipts disable trigger payment_receipts_append_only_rows`,
    );
    await db.execute(sql`delete from payment_receipts`);
    await db.execute(sql`update payment_receipt_counters set last_number = 0`);
    const replay = await collect(invoiceId, { kind: 'MANUAL_CLAIM', sourceId });
    expect(isOk(replay) && replay.value.receipt?.receiptNumber).toBe(1);
    expect(isOk(replay) && replay.value.alreadyRecorded).toBe(true);
    expect(await receiptRows()).toHaveLength(1);
  });

  it('exists only for a recorded collection: the database refuses a receipt without money or a second one', async () => {
    const invoiceId = await openInvoice(org.organizationId, 'INV-R-ONLY');
    const recorded = await collect(invoiceId);
    expect(isOk(recorded)).toBe(true);
    const payment = isOk(recorded) ? recorded.value.payment : null;
    if (!payment) throw new Error('payment');
    // No ledger row behind it.
    await expect(
      db.insert(schema.paymentReceipts).values({
        organizationId: org.organizationId,
        invoiceId,
        invoicePaymentId: randomUUID(),
        receiptNumber: 50,
        amountMinorUnits: 10,
        currency: 'BDT',
      }),
    ).rejects.toThrow();
    // A second receipt for the same ledger row.
    await expect(
      db.insert(schema.paymentReceipts).values({
        organizationId: org.organizationId,
        invoiceId,
        invoicePaymentId: payment.id,
        receiptNumber: 51,
        amountMinorUnits: 10,
        currency: 'BDT',
      }),
    ).rejects.toThrow();
    // A reversal (a refund row) is not a collection: no receipt is issued for it.
    const refund = (
      await db
        .insert(schema.invoicePayments)
        .values({
          invoiceId,
          amountMinorUnits: -500,
          currency: 'BDT',
          kind: 'REFUND',
          sourceId: randomUUID(),
          reference: 'refund-1',
          collectedDate: new Date(),
          mode: 'LIVE',
        })
        .returning()
    )[0];
    if (!refund) throw new Error('refund');
    expect(
      await db.transaction((tx) =>
        issueReceiptForPayment(tx, { payment: refund, organizationId: org.organizationId }),
      ),
    ).toBeNull();
    expect(await receiptRows()).toHaveLength(1);
  });

  it('cannot be edited or removed after it is issued', async () => {
    const invoiceId = await openInvoice(org.organizationId, 'INV-R-IMMUTABLE');
    expect(isOk(await collect(invoiceId))).toBe(true);
    const refusal = async (attempt: PromiseLike<unknown>): Promise<string> => {
      try {
        await attempt;
      } catch (error) {
        const cause = (error as { cause?: { message?: string } }).cause;
        return `${cause?.message ?? ''} ${(error as Error).message}`;
      }
      return 'not refused';
    };
    expect(await refusal(db.update(schema.paymentReceipts).set({ amountMinorUnits: 1 }))).toMatch(
      /append-only/,
    );
    expect(await refusal(db.delete(schema.paymentReceipts))).toMatch(/append-only/);
    expect(await receiptRows()).toHaveLength(1);
  });

  it('keeps recording money when the receipt tables are not there yet', async () => {
    await db.execute(sql`drop table payment_receipts, payment_receipt_counters`);
    const invoiceId = await openInvoice(org.organizationId, 'INV-R-MISSING', 5000);
    const recorded = await collect(invoiceId, { amountMinorUnits: 5000 });
    expect(isOk(recorded) && recorded.value.receipt).toBeNull();
    expect(isOk(recorded) && recorded.value.invoice.status).toBe('PAID');
    const replay = await collect(invoiceId, { amountMinorUnits: 5000 });
    expect(replay.ok).toBe(false);
    const listed = await listReceipts(db, {
      actorAccountId: org.ownerAccountId,
      organizationId: org.organizationId,
    });
    expect(isOk(listed) && listed.value).toEqual([]);
    const detail = await getReceipt(db, {
      actorAccountId: org.ownerAccountId,
      organizationId: org.organizationId,
      receiptId: randomUUID(),
    });
    expect(isErr(detail) && detail.error.code).toBe('not_found');
  });

  it('holds only ids, the number, the amount and the currency, in the receipt and in the audit trail', async () => {
    const invoiceId = await openInvoice(org.organizationId, 'INV-R-PRIVACY');
    const reference = 'SECRET-TRANSFER-REF-7781';
    const recorded = await collect(invoiceId, { reference });
    expect(isOk(recorded)).toBe(true);
    const row = (await receiptRows())[0];
    expect(Object.keys(row ?? {}).sort()).toEqual(
      [
        'amountMinorUnits',
        'currency',
        'id',
        'invoiceId',
        'invoicePaymentId',
        'issuedAt',
        'organizationId',
        'receiptNumber',
      ].sort(),
    );
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'PAYMENT_RECEIPT_ISSUED'));
    expect(events).toHaveLength(1);
    expect(Object.keys((events[0]?.metadata ?? {}) as object).sort()).toEqual(
      [
        'amountMinorUnits',
        'currency',
        'invoiceId',
        'invoicePaymentId',
        'organizationId',
        'receiptNumber',
      ].sort(),
    );
    const everything = JSON.stringify(await db.select().from(schema.auditEvents));
    expect(everything).not.toContain(reference);
  });

  it('is readable by the agency owners and admins and platform staff only, and only within the agency', async () => {
    const invoiceId = await openInvoice(org.organizationId, 'INV-R-READ');
    const otherInvoice = await openInvoice(other.organizationId, 'INV-R-READ-OTHER');
    const mine = await collect(invoiceId);
    const theirs = await collect(otherInvoice);
    const mineId = isOk(mine) ? mine.value.receipt?.id : undefined;
    const theirsId = isOk(theirs) ? theirs.value.receipt?.id : undefined;
    if (!mineId || !theirsId) throw new Error('receipts');

    for (const accountId of [org.ownerAccountId, org.adminAccountId]) {
      const listed = await listReceipts(db, {
        actorAccountId: accountId,
        organizationId: org.organizationId,
      });
      expect(isOk(listed) && listed.value.map((r) => r.number)).toEqual(['R-000001']);
      const one = await getReceipt(db, {
        actorAccountId: accountId,
        organizationId: org.organizationId,
        receiptId: mineId,
      });
      expect(isOk(one) && one.value.invoiceRef).toBe('INV-R-READ');
      expect(isOk(one) && one.value.organizationName).toBe('Acme rcpt');
    }
    const platformList = await listReceipts(db, {
      actorAccountId: platform.accountId,
      actorEmail: platform.email,
      organizationId: org.organizationId,
    });
    expect(isOk(platformList)).toBe(true);
    // An ordinary member, and the other agency's owner, are refused.
    for (const accountId of [org.memberAccountId, other.ownerAccountId]) {
      const refused = await listReceipts(db, {
        actorAccountId: accountId,
        organizationId: org.organizationId,
      });
      expect(isErr(refused) && refused.error.code).toBe('forbidden');
    }
    // Another agency's receipt looks like a missing one, even to a platform owner naming the wrong agency.
    const crossed = await getReceipt(db, {
      actorAccountId: org.ownerAccountId,
      organizationId: org.organizationId,
      receiptId: theirsId,
    });
    expect(isErr(crossed) && crossed.error.code).toBe('not_found');
    const crossedByPlatform = await getReceipt(db, {
      actorAccountId: platform.accountId,
      actorEmail: platform.email,
      organizationId: org.organizationId,
      receiptId: theirsId,
    });
    expect(isErr(crossedByPlatform) && crossedByPlatform.error.code).toBe('not_found');
  });
});

describe('agency invoices and "I Paid Another Way" (S12)', () => {
  let db: Db;
  let platform: Awaited<ReturnType<typeof seedPlatformOwner>>;
  let org: Awaited<ReturnType<typeof seedOrganization>>;
  let other: Awaited<ReturnType<typeof seedOrganization>>;
  let planId: string;
  let storage: FakeBlobStore;
  let ports: ProofFilePorts;

  beforeEach(async () => {
    db = await freshDb();
    platform = await seedPlatformOwner(db, 'claim');
    org = await seedOrganization(db, 'claim');
    other = await seedOrganization(db, 'claim-other');
    const plan = await getPlanByKey(db, 'agency_starter');
    if (!plan) throw new Error('seed plan');
    planId = plan.id;
    storage = new FakeBlobStore();
    ports = { storage, scanner: fakeScanner(storage), images: fakeImages };
  });

  // Each invoice gets its own period start: since S17 two live invoices for the same plan and
  // overlapping period are refused, so each one starts 31 days after the one before.
  let periods = 0;
  async function openInvoice(
    organizationId: string,
    ref: string,
    amount = 100000,
    currency = 'BDT',
  ): Promise<string> {
    const now = new Date(Date.now() + ++periods * 31 * DAY);
    const created = await createInvoice(db, {
      actor: platform.actor,
      stepUpSatisfied: true,
      organizationId,
      planId,
      periodStart: now,
      periodEnd: new Date(now.getTime() + 30 * DAY),
      invoiceRef: ref,
      invoicedAmountMinorUnits: amount,
      currency,
      dueDate: new Date(now.getTime() + 14 * DAY),
    });
    if (!isOk(created)) throw new Error('invoice');
    return created.value.id;
  }

  const claimInput = (invoiceId: string, overrides: Record<string, unknown> = {}) => ({
    actorAccountId: org.ownerAccountId,
    invoiceId,
    method: 'BANK_TRANSFER',
    reference: 'TRX-90210',
    amountMinorUnits: 40000,
    paidOn: new Date(Date.now() - DAY),
    ...overrides,
  });

  const submit = (invoiceId: string, overrides: Record<string, unknown> = {}) =>
    submitManualPaymentClaim(db, ports, claimInput(invoiceId, overrides));

  const approve = (claimId: string, overrides: Record<string, unknown> = {}) =>
    approveManualPaymentClaim(db, {
      actor: platform.actor,
      stepUpSatisfied: true,
      claimId,
      ...overrides,
    });

  const ledgerRows = () => db.select().from(schema.invoicePayments);
  const receiptRows = () => db.select().from(schema.paymentReceipts);
  const invoiceRow = async (id: string) =>
    (await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)))[0];

  async function waitingClaim(invoiceId: string, overrides: Record<string, unknown> = {}) {
    const submitted = await submit(invoiceId, overrides);
    if (!isOk(submitted)) throw new Error(`claim: ${submitted.error.message}`);
    return submitted.value;
  }

  it("reads a typed claim amount in the invoice's own stored currency (S30)", async () => {
    const yen = await openInvoice(org.organizationId, 'INV-CLAIM-JPY', 10000, 'JPY');
    // "2,500" is 2500 yen: the decimal places come from the stored invoice, not from a form.
    const sent = await submit(yen, { amountMinorUnits: undefined, amountText: '2,500' });
    expect(isOk(sent) && sent.value.amountMinorUnits).toBe(2500);
    const taka = await openInvoice(org.organizationId, 'INV-CLAIM-BDT', 100000);
    const bad = await submit(taka, { amountMinorUnits: undefined, amountText: '12.505' });
    expect(isErr(bad) && bad.error.reason).toBe('amount_invalid');
    const over = await submit(taka, { amountMinorUnits: undefined, amountText: '1,000.01' });
    expect(isErr(over) && over.error.reason).toBe('amount_over_balance');
    // A currency named by the form that is not the invoice's is refused with its own reason.
    const mismatch = await submit(taka, {
      amountMinorUnits: undefined,
      amountText: '10.00',
      currency: 'USD',
    });
    expect(isErr(mismatch) && mismatch.error.reason).toBe('currency_mismatch');
  });

  it('lists only real methods, pinned to the database', async () => {
    const dbMethods = [...schema.manualClaimMethod.enumValues];
    expect([...MANUAL_CLAIM_METHODS]).toEqual(dbMethods);
  });

  describe('reporting a payment', () => {
    it('records nothing: the report waits and the invoice only shows Payment Reported', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-C-1');
      const claim = await waitingClaim(invoiceId);
      expect(claim).toMatchObject({
        status: 'SUBMITTED',
        method: 'BANK_TRANSFER',
        amountMinorUnits: 40000,
        currency: 'BDT',
        hasProofFile: false,
        decisionReason: null,
      });
      expect(await ledgerRows()).toHaveLength(0);
      expect(await receiptRows()).toHaveLength(0);
      const invoice = await invoiceRow(invoiceId);
      expect(invoice?.collectedAmountMinorUnits).toBe(0);
      expect(invoice?.status).toBe('OPEN');
      const listed = await listAgencyInvoices(db, {
        actorAccountId: org.ownerAccountId,
        organizationId: org.organizationId,
      });
      expect(isOk(listed) && listed.value[0]?.state).toBe('PAYMENT_REPORTED');
    });

    it('lets an owner and an admin report, and nobody else', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-C-WHO', 500000);
      for (const accountId of [org.ownerAccountId, org.adminAccountId]) {
        const result = await submit(invoiceId, { actorAccountId: accountId });
        expect(isOk(result), accountId).toBe(true);
        if (isOk(result)) {
          await rejectManualPaymentClaim(db, {
            actor: platform.actor,
            claimId: result.value.id,
            reason: 'try again',
          });
        }
      }
      // An ordinary member of the agency, another agency's owner and a stranger all see "not found".
      const stranger = await provisionAccount(db, { email: 'stranger@example.com' });
      if (!isOk(stranger)) throw new Error('stranger');
      for (const accountId of [org.memberAccountId, other.ownerAccountId, stranger.value.id]) {
        const result = await submit(invoiceId, { actorAccountId: accountId });
        expect(isErr(result) && result.error.code, accountId).toBe('not_found');
      }
      expect(await db.select().from(schema.manualPaymentClaims)).toHaveLength(2);
    });

    it('keeps an ordinary member from paying online as well', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-C-ONLINE');
      const port = new FakePaymentPort();
      const started = await startOnlinePayment(db, onePort(port), {
        actorAccountId: org.memberAccountId,
        invoiceId,
        urlFor: (kind, tran) => `https://app.example.test/pay/${kind}?t=${tran}`,
      });
      expect(isErr(started) && started.error.code).toBe('not_found');
      expect(port.checkouts).toHaveLength(0);
      const seen = await listAgencyInvoices(db, {
        actorAccountId: org.memberAccountId,
        organizationId: org.organizationId,
      });
      expect(isErr(seen) && seen.error.code).toBe('forbidden');
    });

    it('refuses a report on a paid invoice with a clear message, and on a void one', async () => {
      const paid = await openInvoice(org.organizationId, 'INV-C-PAID', 10000);
      const recorded = await recordInvoicePayment(db, {
        actor: platform.actor,
        stepUpSatisfied: true,
        invoiceId: paid,
        amountMinorUnits: 10000,
        collectedDate: new Date(),
        paymentReference: 'wire-9',
        reason: 'received',
      });
      expect(isOk(recorded)).toBe(true);
      const result = await submit(paid, { amountMinorUnits: 100 });
      expect(isErr(result) && result.error.message).toBe(
        'This invoice is already paid. There is nothing left to report.',
      );
      const voided = await openInvoice(org.organizationId, 'INV-C-VOID', 10000);
      await voidInvoice(db, {
        actor: platform.actor,
        stepUpSatisfied: true,
        invoiceId: voided,
        reason: 'error',
      });
      const onVoid = await submit(voided, { amountMinorUnits: 100 });
      expect(isErr(onVoid) && onVoid.error.message).toBe(
        'This invoice was cancelled. There is nothing to pay.',
      );
      expect(await db.select().from(schema.manualPaymentClaims)).toHaveLength(0);
    });

    it('refuses an amount above the balance, a wrong currency, and bad details, with plain messages', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-C-BAD', 10000);
      const message = async (overrides: Record<string, unknown>) => {
        const result = await submit(invoiceId, overrides);
        return isErr(result) ? result.error.message : 'accepted';
      };
      expect(await message({ amountMinorUnits: 10001 })).toMatch(
        /more than the BDT\u00a0100\.00 still owed/,
      );
      expect(await message({ currency: 'USD', amountMinorUnits: 100 })).toMatch(
        /invoice is in BDT/,
      );
      expect(await message({ amountMinorUnits: 0 })).toMatch(/amount you paid/);
      expect(await message({ amountMinorUnits: 12.5 })).toMatch(/amount you paid/);
      expect(await message({ method: 'CRYPTO' })).toMatch(/how you paid/);
      expect(await message({ reference: '   ' })).toMatch(/payment reference/);
      expect(await message({ reference: 'x'.repeat(121) })).toMatch(/payment reference/);
      expect(await message({ note: 'n'.repeat(CLAIM_NOTE_MAX + 1) })).toMatch(/note/);
      expect(await message({ paidOn: new Date(Date.now() + 5 * DAY) })).toMatch(/future/);
      expect(await message({ paidOn: new Date('not a date') })).toMatch(/date you paid/);
      expect(await message({ amountMinorUnits: 10000 })).toBe('accepted');
      expect(await ledgerRows()).toHaveLength(0);
    });

    it('lets one report wait per invoice, and a new one once it was decided', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-C-ONE');
      const first = await waitingClaim(invoiceId);
      const again = await submit(invoiceId);
      expect(isErr(again) && again.error.message).toMatch(/already waiting/);
      const both = await Promise.all([submit(invoiceId), submit(invoiceId)]);
      expect(both.every((r) => isErr(r))).toBe(true);
      expect(
        isOk(
          await rejectManualPaymentClaim(db, {
            actor: platform.actor,
            claimId: first.id,
            reason: 'No such transfer',
          }),
        ),
      ).toBe(true);
      expect(isOk(await submit(invoiceId))).toBe(true);
      expect(await db.select().from(schema.manualPaymentClaims)).toHaveLength(2);
    });

    it('is slowed down for a person who reports too often', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-C-RATE');
      await exhaustRateLimit(
        db,
        org.ownerAccountId,
        'billing.claim',
        RATE_LIMITS.MANUAL_CLAIM_SUBMIT,
      );
      const result = await submit(invoiceId);
      expect(isErr(result) && result.error.code).toBe('rate_limited');
    });

    it('says "not available yet" and writes nothing while the claim tables do not exist', async () => {
      await db.execute(sql`drop table billing_receipts, manual_payment_claims`);
      const invoiceId = await openInvoice(org.organizationId, 'INV-C-MISSING');
      const result = await submit(invoiceId, { proofFile: pdf() });
      expect(isErr(result) && result.error.code).toBe('upstream_error');
      expect(isErr(result) && result.error.message).toMatch(/not available yet/);
      expect(storage.objects.size).toBe(0);
      const listed = await listManualClaims(db, {
        actorAccountId: org.ownerAccountId,
        organizationId: org.organizationId,
      });
      expect(isOk(listed) && listed.value).toEqual([]);
      const invoices = await listAgencyInvoices(db, {
        actorAccountId: org.ownerAccountId,
        organizationId: org.organizationId,
      });
      expect(isOk(invoices) && invoices.value).toHaveLength(1);
      const approved = await approve(randomUUID());
      expect(isErr(approved) && approved.error.code).toBe('upstream_error');
    });
  });

  describe('confirming or rejecting', () => {
    it('confirms once: one ledger row for the claim, one receipt, the invoice moves, repeats change nothing', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-D-1', 100000);
      const claim = await waitingClaim(invoiceId, { amountMinorUnits: 60000 });
      const approved = await approve(claim.id);
      expect(isOk(approved)).toBe(true);
      if (!isOk(approved)) return;
      expect(approved.value.claim.status).toBe('APPROVED');
      expect(approved.value.claim.decidedByAccountId).toBe(platform.accountId);
      expect(approved.value.alreadyApproved).toBe(false);
      expect(approved.value.receipt?.receiptNumber).toBe(1);

      const ledger = await ledgerRows();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({
        kind: 'MANUAL_CLAIM',
        sourceId: claim.id,
        amountMinorUnits: 60000,
        currency: 'BDT',
        reference: 'TRX-90210',
        recordedByAccountId: platform.accountId,
      });
      const invoice = await invoiceRow(invoiceId);
      expect(invoice).toMatchObject({ collectedAmountMinorUnits: 60000, status: 'PARTIALLY_PAID' });

      // Clicked again, and clicked together: the same receipt, still one row.
      const results = await Promise.all([approve(claim.id), approve(claim.id), approve(claim.id)]);
      for (const result of results) {
        expect(isOk(result) && result.value.alreadyApproved).toBe(true);
        expect(isOk(result) && result.value.receipt?.id).toBe(approved.value.receipt?.id);
      }
      expect(await ledgerRows()).toHaveLength(1);
      expect(await receiptRows()).toHaveLength(1);
      expect((await invoiceRow(invoiceId))?.collectedAmountMinorUnits).toBe(60000);
    });

    it('lets two platform owners approve together and still records once', async () => {
      const secondAccount = await provisionAccount(db, {
        email: 'second-owner@platform.example.com',
      });
      if (!isOk(secondAccount)) throw new Error('provision');
      const granted = await grantPlatformRole(db, {
        actor: platform.actor,
        targetAccountId: secondAccount.value.id,
        role: 'PLATFORM_OWNER',
        reason: 'seed',
        stepUpSatisfied: true,
      });
      if (!isOk(granted)) throw new Error('grant');
      const second = {
        actor: {
          accountId: secondAccount.value.id,
          email: secondAccount.value.email,
          bootstrapEmails: [] as string[],
        },
      };
      const invoiceId = await openInvoice(org.organizationId, 'INV-D-RACE', 100000);
      const claim = await waitingClaim(invoiceId, { amountMinorUnits: 100000 });
      const results = await Promise.all([
        approve(claim.id),
        approveManualPaymentClaim(db, {
          actor: second.actor,
          stepUpSatisfied: true,
          claimId: claim.id,
        }),
      ]);
      expect(results.every((r) => isOk(r))).toBe(true);
      expect(await ledgerRows()).toHaveLength(1);
      expect(await receiptRows()).toHaveLength(1);
      expect((await invoiceRow(invoiceId))?.status).toBe('PAID');
    });

    it('needs a platform owner with a fresh sign-in check', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-D-WHO');
      const claim = await waitingClaim(invoiceId);
      const byOwner = await approveManualPaymentClaim(db, {
        actor: {
          accountId: org.ownerAccountId,
          email: 'org-owner-claim@acme.com',
          bootstrapEmails: [],
        },
        stepUpSatisfied: true,
        claimId: claim.id,
      });
      expect(isErr(byOwner) && byOwner.error.code).toBe('forbidden');
      const noStepUp = await approve(claim.id, { stepUpSatisfied: false });
      expect(isErr(noStepUp) && noStepUp.error.code).toBe('step_up_required');
      const rejectedByOwner = await rejectManualPaymentClaim(db, {
        actor: {
          accountId: org.ownerAccountId,
          email: 'org-owner-claim@acme.com',
          bootstrapEmails: [],
        },
        claimId: claim.id,
        reason: 'I do not want it',
      });
      expect(isErr(rejectedByOwner) && rejectedByOwner.error.code).toBe('forbidden');
      expect(await ledgerRows()).toHaveLength(0);
      const still = await db.select().from(schema.manualPaymentClaims);
      expect(still[0]?.status).toBe('SUBMITTED');
      const unknown = await approve(randomUUID());
      expect(isErr(unknown) && unknown.error.code).toBe('not_found');
    });

    it('refuses to confirm a report the invoice can no longer take, writes nothing, and the report can still be rejected', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-D-LATE', 100000);
      const claim = await waitingClaim(invoiceId, { amountMinorUnits: 70000 });
      // Meanwhile the invoice is settled another way.
      expect(
        isOk(
          await recordInvoicePayment(db, {
            actor: platform.actor,
            stepUpSatisfied: true,
            invoiceId,
            amountMinorUnits: 100000,
            collectedDate: new Date(),
            paymentReference: 'wire-full',
            reason: 'received in full',
          }),
        ),
      ).toBe(true);
      const approved = await approve(claim.id);
      expect(isErr(approved) && approved.error.message).toMatch(
        /Reject this report, or record a different amount/,
      );
      expect(await ledgerRows()).toHaveLength(1);
      expect((await invoiceRow(invoiceId))?.collectedAmountMinorUnits).toBe(100000);
      const [stillWaiting] = await db.select().from(schema.manualPaymentClaims);
      expect(stillWaiting?.status).toBe('SUBMITTED');
      const rejected = await rejectManualPaymentClaim(db, {
        actor: platform.actor,
        claimId: claim.id,
        reason: 'Invoice was paid in full another way',
      });
      expect(isOk(rejected) && rejected.value.status).toBe('REJECTED');
    });

    it('rejects with a reason the agency can read, records no money, and is final', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-D-REJECT');
      const claim = await waitingClaim(invoiceId);
      const noReason = await rejectManualPaymentClaim(db, {
        actor: platform.actor,
        claimId: claim.id,
        reason: '  ',
      });
      expect(isErr(noReason) && noReason.error.code).toBe('invalid');
      const rejected = await rejectManualPaymentClaim(db, {
        actor: platform.actor,
        claimId: claim.id,
        reason: 'We found no transfer with this reference',
      });
      expect(isOk(rejected) && rejected.value.status).toBe('REJECTED');
      expect(await ledgerRows()).toHaveLength(0);
      expect(await receiptRows()).toHaveLength(0);
      // Rejecting again changes nothing; confirming a rejected report is refused.
      const again = await rejectManualPaymentClaim(db, {
        actor: platform.actor,
        claimId: claim.id,
        reason: 'again',
      });
      expect(isOk(again) && again.value.decisionReason).toBe(
        'We found no transfer with this reference',
      );
      const approved = await approve(claim.id);
      expect(isErr(approved) && approved.error.message).toBe('This report was already rejected.');
      // The agency sees the reason; it does not see who decided.
      const seen = await listManualClaims(db, {
        actorAccountId: org.ownerAccountId,
        organizationId: org.organizationId,
      });
      expect(isOk(seen) && seen.value[0]).toMatchObject({
        status: 'REJECTED',
        decisionReason: 'We found no transfer with this reference',
        decidedByAccountId: null,
        submittedByAccountId: null,
      });
      const staff = await listManualClaims(db, {
        actorAccountId: platform.accountId,
        actorEmail: platform.email,
        organizationId: org.organizationId,
      });
      expect(isOk(staff) && staff.value[0]?.decidedByAccountId).toBe(platform.accountId);
      expect(isOk(staff) && staff.value[0]?.submittedByAccountId).toBe(org.ownerAccountId);
      // A confirmed report cannot be rejected afterwards.
      const other2 = await waitingClaim(invoiceId);
      expect(isOk(await approve(other2.id))).toBe(true);
      const late = await rejectManualPaymentClaim(db, {
        actor: platform.actor,
        claimId: other2.id,
        reason: 'oops',
      });
      expect(isErr(late) && late.error.message).toBe('This report was already confirmed.');
    });

    it('freezes a decided report at the database', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-D-FROZEN');
      const claim = await waitingClaim(invoiceId);
      expect(isOk(await approve(claim.id))).toBe(true);
      await expect(
        db
          .update(schema.manualPaymentClaims)
          .set({ amountMinorUnits: 1 })
          .where(eq(schema.manualPaymentClaims.id, claim.id)),
      ).rejects.toThrow();
      await expect(db.delete(schema.manualPaymentClaims)).rejects.toThrow();
    });

    it('writes audit records without the reference, the note or the file', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-D-AUDIT');
      const claim = await waitingClaim(invoiceId, {
        reference: 'PRIVATE-REF-55512',
        note: 'PRIVATE-NOTE-from-the-accountant',
        proofFile: pdf('PRIVATE-FILE-CONTENT'),
      });
      expect(isOk(await approve(claim.id))).toBe(true);
      const events = await db.select().from(schema.auditEvents);
      const types = events.map((e) => e.eventType);
      expect(types).toEqual(
        expect.arrayContaining([
          'MANUAL_PAYMENT_CLAIM_SUBMITTED',
          'MANUAL_PAYMENT_CLAIM_APPROVED',
          'INVOICE_PAYMENT_RECORDED',
          'PAYMENT_RECEIPT_ISSUED',
        ]),
      );
      const all = JSON.stringify(events);
      for (const secret of ['PRIVATE-REF-55512', 'PRIVATE-NOTE', 'PRIVATE-FILE-CONTENT']) {
        expect(all).not.toContain(secret);
      }
      const submitted = events.find((e) => e.eventType === 'MANUAL_PAYMENT_CLAIM_SUBMITTED');
      expect(submitted?.metadata).toMatchObject({ hasProofFile: true, amountMinorUnits: 40000 });
    });
  });

  describe('the proof of payment file', () => {
    const readerOf = (accountId: string, organizationId = org.organizationId) => ({
      actorAccountId: accountId,
      organizationId,
    });

    it('is stored after the safety check, in its own billing files, and read back only by the agency owners and admins and platform staff', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-F-1');
      const file = pdf('proof-bytes');
      const claim = await waitingClaim(invoiceId, { proofFile: file });
      expect(claim.hasProofFile).toBe(true);
      // Kept in the clean bucket under a billing key; the quarantined copy is gone.
      const keys = [...storage.objects.entries()];
      expect(keys).toHaveLength(1);
      expect(keys[0]?.[0]).toMatch(/^billing-receipt-[0-9a-f-]{36}$/);
      expect(keys[0]?.[1].bucket).toBe('CLEAN');

      for (const accountId of [org.ownerAccountId, org.adminAccountId]) {
        const read = await readClaimProofFile(db, storage, {
          ...readerOf(accountId),
          claimId: claim.id,
        });
        expect(isOk(read) && Buffer.from(read.value.bytes).equals(Buffer.from(file.bytes))).toBe(
          true,
        );
        expect(isOk(read) && read.value.contentType).toBe('application/pdf');
      }
      const platformRead = await readClaimProofFile(db, storage, {
        ...readerOf(platform.accountId),
        actorEmail: platform.email,
        claimId: claim.id,
      });
      expect(isOk(platformRead)).toBe(true);
      // An ordinary member and another agency's owner are refused. Another agency's admin
      // naming this claim under their own agency finds nothing.
      for (const accountId of [org.memberAccountId, other.ownerAccountId]) {
        const refused = await readClaimProofFile(db, storage, {
          ...readerOf(accountId),
          claimId: claim.id,
        });
        expect(isErr(refused) && refused.error.code, accountId).toBe('forbidden');
      }
      const crossed = await readClaimProofFile(db, storage, {
        ...readerOf(other.ownerAccountId, other.organizationId),
        claimId: claim.id,
      });
      expect(isErr(crossed) && crossed.error.code).toBe('not_found');
    });

    it('never belongs to a traveller record: the billing tables have no traveller or case column', async () => {
      const result = (await db.execute(
        sql`select table_name, column_name from information_schema.columns
            where table_name in ('billing_receipts', 'manual_payment_claims', 'payment_receipts', 'payment_receipt_counters')`,
      )) as unknown as { rows: { table_name: string; column_name: string }[] };
      const names = result.rows;
      expect(names.length).toBeGreaterThan(20);
      for (const { column_name } of names) {
        expect(column_name).not.toMatch(/applicant|mission|document|person|traveller/);
      }
      // The only table that points at the stored bytes is the billing file table.
      const invoiceId = await openInvoice(org.organizationId, 'INV-F-ISOLATED');
      await waitingClaim(invoiceId, { proofFile: pdf() });
      const object = (await db.select().from(schema.storageObjects))[0];
      const holders = await db.select().from(schema.billingReceipts);
      expect(holders.map((h) => h.storageObjectId)).toEqual([object?.id]);
      const photos = await db.select().from(schema.applicantPhotos);
      expect(photos).toHaveLength(0);
    });

    it('refuses a file that fails the safety check and stores nothing', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-F-UNSAFE');
      const bad = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, UNSAFE_MARKER, 2, 3]);
      const result = await submit(invoiceId, {
        proofFile: { contentType: 'image/jpeg', bytes: bad },
      });
      expect(isErr(result) && result.error.message).toMatch(/safety check/);
      expect(storage.objects.size).toBe(0);
      expect(await db.select().from(schema.storageObjects)).toHaveLength(0);
      expect(await db.select().from(schema.manualPaymentClaims)).toHaveLength(0);
    });

    it('refuses the wrong kind of file, an empty file and a file over 4 MB before storing anything', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-F-KIND');
      const attempt = async (proofFile: { contentType: string; bytes: Uint8Array }) => {
        const result = await submit(invoiceId, { proofFile });
        return isErr(result) ? result.error.message : 'accepted';
      };
      expect(await attempt({ contentType: 'text/html', bytes: pdf().bytes })).toMatch(
        /PDF, JPEG or PNG/,
      );
      expect(await attempt({ contentType: 'application/pdf', bytes: new Uint8Array() })).toMatch(
        /smaller than 4 MB/,
      );
      const big = new Uint8Array(PROOF_FILE_MAX_BYTES + 1);
      big.set(pdf().bytes);
      expect(await attempt({ contentType: 'application/pdf', bytes: big })).toMatch(
        /smaller than 4 MB/,
      );
      // Says PDF, is not.
      expect(
        await attempt({
          contentType: 'application/pdf',
          bytes: new Uint8Array([1, 2, 3, 4, 5, 6]),
        }),
      ).toMatch(/not the kind of file/);
      expect(storage.objects.size).toBe(0);
    });

    it('asks for a photo when a PDF cannot be cleared by the scanner, and says nothing else was stored', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-F-PDF');
      const rejectsPdf: MalwareScannerPort = {
        name: 'structural',
        version: '1',
        async scan(input) {
          const object = await storage.getObject(input.objectKey);
          return { safe: object?.contentType !== 'application/pdf' };
        },
      };
      const result = await submitManualPaymentClaim(
        db,
        { storage, scanner: rejectsPdf, images: fakeImages },
        claimInput(invoiceId, { proofFile: pdf() }),
      );
      expect(isErr(result) && result.error.message).toMatch(/Attach a photo or screenshot/);
      expect(storage.objects.size).toBe(0);
      // A photo passes the same scanner.
      const png = {
        contentType: 'image/png',
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
      };
      const photo = await submitManualPaymentClaim(
        db,
        { storage, scanner: rejectsPdf, images: fakeImages },
        claimInput(invoiceId, { proofFile: png }),
      );
      expect(isOk(photo) && photo.value.hasProofFile).toBe(true);
    });

    it('keeps a photo proof only as its server re-encoded copy, never the uploaded bytes (S27)', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-F-REENCODE');
      const uploaded = {
        contentType: 'image/png',
        bytes: new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 0x3c, 0x3f,
        ]),
      };
      const claim = await waitingClaim(invoiceId, { proofFile: uploaded });
      const read = await readClaimProofFile(db, storage, {
        actorAccountId: org.ownerAccountId,
        organizationId: org.organizationId,
        claimId: claim.id,
      });
      expect(isOk(read) && Buffer.from(read.value.bytes).equals(Buffer.from(REENCODED_PNG))).toBe(
        true,
      );
      const [object] = [...storage.objects.values()];
      expect(object && Buffer.from(object.bytes).equals(Buffer.from(uploaded.bytes))).toBe(false);
    });

    it('refuses a photo proof that cannot be re-encoded, and stores nothing', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-F-UNREADABLE');
      const unreadable: ImageSanitizerPort = {
        ...fakeImages,
        async sanitize() {
          throw new Error('broken image');
        },
      };
      const notAnImage: ImageSanitizerPort = {
        ...fakeImages,
        async sanitize() {
          return { bytes: new Uint8Array([1, 2]), contentType: 'image/png', width: 1, height: 1 };
        },
      };
      for (const images of [unreadable, notAnImage]) {
        const result = await submitManualPaymentClaim(
          db,
          { storage, scanner: fakeScanner(storage), images },
          claimInput(invoiceId, {
            proofFile: {
              contentType: 'image/jpeg',
              bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4]),
            },
          }),
        );
        expect(isErr(result) && result.error.message).toMatch(/could not be read/);
      }
      expect(storage.objects.size).toBe(0);
    });

    it('says plainly when a photo proof is too large after cleaning, and stores nothing', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-F-TOOLARGE');
      const tooLarge: ImageSanitizerPort = {
        ...fakeImages,
        async sanitize() {
          throw Object.assign(new Error('too large'), { code: IMAGE_TOO_LARGE_CODE });
        },
      };
      const result = await submitManualPaymentClaim(
        db,
        { storage, scanner: fakeScanner(storage), images: tooLarge },
        claimInput(invoiceId, {
          proofFile: {
            contentType: 'image/png',
            bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
          },
        }),
      );
      expect(isErr(result) && result.error.message).toMatch(/too large after cleaning/);
      expect(storage.objects.size).toBe(0);
    });

    it('takes a report without a file when storage is not set up, and refuses only the file', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-F-NOPORTS');
      const withFile = await submitManualPaymentClaim(
        db,
        null,
        claimInput(invoiceId, { proofFile: pdf() }),
      );
      expect(isErr(withFile) && withFile.error.code).toBe('upstream_error');
      expect(await db.select().from(schema.manualPaymentClaims)).toHaveLength(0);
      const without = await submitManualPaymentClaim(db, null, claimInput(invoiceId));
      expect(isOk(without)).toBe(true);
    });

    it('records every read of a proof file, by the agency or by staff, and serves nothing it cannot record', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-F-AUDIT');
      const claim = await waitingClaim(invoiceId, { proofFile: pdf() });
      expect(
        isOk(
          await readClaimProofFile(db, storage, {
            ...readerOf(org.adminAccountId),
            claimId: claim.id,
          }),
        ),
      ).toBe(true);
      expect(
        isOk(
          await readClaimProofFile(db, storage, {
            ...readerOf(platform.accountId),
            actorEmail: platform.email,
            claimId: claim.id,
          }),
        ),
      ).toBe(true);
      const refused = await readClaimProofFile(db, storage, {
        ...readerOf(org.memberAccountId),
        claimId: claim.id,
      });
      expect(isErr(refused)).toBe(true);
      const events = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'BILLING_PROOF_VIEWED'));
      expect(events.map((e) => (e.metadata as { viewer: string }).viewer).sort()).toEqual([
        'member',
        'platform',
      ]);
      expect(events[0]?.resourceId).toBe(claim.id);
    });

    it('is not removed by the orphan sweep when its bytes have gone missing', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-F-SWEEP');
      const claim = await waitingClaim(invoiceId, { proofFile: pdf() });
      storage.objects.clear();
      const report = await reconcileOrphans(db, storage, {
        actorAccountId: platform.accountId,
        bucket: 'CLEAN',
        dryRun: false,
      });
      expect(report.dbReferencesWithoutBlob).toHaveLength(1);
      expect(report.cleaned).toBe(0);
      expect(await db.select().from(schema.storageObjects)).toHaveLength(1);
      expect(await db.select().from(schema.billingReceipts)).toHaveLength(1);
      void claim;
    });

    it('removes the stored file when the report is refused after the file was stored', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-F-ORPHAN');
      await waitingClaim(invoiceId);
      expect(storage.objects.size).toBe(0);
      const refused = await submit(invoiceId, { proofFile: pdf() });
      expect(isErr(refused) && refused.error.message).toMatch(/already waiting/);
      expect(storage.objects.size).toBe(0);
      expect(await db.select().from(schema.storageObjects)).toHaveLength(0);
      expect(await db.select().from(schema.billingReceipts)).toHaveLength(0);
    });

    it('refuses a file whose stored bytes no longer match what was scanned', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-F-TAMPER');
      const claim = await waitingClaim(invoiceId, { proofFile: pdf() });
      const [key] = [...storage.objects.keys()];
      const stored = key ? storage.objects.get(key) : undefined;
      if (!key || !stored) throw new Error('stored');
      storage.objects.set(key, {
        ...stored,
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 9]),
      });
      const read = await readClaimProofFile(db, storage, {
        actorAccountId: org.ownerAccountId,
        organizationId: org.organizationId,
        claimId: claim.id,
      });
      expect(isErr(read) && read.error.code).toBe('not_found');
    });
  });

  describe('the Invoices page data', () => {
    it('shows the agency its own invoices only, with their states, attempts, reports and receipts', async () => {
      const mine = await openInvoice(org.organizationId, 'INV-P-MINE', 100000);
      const theirs = await openInvoice(other.organizationId, 'INV-P-THEIRS', 100000);
      const claim = await waitingClaim(mine, { amountMinorUnits: 100000 });
      expect(isOk(await approve(claim.id))).toBe(true);
      await openInvoice(org.organizationId, 'INV-P-OPEN', 5000);
      void theirs;

      const listed = await listAgencyInvoices(db, {
        actorAccountId: org.adminAccountId,
        organizationId: org.organizationId,
      });
      expect(isOk(listed)).toBe(true);
      if (!isOk(listed)) return;
      expect(listed.value.map((i) => i.invoiceRef).sort()).toEqual(['INV-P-MINE', 'INV-P-OPEN']);
      const paid = listed.value.find((i) => i.invoiceRef === 'INV-P-MINE');
      expect(paid).toMatchObject({ state: 'PAID', outstandingMinorUnits: 0, currency: 'BDT' });
      expect(paid?.receipts.map((r) => r.number)).toEqual(['R-000001']);
      expect(paid?.claims.map((c) => c.status)).toEqual(['APPROVED']);
      expect(listed.value.find((i) => i.invoiceRef === 'INV-P-OPEN')?.state).toBe('OPEN');
      // Platform staff may read any agency's list; the other agency's owner may not read this one.
      const staff = await listAgencyInvoices(db, {
        actorAccountId: platform.accountId,
        actorEmail: platform.email,
        organizationId: org.organizationId,
      });
      expect(isOk(staff)).toBe(true);
      const crossed = await listAgencyInvoices(db, {
        actorAccountId: other.ownerAccountId,
        organizationId: org.organizationId,
      });
      expect(isErr(crossed) && crossed.error.code).toBe('forbidden');
    });

    it('shows a started online payment as Payment Started and a held one as Needs a Check, without gateway identifiers for the agency', async () => {
      const invoiceId = await openInvoice(org.organizationId, 'INV-P-ATTEMPTS', 100000);
      const port = new FakePaymentPort();
      const started = await startOnlinePayment(db, onePort(port), {
        actorAccountId: org.ownerAccountId,
        invoiceId,
        urlFor: (kind, tran) => `https://app.example.test/pay/${kind}?t=${tran}`,
      });
      expect(isOk(started)).toBe(true);
      const view = async () => {
        const listed = await listAgencyInvoices(db, {
          actorAccountId: org.ownerAccountId,
          organizationId: org.organizationId,
        });
        if (!isOk(listed)) throw new Error('list');
        const invoice = listed.value[0];
        if (!invoice) throw new Error('invoice');
        return invoice;
      };
      const open = await view();
      expect(open.state).toBe('PAYMENT_STARTED');
      expect(open.recentAttemptStartedAt).not.toBeNull();
      expect(open.attempts[0]).toMatchObject({
        status: 'REDIRECTED',
        merchantTranId: null,
        reasonCode: null,
      });

      await db
        .update(schema.paymentAttempts)
        .set({ status: 'HELD_FOR_REVIEW', reasonCode: 'already_paid' })
        .where(eq(schema.paymentAttempts.invoiceId, invoiceId));
      const held = await view();
      expect(held.state).toBe('NEEDS_CHECK');
      expect(held.attempts[0]?.reasonCode).toBeNull();
    });
  });
});
