import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

const MIGRATION_TIMEOUT_MS = 120_000;
const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** A copy of the shipped migrations with the journal cut after `lastTag`. */
function migrationsUpTo(lastTag: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'vs-migrations-'));
  folders.push(folder);
  cpSync(migrationsFolder, folder, { recursive: true });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  const cut = journal.entries.findIndex((entry) => entry.tag === lastTag);
  if (cut < 0) throw new Error(`no migration ${lastTag}`);
  journal.entries = journal.entries.slice(0, cut + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

describe('migration 0094: cash ledger (ADR 0020, S10)', () => {
  it(
    'opens each invoice ledger with its collected total, is safe to run again, and refuses edits',
    async () => {
      const client = new PGlite();
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: migrationsUpTo('0093_data_key_wrapping_id') });

      const one = async (query: string) =>
        ((await client.query<{ id: string }>(query)).rows[0] as { id: string }).id;
      const org = await one(`insert into organizations (name) values ('Agency A') returning id`);
      const plan = await one(`select id from plans where key = 'agency_starter'`);
      const invoice = (ref: string, invoiced: number, collected: number, paymentRef?: string) =>
        one(
          `insert into invoices (organization_id, plan_id, period_start, period_end, invoice_ref,
            invoiced_amount_minor_units, currency, due_date, status, collected_amount_minor_units,
            collected_date, payment_reference)
           values ('${org}', '${plan}', now(), now() + interval '30 days', '${ref}', ${invoiced},
            ' bdt ', now(), '${collected === 0 ? 'OPEN' : collected === invoiced ? 'PAID' : 'PARTIALLY_PAID'}',
            ${collected}, ${collected === 0 ? 'null' : "'2026-09-01T00:00:00Z'"},
            ${paymentRef ? `'${paymentRef}'` : 'null'}) returning id`,
        );
      const untouched = await invoice('INV-MIG-OPEN', 5000, 0);
      const partly = await invoice('INV-MIG-PART', 10000, 4000, 'wire-9');
      const paid = await invoice('INV-MIG-PAID', 7000, 7000);

      await migrate(db, { migrationsFolder });

      const rows = async () =>
        (
          await client.query<{
            invoice_id: string;
            amount_minor_units: number;
            currency: string;
            kind: string;
            reference: string;
            source_id: string | null;
            provider: string | null;
            provider_transaction_id: string | null;
          }>(
            'select invoice_id, amount_minor_units, currency, kind, reference, source_id, provider, provider_transaction_id from invoice_payments order by amount_minor_units',
          )
        ).rows;
      const opened = await rows();
      expect(opened).toHaveLength(2);
      expect(opened.find((r) => r.invoice_id === untouched)).toBeUndefined();
      expect(opened.find((r) => r.invoice_id === partly)).toMatchObject({
        amount_minor_units: 4000,
        currency: 'BDT',
        kind: 'ADMIN_RECORDED',
        reference: 'wire-9',
        source_id: null,
        provider: 'opening_balance',
        provider_transaction_id: `${partly}:4000`,
      });
      expect(opened.find((r) => r.invoice_id === paid)).toMatchObject({
        amount_minor_units: 7000,
        reference: 'Opening balance',
      });

      // Re-running every statement of the migration changes nothing (production
      // applies them one at a time and a run may be restarted from the top).
      const sql = readFileSync(join(migrationsFolder, '0094_invoice_payments_ledger.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) {
        await client.exec(statement);
      }
      expect(await rows()).toHaveLength(2);

      // The ledger tops itself up for money recorded before the table existed, only once.
      await client.query(
        `update invoices set collected_amount_minor_units = 5000, status = 'PARTIALLY_PAID' where id = '${partly}'`,
      );
      await client.exec(
        sql
          .slice(sql.indexOf('INSERT INTO "invoice_payments"'))
          .split('--> statement-breakpoint')[0] ?? '',
      );
      const topped = (await rows()).filter((r) => r.invoice_id === partly);
      expect(topped.map((r) => r.amount_minor_units).sort()).toEqual([1000, 4000]);

      // Append-only: every edit, delete and truncate is refused with an error.
      await expect(
        client.query('update invoice_payments set reference = $1', ['x']),
      ).rejects.toThrow(/append-only/);
      await expect(client.query('delete from invoice_payments')).rejects.toThrow(/append-only/);
      await expect(client.query('truncate invoice_payments')).rejects.toThrow(/append-only/);
      expect(await rows()).toHaveLength(3);

      // The database refuses the wrong sign, a missing source and a lone provider id.
      const insert = (columns: string, values: string) =>
        client.query(
          `insert into invoice_payments (invoice_id, currency, reference, collected_date, ${columns}) values ('${untouched}', 'BDT', 'r', now(), ${values})`,
        );
      await expect(insert('amount_minor_units, kind', `-5, 'ADMIN_RECORDED'`)).rejects.toThrow();
      await expect(insert('amount_minor_units, kind', `0, 'ADMIN_RECORDED'`)).rejects.toThrow();
      await expect(insert('amount_minor_units, kind', `5, 'REFUND'`)).rejects.toThrow();
      await expect(insert('amount_minor_units, kind', `5, 'ONLINE'`)).rejects.toThrow();
      await expect(
        insert(
          'amount_minor_units, kind, source_id, provider',
          `5, 'ONLINE', gen_random_uuid(), 'sslcommerz'`,
        ),
      ).rejects.toThrow();
      await client.query(
        `insert into invoice_payments (invoice_id, currency, reference, collected_date, amount_minor_units, kind, source_id, provider, provider_transaction_id)
         values ('${untouched}', 'BDT', 'r', now(), -5, 'REFUND', gen_random_uuid(), null, null)`,
      );
    },
    MIGRATION_TIMEOUT_MS,
  );
});
