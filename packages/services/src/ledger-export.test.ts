import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite, migrationsFolder } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selfPrincipal, staffPrincipal } from './access/principal';
import { provisionAccount } from './accounts';
import { createInvoice, openBillingAccount, recordInvoicePayment } from './billing';
import { agencyCode } from './billing-standing';
import type { Db } from './db';
import { LEDGER_CSV_COLUMNS, exportLedgerMonth } from './ledger-export';
import { createOrganization, reviewOrganization } from './organizations';
import { settlePaymentAttempt, startPersonPayment } from './payments';
import { FakePaymentPort, onePort } from './payments.test-support';
import { referenceCode, startPersonCheckout } from './person-billing';
import { personPaymentAttempts } from './person-billing-tables';
import { grantPlatformRole } from './platform-roles';

/**
 * ADR 0025 T6: the Monthly Accounting File holds a person's own payments and refunds (PERSON and
 * their reference code, nothing that names them), keeps every agency row as it was with two
 * columns added at the end, leaves test payments out, and still works before migration 0110.
 */

const TIMEOUT = 60_000;
const PRICE = 49_900;
const urlFor = (kind: string, tran: string) => `https://app.example.test/pay/${kind}?t=${tran}`;
// Distinctive, so any trace of the person in the file is found.
const PERSON_EMAIL = 'zubaida.quasem.ledger@person-mail.example.org';
const PERSON_LOCAL_PART = 'zubaida.quasem.ledger';
const PERSON_DISPLAY_NAME = 'Zubaida Quasem Ledgerton';

const thisMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7);

/** The cells of one CSV line this module wrote (every cell quoted, none holding `","`). */
const cellsOf = (line: string) => line.slice(1, -1).split('","');

function linesOf(csv: string): string[][] {
  return csv
    .slice(1)
    .split('\r\n')
    .filter((line) => line.length > 0)
    .map(cellsOf);
}

async function account(db: Db, email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!isOk(made)) throw new Error('provision');
  return made.value.id;
}

