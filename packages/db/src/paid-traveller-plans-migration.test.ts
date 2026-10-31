import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

const MIGRATION_TIMEOUT_MS = 180_000;
const FILE = '0110_paid_traveller_plans';

function statements(): string[] {
  return readFileSync(join(migrationsFolder, `${FILE}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .filter((statement) => statement.replace(/--[^\n]*/g, '').trim().length > 0);
}

/** A copy of the migrations folder holding every migration before 0110: the database as production has it today. */
function folderBefore(): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  const at = journal.entries.findIndex((e: { tag: string }) => e.tag === FILE);
  if (at === -1) throw new Error(`${FILE} is not in the journal`);
  const prior = journal.entries.slice(0, at) as { tag: string }[];
  const folder = mkdtempSync(join(tmpdir(), 'visastack-0110-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: prior }));
  for (const entry of prior) {
    copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

async function one(client: PGlite, text: string): Promise<string> {
  const id = (await client.query<{ id: string }>(text)).rows[0]?.id;
  if (!id) throw new Error(`no row from: ${text}`);
  return id;
}

/** An agency's billing as it exists today: a subscription, a paid invoice, an online attempt, a ledger row and its receipt. */
async function seedAgency(client: PGlite) {
  const admin = await one(
    client,
    `insert into accounts (email) values ('admin-${Math.random()}@example.test') returning id`,
  );
  const org = await one(
    client,
    `insert into organizations (name, status) values ('Synthetic Agency', 'ACTIVE') returning id`,
  );
  const plan = await one(client, `select id from plans where key = 'agency_starter'`);
  const subscription = await one(
    client,
    `insert into subscriptions (organization_id, plan_id, assigned_by_account_id, reason)
     values ('${org}', '${plan}', '${admin}', 'Synthetic') returning id`,
  );
  const invoice = await one(
    client,
    `insert into invoices (organization_id, plan_id, period_start, period_end, invoice_ref, invoiced_amount_minor_units, collected_amount_minor_units, currency, due_date, status)
     values ('${org}', '${plan}', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'INV-T1-A', 5000, 5000, 'BDT', '2026-11-08T00:00:00Z', 'PAID') returning id`,
  );
  const attempt = await one(
    client,
    `insert into payment_attempts (invoice_id, organization_id, provider, merchant_tran_id, amount_minor_units, currency, status, mode)
     values ('${invoice}', '${org}', 'sslcommerz', 'VSP${'b'.repeat(26)}', 5000, 'BDT', 'VALIDATED', 'TEST') returning id`,
  );
  const entry = await one(
    client,
    `insert into invoice_payments (invoice_id, amount_minor_units, currency, kind, reference, collected_date, recorded_by_account_id, mode)
     values ('${invoice}', 5000, 'BDT', 'ADMIN_RECORDED', 'BANK-T1', now(), '${admin}', 'LIVE') returning id`,
  );
  const receipt = await one(
    client,
    `insert into payment_receipts (organization_id, invoice_id, invoice_payment_id, receipt_number, amount_minor_units, currency)
     values ('${org}', '${invoice}', '${entry}', 1, 5000, 'BDT') returning id`,
  );
  return { admin, org, plan, subscription, invoice, attempt, entry, receipt };
}

describe('migration 0110: the payer is an organization or a person (ADR 0025, T1)', () => {
  it('names no number of its own, so renumbering is a rename only', () => {
    expect(readFileSync(join(migrationsFolder, `${FILE}.sql`), 'utf8')).not.toMatch(/\b0110\b/);
  });

  it(
    'runs twice on the database as it is today, keeps every agency row, and today’s writes still work',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder: folderBefore() });
      const agency = await seedAgency(client);

      // The runbook's pre-checks: every existing row is an organization's.
      for (const table of [
        'subscriptions',
        'invoices',
        'payment_attempts',
        'refund_requests',
        'payment_receipts',
      ]) {
        const n = await client.query<{ n: number }>(
          `select count(*)::int as n from ${table} where organization_id is null`,
        );
        expect(n.rows[0]?.n, table).toBe(0);
      }

      // Statement by statement, twice: the second run changes nothing and raises nothing.
      for (let run = 0; run < 2; run++) {
        for (const statement of statements()) await client.exec(statement);
      }

      // Every agency row is kept as it was, with no person and the default renewal.
      const sub = await client.query<{
        organization_id: string;
        payer_account_id: string | null;
        renews: boolean;
      }>(
        `select organization_id, payer_account_id, renews from subscriptions where id = '${agency.subscription}'`,
      );
      expect(sub.rows[0]).toEqual({
        organization_id: agency.org,
        payer_account_id: null,
        renews: true,
      });
      for (const [table, id] of [
        ['invoices', agency.invoice],
        ['payment_attempts', agency.attempt],
        ['payment_receipts', agency.receipt],
      ] as const) {
        const row = await client.query<{
          organization_id: string;
          payer_account_id: string | null;
        }>(`select organization_id, payer_account_id from ${table} where id = '${id}'`);
        expect(row.rows[0], table).toEqual({ organization_id: agency.org, payer_account_id: null });
      }

      // Today's code writes only the old columns: those writes still work unchanged.
      await client.query(
        `insert into invoices (organization_id, plan_id, period_start, period_end, invoice_ref, invoiced_amount_minor_units, currency, due_date)
         values ('${agency.org}', '${agency.plan}', '2026-12-01T00:00:00Z', '2027-01-01T00:00:00Z', 'INV-T1-B', 5000, 'BDT', '2026-12-08T00:00:00Z')`,
      );
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'takes a person as the payer, and refuses a row with both payers or none',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder });
      const agency = await seedAgency(client);
      const person = await one(
        client,
        `insert into accounts (email) values ('traveller-${Math.random()}@example.test') returning id`,
      );
      const plan = await one(client, `select id from plans where key = 'traveller_free'`);

      // Subscriptions: a person's own, renewal off, assigned by themselves.
      const subscription = (fields: string, values: string) =>
        client.query<{ id: string }>(
          `insert into subscriptions (plan_id, reason, ${fields}) values ('${plan}', 'Synthetic', ${values}) returning id`,
        );
      const personal = (
        await subscription(
          'payer_account_id, assigned_by_account_id, renews',
          `'${person}', '${person}', false`,
        )
      ).rows[0]?.id;
      expect(personal).toBeTruthy();
      await expect(
        subscription('organization_id, payer_account_id', `'${agency.org}', '${person}'`),
      ).rejects.toThrow(/subscriptions_one_payer/);
      await expect(subscription('assigned_by_account_id', `'${person}'`)).rejects.toThrow(
        /subscriptions_one_payer/,
      );
      // One current subscription per person.
      await expect(subscription('payer_account_id', `'${person}'`)).rejects.toThrow(
        /subscriptions_one_current_per_person/,
      );

      // Invoices: a person's, tied to the subscription; one live invoice per person, plan and period.
      const personInvoice = (
        await client.query<{ id: string }>(
          `insert into invoices (payer_account_id, subscription_id, plan_id, period_start, period_end, invoice_ref, invoiced_amount_minor_units, currency, due_date)
           values ('${person}', '${personal}', '${plan}', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'INV-P-1', 49900, 'BDT', '2026-11-01T00:00:00Z') returning id`,
        )
      ).rows[0]?.id;
      expect(personInvoice).toBeTruthy();
      await expect(
        client.query(
          `insert into invoices (payer_account_id, plan_id, period_start, period_end, invoice_ref, invoiced_amount_minor_units, currency, due_date)
           values ('${person}', '${plan}', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'INV-P-2', 49900, 'BDT', '2026-11-01T00:00:00Z')`,
        ),
      ).rejects.toThrow(/invoices_person_plan_period_unique/);
      await expect(
        client.query(
          `insert into invoices (organization_id, payer_account_id, plan_id, period_start, period_end, invoice_ref, invoiced_amount_minor_units, currency, due_date)
           values ('${agency.org}', '${person}', '${plan}', '2027-01-01T00:00:00Z', '2027-02-01T00:00:00Z', 'INV-P-3', 49900, 'BDT', '2027-01-01T00:00:00Z')`,
        ),
      ).rejects.toThrow(/invoices_one_payer/);
      await expect(
        client.query(
          `insert into invoices (plan_id, period_start, period_end, invoice_ref, invoiced_amount_minor_units, currency, due_date)
           values ('${plan}', '2027-01-01T00:00:00Z', '2027-02-01T00:00:00Z', 'INV-P-4', 49900, 'BDT', '2027-01-01T00:00:00Z')`,
        ),
      ).rejects.toThrow(/invoices_one_payer/);

      // Attempts, refunds and receipts: one payer each.
      await client.query(
        `insert into payment_attempts (invoice_id, payer_account_id, provider, merchant_tran_id, amount_minor_units, currency, status, mode)
         values ('${personInvoice}', '${person}', 'sslcommerz', 'VSP${'c'.repeat(26)}', 49900, 'BDT', 'CREATED', 'TEST')`,
      );
      await expect(
        client.query(
          `insert into payment_attempts (invoice_id, provider, merchant_tran_id, amount_minor_units, currency, status, mode)
           values ('${personInvoice}', 'sslcommerz', 'VSP${'d'.repeat(26)}', 49900, 'BDT', 'CREATED', 'TEST')`,
        ),
      ).rejects.toThrow(/payment_attempts_one_payer/);
      const entry = await one(
        client,
        `insert into invoice_payments (invoice_id, amount_minor_units, currency, kind, reference, collected_date, recorded_by_account_id, mode)
         values ('${personInvoice}', 49900, 'BDT', 'ADMIN_RECORDED', 'TEST-P', now(), '${person}', 'LIVE') returning id`,
      );
      await client.query(
        `insert into payment_receipts (payer_account_id, invoice_id, invoice_payment_id, receipt_number, amount_minor_units, currency)
         values ('${person}', '${personInvoice}', '${entry}', 1, 49900, 'BDT')`,
      );
      // A person's receipt numbers are their own: an agency's receipt 1 does not clash.
      const counters = await client.query<{ present: boolean }>(
        `select to_regclass('person_receipt_counters') is not null as present`,
      );
      expect(counters.rows[0]?.present).toBe(true);
      await expect(
        client.query(
          `insert into refund_requests (invoice_id, invoice_payment_id, method, status, amount_minor_units, currency, provider, idempotency_key, reason, requested_by_account_id)
           values ('${personInvoice}', '${entry}', 'PROVIDER', 'REQUESTED', 100, 'BDT', 'sslcommerz', '${crypto.randomUUID()}', 'Synthetic', '${person}')`,
        ),
      ).rejects.toThrow(/refund_requests_one_payer/);
      await client.query(
        `insert into refund_requests (payer_account_id, invoice_id, invoice_payment_id, method, status, amount_minor_units, currency, provider, idempotency_key, reason, requested_by_account_id)
         values ('${person}', '${personInvoice}', '${entry}', 'PROVIDER', 'REQUESTED', 100, 'BDT', 'sslcommerz', '${crypto.randomUUID()}', 'Synthetic', '${person}')`,
      );
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'lets a person who bought for themselves delete their account, and keeps the money records',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder });
      const agency = await seedAgency(client);
      const person = await one(
        client,
        `insert into accounts (email) values ('leaving-${Math.random()}@example.test') returning id`,
      );
      const plan = await one(client, `select id from plans where key = 'traveller_free'`);
      await client.query(
        `insert into subscriptions (payer_account_id, assigned_by_account_id, plan_id, reason) values ('${person}', '${person}', '${plan}', 'Synthetic')`,
      );
      const invoice = await one(
        client,
        `insert into invoices (payer_account_id, plan_id, period_start, period_end, invoice_ref, invoiced_amount_minor_units, currency, due_date)
         values ('${person}', '${plan}', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'INV-P-D', 49900, 'BDT', '2026-11-01T00:00:00Z') returning id`,
      );
      // An agency subscription the person assigned (as a platform owner would) loses the name, not the row.
      await client.query(
        `update subscriptions set assigned_by_account_id = '${person}' where id = '${agency.subscription}'`,
      );

      await client.query(`delete from accounts where id = '${person}'`);

      const personal = await client.query<{ n: number }>(
        `select count(*)::int as n from subscriptions where payer_account_id = '${person}'`,
      );
      expect(personal.rows[0]?.n).toBe(0);
      const kept = await client.query<{ payer_account_id: string }>(
        `select payer_account_id from invoices where id = '${invoice}'`,
      );
      expect(kept.rows[0]?.payer_account_id).toBe(person);
      const assigned = await client.query<{ assigned_by_account_id: string | null }>(
        `select assigned_by_account_id from subscriptions where id = '${agency.subscription}'`,
      );
      expect(assigned.rows[0]?.assigned_by_account_id).toBeNull();
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'takes the two traveller storage rules, counted in total only',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder });
      const plan = await one(client, `select id from plans where key = 'traveller_free'`);
      for (const key of ['account_storage_bytes', 'person_storage_bytes']) {
        await client.query(
          `insert into plan_entitlements (plan_id, key, included, limit_value, per) values ('${plan}', '${key}', true, 1048576, 'TOTAL')`,
        );
        await expect(
          client.query(
            `update plan_entitlements set per = 'DAY' where plan_id = '${plan}' and key = '${key}'`,
          ),
        ).rejects.toThrow(/plan_entitlements_per_matches_key/);
      }
      await expect(
        client.query(
          `insert into plan_entitlements (plan_id, key, included, limit_value, per) values ('${plan}', 'people_storage', true, 1, 'TOTAL')`,
        ),
      ).rejects.toThrow(/plan_entitlements_key_shape/);
    },
    MIGRATION_TIMEOUT_MS,
  );
});
