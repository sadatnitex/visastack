import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';
import { createMigratedPglite } from './testing';

const MIGRATION_TIMEOUT_MS = 180_000;
const FILE = '0110_paid_traveller_plans';

function statements(): string[] {
  return readFileSync(join(migrationsFolder, `${FILE}.sql`), 'utf8').split(
    '--> statement-breakpoint',
  );
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

const account = (client: PGlite, label: string) =>
  one(
    client,
    `insert into accounts (email) values ('${label}-${Math.random()}@example.test') returning id`,
  );

/** An agency's billing as it exists today: a subscription, a paid invoice, an online attempt, a ledger row, its receipt and a refund request. */
async function seedAgency(client: PGlite) {
  const admin = await account(client, 'admin');
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
  const refund = await one(
    client,
    `insert into refund_requests (organization_id, invoice_id, invoice_payment_id, method, status, amount_minor_units, currency, provider, idempotency_key, reason, requested_by_account_id)
     values ('${org}', '${invoice}', '${entry}', 'PROVIDER', 'REQUESTED', 100, 'BDT', 'sslcommerz', '${crypto.randomUUID()}', 'Synthetic', '${admin}') returning id`,
  );
  return { admin, org, plan, subscription, invoice, attempt, entry, receipt, refund };
}

describe('migration 0110: the payer is an organization or a person (ADR 0025, T1)', () => {
  it('names no number of its own', () => {
    expect(readFileSync(join(migrationsFolder, `${FILE}.sql`), 'utf8')).not.toMatch(/\b0110\b/);
  });

  it(
    'runs twice on the database as it is today, keeps every agency row, and today’s writes still work',
    async () => {
      const client = new PGlite();
      const folder = folderBefore();
      try {
        await migrate(drizzle(client), { migrationsFolder: folder });
        const agency = await seedAgency(client);

        // Statement by statement, twice: the second run changes nothing and raises nothing.
        for (let run = 0; run < 2; run++) {
          for (const statement of statements()) await client.exec(statement);
        }

        // Every agency row is kept as it was, with no person and the default renewal.
        const sub = await client.query(
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
          ['refund_requests', agency.refund],
        ] as const) {
          const row = await client.query(
            `select organization_id, payer_account_id from ${table} where id = '${id}'`,
          );
          expect(row.rows[0], table).toEqual({
            organization_id: agency.org,
            payer_account_id: null,
          });
        }

        // Today's code writes only the old columns: those writes still work unchanged.
        await client.query(
          `insert into invoices (organization_id, plan_id, period_start, period_end, invoice_ref, invoiced_amount_minor_units, currency, due_date)
           values ('${agency.org}', '${agency.plan}', '2026-12-01T00:00:00Z', '2027-01-01T00:00:00Z', 'INV-T1-B', 5000, 'BDT', '2026-12-08T00:00:00Z')`,
        );
        // The assigning account stays required and still blocks its own deletion (unchanged in T1).
        await expect(
          client.query(`delete from accounts where id = '${agency.admin}'`),
        ).rejects.toThrow(/subscriptions_assigned_by_account_id/);
      } finally {
        await client.close();
        rmSync(folder, { recursive: true, force: true });
      }
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'takes a person as the payer on every billing table, and refuses both payers or none on each',
    async () => {
      const client = await createMigratedPglite();
      try {
        const agency = await seedAgency(client);
        const person = await account(client, 'traveller');
        const plan = await one(client, `select id from plans where key = 'traveller_free'`);

        // Subscriptions.
        const subscription = (columns: string, values: string) =>
          client.query<{ id: string }>(
            `insert into subscriptions (plan_id, reason, assigned_by_account_id, ${columns}) values ('${plan}', 'Synthetic', '${person}', ${values}) returning id`,
          );
        const personal = (await subscription('payer_account_id, renews', `'${person}', false`))
          .rows[0]?.id;
        expect(personal).toBeTruthy();
        await expect(
          subscription('organization_id, payer_account_id', `'${agency.org}', '${person}'`),
        ).rejects.toThrow(/subscriptions_one_payer/);
        await expect(subscription('renews', 'true')).rejects.toThrow(/subscriptions_one_payer/);
        await expect(subscription('payer_account_id', `'${person}'`)).rejects.toThrow(
          /subscriptions_one_current_per_person/,
        );

        // Invoices: a person's, tied to the subscription; one live invoice per person, plan and period.
        const invoice = (columns: string, values: string, ref: string, start = '2026-11-01') =>
          client.query<{ id: string }>(
            `insert into invoices (${columns}, plan_id, period_start, period_end, invoice_ref, invoiced_amount_minor_units, currency, due_date)
             values (${values}, '${plan}', '${start}T00:00:00Z', '${start}T00:00:00Z'::timestamptz + interval '30 days', '${ref}', 49900, 'BDT', '${start}T00:00:00Z') returning id`,
          );
        const personInvoice = (
          await invoice(
            'payer_account_id, subscription_id',
            `'${person}', '${personal}'`,
            'INV-P-1',
          )
        ).rows[0]?.id;
        expect(personInvoice).toBeTruthy();
        await expect(invoice('payer_account_id', `'${person}'`, 'INV-P-2')).rejects.toThrow(
          /invoices_person_plan_period_unique/,
        );
        await expect(
          invoice(
            'organization_id, payer_account_id',
            `'${agency.org}', '${person}'`,
            'INV-P-3',
            '2027-01-01',
          ),
        ).rejects.toThrow(/invoices_one_payer/);
        await expect(
          invoice('subscription_id', `'${personal}'`, 'INV-P-4', '2027-01-01'),
        ).rejects.toThrow(/invoices_one_payer/);

        // Online payments.
        let tran = 0;
        const attempt = (columns: string, values: string) =>
          client.query(
            `insert into payment_attempts (invoice_id, ${columns}, provider, merchant_tran_id, amount_minor_units, currency, mode)
             values ('${personInvoice}', ${values}, 'sslcommerz', 'VSP${String(++tran).padStart(26, 'c')}', 49900, 'BDT', 'TEST')`,
          );
        await attempt('payer_account_id, status', `'${person}', 'CREATED'`);
        await expect(
          attempt(
            'organization_id, payer_account_id, status',
            `'${agency.org}', '${person}', 'CREATED'`,
          ),
        ).rejects.toThrow(/payment_attempts_one_payer/);
        await expect(attempt('status', `'CREATED'`)).rejects.toThrow(/payment_attempts_one_payer/);

        // Receipts: numbered per person, apart from any agency's.
        const entry = (reference: string) =>
          one(
            client,
            `insert into invoice_payments (invoice_id, amount_minor_units, currency, kind, reference, collected_date, recorded_by_account_id, mode)
             values ('${personInvoice}', 100, 'BDT', 'ADMIN_RECORDED', '${reference}', now(), '${person}', 'LIVE') returning id`,
          );
        const receipt = async (columns: string, values: string, number: number) => {
          const ledger = await entry(`R-${Math.random()}`);
          return client.query(
            `insert into payment_receipts (${columns}invoice_id, invoice_payment_id, receipt_number, amount_minor_units, currency)
             values (${values}'${personInvoice}', '${ledger}', ${number}, 100, 'BDT')`,
          );
        };
        await receipt('payer_account_id, ', `'${person}', `, 1);
        await expect(receipt('payer_account_id, ', `'${person}', `, 1)).rejects.toThrow(
          /payment_receipts_person_number_unique/,
        );
        await expect(
          receipt('organization_id, payer_account_id, ', `'${agency.org}', '${person}', `, 2),
        ).rejects.toThrow(/payment_receipts_one_payer/);
        await expect(receipt('', '', 3)).rejects.toThrow(/payment_receipts_one_payer/);
        await expect(
          client.query(
            `insert into person_receipt_counters (account_id, last_number) values ('${person}', -1)`,
          ),
        ).rejects.toThrow(/person_receipt_counters_not_negative/);

        // Refund requests.
        const refundEntry = await entry('REF');
        const refund = (columns: string, values: string) =>
          client.query(
            `insert into refund_requests (${columns}invoice_id, invoice_payment_id, method, status, amount_minor_units, currency, provider, idempotency_key, reason, requested_by_account_id)
             values (${values}'${personInvoice}', '${refundEntry}', 'PROVIDER', 'REQUESTED', 100, 'BDT', 'sslcommerz', '${crypto.randomUUID()}', 'Synthetic', '${person}')`,
          );
        await refund('payer_account_id, ', `'${person}', `);
        await expect(
          refund('organization_id, payer_account_id, ', `'${agency.org}', '${person}', `),
        ).rejects.toThrow(/refund_requests_one_payer/);
        await expect(refund('', '')).rejects.toThrow(/refund_requests_one_payer/);
      } finally {
        await client.close();
      }
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'removes a deleted person’s subscription and keeps their money records',
    async () => {
      const client = await createMigratedPglite();
      try {
        const assigner = await account(client, 'assigner');
        const person = await account(client, 'leaving');
        const plan = await one(client, `select id from plans where key = 'traveller_free'`);
        const subscription = await one(
          client,
          `insert into subscriptions (payer_account_id, assigned_by_account_id, plan_id, reason) values ('${person}', '${assigner}', '${plan}', 'Synthetic') returning id`,
        );
        const invoice = await one(
          client,
          `insert into invoices (payer_account_id, subscription_id, plan_id, period_start, period_end, invoice_ref, invoiced_amount_minor_units, currency, due_date)
           values ('${person}', '${subscription}', '${plan}', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'INV-P-D', 49900, 'BDT', '2026-11-01T00:00:00Z') returning id`,
        );

        await client.query(`delete from accounts where id = '${person}'`);

        const left = await client.query<{ n: number }>(
          `select count(*)::int as n from subscriptions where id = '${subscription}'`,
        );
        expect(left.rows[0]?.n).toBe(0);
        const kept = await client.query(
          `select payer_account_id, subscription_id from invoices where id = '${invoice}'`,
        );
        expect(kept.rows[0]).toEqual({ payer_account_id: person, subscription_id: null });
      } finally {
        await client.close();
      }
    },
    MIGRATION_TIMEOUT_MS,
  );
});