/** The platform owner, who alone may download the file. */
async function platformOwner(db: Db, tag: string) {
  const email = `owner-${tag}@platform.example.com`;
  const accountId = await account(db, email);
  const granted = await grantPlatformRole(db, {
    actor: { accountId, email, bootstrapEmails: [email] },
    targetAccountId: accountId,
    role: 'PLATFORM_OWNER',
    reason: 'seed',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
  const actor = { accountId, email, bootstrapEmails: [] as string[] };
  const scope = await staffPrincipal(db, actor, 'BILLING_LEDGER_EXPORT');
  if (!isOk(scope)) throw new Error('scope');
  return { actor, exportScope: scope.value };
}

/** An agency with an invoice paid by hand: one IN row, as S18 always exported. */
async function agencyPaidByHand(
  db: Db,
  actor: { accountId: string; email: string; bootstrapEmails: string[] },
  tag: string,
) {
  const orgOwner = await account(db, `agency-owner-${tag}@acme.example.com`);
  const org = await createOrganization(db, { actorAccountId: orgOwner, name: 'Acme Ledger' });
  if (!isOk(org)) throw new Error('org');
  const reviewer = await account(db, `reviewer-${tag}@platform.example.com`);
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
  const [plan] = await db
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(eq(schema.plans.key, 'agency_pro'));
  if (!plan) throw new Error('plan');
  const opened = await openBillingAccount(db, {
    actor,
    stepUpSatisfied: true,
    organizationId: org.value.id,
    initialStatus: 'ACTIVE',
    reason: 'terms agreed',
  });
  if (!isOk(opened)) throw new Error('billing account');
  const start = new Date(Date.UTC(2020, 0, 1));
  const invoice = await createInvoice(db, {
    actor,
    stepUpSatisfied: true,
    organizationId: org.value.id,
    planId: plan.id,
    periodStart: start,
    periodEnd: new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000),
    invoiceRef: `INV-LEDGER-${tag}`,
    invoicedAmountMinorUnits: 150_000,
    currency: 'BDT',
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  });
  if (!isOk(invoice)) throw new Error(`invoice: ${invoice.error.message}`);
  const recorded = await recordInvoicePayment(db, {
    actor,
    stepUpSatisfied: true,
    invoiceId: invoice.value.id,
    amountMinorUnits: 150_000,
    collectedDate: new Date(),
    paymentReference: 'BANK-LEDGER-1',
    reason: 'transfer seen',
    idempotencyKey: randomUUID(),
  });
  if (!isOk(recorded)) throw new Error(`pay: ${recorded.error.message}`);
  const [entry] = await db
    .select()
    .from(schema.invoicePayments)
    .where(eq(schema.invoicePayments.invoiceId, invoice.value.id));
  if (!entry) throw new Error('entry');
  return { organizationId: org.value.id, entry };
}

async function travellerPlan(db: Db): Promise<string> {
  const [plan] = await db
    .insert(schema.plans)
    .values({
      key: 'traveller_plus_ledger',
      name: 'Traveller Plus',
      audience: 'TRAVELLER',
      periodDays: 30,
    })
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

/** A person's own invoice, bought through the real checkout and paid online (one IN row). */
async function personPaidOnline(
  db: Db,
  port: FakePaymentPort,
  accountId: string,
  planId: string,
  actorEmail?: string,
) {
  const made = await startPersonCheckout(db, selfPrincipal(accountId), { planId });
  if (!isOk(made)) throw new Error(`checkout: ${made.error.message}`);
  const started = await startPersonPayment(db, onePort(port), selfPrincipal(accountId), {
    invoiceId: made.value.invoiceId,
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
  return made.value;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the Monthly Accounting File with a person's own invoices (ADR 0025 T6)", () => {
  it(
    'holds person IN and OUT rows as PERSON with the reference code, agency rows as before, and leaves test rows out',
    async () => {
      vi.stubEnv('TRAVELLER_PLANS_ENABLED', 'true');
      const db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
      const { actor, exportScope } = await platformOwner(db, 'person');
      const agency = await agencyPaidByHand(db, actor, 'person');

      const person = await account(db, PERSON_EMAIL);
      await db
        .insert(schema.applicants)
        .values({ ownerAccountId: person, displayName: PERSON_DISPLAY_NAME });
      const planId = await travellerPlan(db);
      const port = new FakePaymentPort();
      const bought = await personPaidOnline(db, port, person, planId);
      // A confirmed refund of it, in the ledger as the refund services record it.
      await db.insert(schema.invoicePayments).values({
        invoiceId: bought.invoiceId,
        amountMinorUnits: -PRICE,
        currency: 'BDT',
        kind: 'REFUND',
        sourceId: randomUUID(),
        reference: 'RF-PERSON-LEDGER',
        collectedDate: new Date(),
        mode: 'LIVE',
      });
      // A test payment of a person's own plan (in test mode only the platform owner can pay, so
      // the owner buys one for themself): never money, never in the file.
      port.mode = 'TEST';
      const tested = await personPaidOnline(db, port, actor.accountId, planId, actor.email);

      const exported = await exportLedgerMonth(db, exportScope, {
        month: thisMonth(),
        stepUpSatisfied: true,
      });
      if (!isOk(exported)) throw new Error(exported.error.message);
      const { csv } = exported.value;
      const [header, ...rows] = linesOf(csv);
      expect(header).toEqual([...LEDGER_CSV_COLUMNS]);
      // The two new columns are at the end, after the 15 an accountant's sheet already reads.
      expect(LEDGER_CSV_COLUMNS.slice(-2)).toEqual(['payer_type', 'payer_code']);
      expect(LEDGER_CSV_COLUMNS.indexOf('recorded_by')).toBe(14);
      expect(exported.value.rowCount).toBe(3);
      expect(exported.value.testRowsLeftOut).toBe(1);
      expect(csv).not.toContain(tested.invoiceRef);
      expect(csv).not.toContain(referenceCode(actor.accountId));

      const column = (name: (typeof LEDGER_CSV_COLUMNS)[number]) =>
        LEDGER_CSV_COLUMNS.indexOf(name);
      const code = referenceCode(person);
      expect(code).toMatch(/^[0-9A-F]{8}$/);
      const personRows = rows.filter((cells) => cells[column('payer_type')] === 'PERSON');
      expect(personRows.map((cells) => cells[column('direction')])).toEqual(['IN', 'OUT']);
      for (const cells of personRows) {
        expect(cells[column('payer_code')]).toBe(code);
        expect(cells[column('invoice_ref')]).toBe(bought.invoiceRef);
        expect(cells[column('agency_code')]).toBe('');
        expect(cells[column('agency_name')]).toBe('');
        expect(cells[column('amount')]).toBe('499.00');
      }
      expect(personRows[1]?.[column('kind')]).toBe('REFUND');
      expect(personRows[1]?.[column('reference')]).toBe('RF-PERSON-LEDGER');

      // The agency row: the 15 cells S18 wrote, unchanged, then AGENCY and the agency's code.
      const agencyRows = rows.filter((cells) => cells[column('payer_type')] === 'AGENCY');
      expect(agencyRows).toHaveLength(1);
      const code8 = agencyCode(agency.organizationId);
      expect(agencyRows[0]?.slice(0, 15)).toEqual([
        agency.entry.id,
        expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        'INV-LEDGER-person',
        code8,
        'Acme Ledger',
        agency.entry.kind,
        'IN',
        '1500.00',
        'BDT',
        agency.entry.provider ?? '',
        agency.entry.providerTransactionId ?? '',
        agency.entry.reference,
        '',
        'staff',
      ]);
      expect(agencyRows[0]?.slice(15)).toEqual(['AGENCY', code8]);
    },
    TIMEOUT,
  );

  it(
    'never names the person: no email, no part of it, no display name, no full account id',
    async () => {
      vi.stubEnv('TRAVELLER_PLANS_ENABLED', 'true');
      const db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
      const { exportScope } = await platformOwner(db, 'pii');
      const person = await account(db, PERSON_EMAIL);
      await db
        .insert(schema.applicants)
        .values({ ownerAccountId: person, displayName: PERSON_DISPLAY_NAME });
      const planId = await travellerPlan(db);
      await personPaidOnline(db, new FakePaymentPort(), person, planId);

      const exported = await exportLedgerMonth(db, exportScope, {
        month: thisMonth(),
        stepUpSatisfied: true,
      });
      if (!isOk(exported)) throw new Error(exported.error.message);
      const text = exported.value.csv.toLowerCase();
      expect(exported.value.rowCount).toBe(1);
      expect(text).toContain(`"person","${referenceCode(person).toLowerCase()}"`);
      for (const secret of [
        PERSON_EMAIL,
        PERSON_LOCAL_PART,
        'person-mail.example.org',
        PERSON_DISPLAY_NAME,
        'zubaida',
        'quasem',
        person,
        person.replace(/-/g, ''),
      ]) {
        expect(text, secret).not.toContain(secret.toLowerCase());
      }
    },
    TIMEOUT,
  );
});

describe('before migration 0110 (ADR 0025 rollout)', () => {
  it(
    'exports the agency rows with the S18 read, adding AGENCY and the agency code at the end',
    async () => {
      const journal = JSON.parse(
        readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
      ) as { entries: { tag: string }[] };
      const at = journal.entries.findIndex((e) => e.tag === '0110_paid_traveller_plans');
      expect(at).toBeGreaterThan(0);
      const prior = journal.entries.slice(0, at);
      const folder = mkdtempSync(join(tmpdir(), 'visastack-before-0110-'));
      mkdirSync(join(folder, 'meta'), { recursive: true });
      writeFileSync(
        join(folder, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: prior }),
      );
      for (const entry of prior) {
        copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
      }
      const client = new PGlite();
      try {
        await migrate(drizzle(client), { migrationsFolder: folder });
        const db = drizzle(client, { schema }) as unknown as Db;
        const { actor, exportScope } = await platformOwner(db, 'before');
        const agency = await agencyPaidByHand(db, actor, 'before');
        const exported = await exportLedgerMonth(db, exportScope, {
          month: thisMonth(),
          stepUpSatisfied: true,
        });
        if (!isOk(exported)) throw new Error(exported.error.message);
        const [header, row, ...rest] = linesOf(exported.value.csv);
        expect(header).toEqual([...LEDGER_CSV_COLUMNS]);
        expect(rest).toEqual([]);
        expect(row?.[0]).toBe(agency.entry.id);
        expect(row?.slice(4, 6)).toEqual([agencyCode(agency.organizationId), 'Acme Ledger']);
        expect(row?.slice(15)).toEqual(['AGENCY', agencyCode(agency.organizationId)]);
      } finally {
        await client.close();
      }
    },
    TIMEOUT,
  );
});
