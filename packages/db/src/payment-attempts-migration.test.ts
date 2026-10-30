import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

const MIGRATION_TIMEOUT_MS = 120_000;

describe('migration 0096: online payment attempts (S11)', () => {
  it(
    'creates the attempts table, is safe to run again, and holds the payment rules',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder });

      // Production applies each statement on its own; running the whole file again must not fail.
      const sql = readFileSync(join(migrationsFolder, '0096_payment_attempts.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) await client.exec(statement);

      const account = (
        await client.query<{ id: string }>(
          `insert into accounts (email) values ('pay-migration@example.test') returning id`,
        )
      ).rows[0]?.id;
      const org = (
        await client.query<{ id: string }>(
          `insert into organizations (name) values ('Acme Travel') returning id`,
        )
      ).rows[0]?.id;
      const plan = (await client.query<{ id: string }>('select id from plans limit 1')).rows[0]?.id;
      const invoice = (
        await client.query<{ id: string }>(
          `insert into invoices (organization_id, plan_id, period_start, period_end, invoice_ref,
             invoiced_amount_minor_units, currency, due_date)
           values ('${org}', '${plan}', now(), now() + interval '30 days', 'INV-MIG-1', 10000, 'BDT', now())
           returning id`,
        )
      ).rows[0]?.id;
      expect(account && org && plan && invoice).toBeTruthy();

      const attempt = (tran: string, extra = '', status = 'REDIRECTED') =>
        client.query(
          `insert into payment_attempts (invoice_id, organization_id, provider, merchant_tran_id,
             amount_minor_units, currency, mode, status${extra ? `, ${extra.split('=')[0]}` : ''})
           values ('${invoice}', '${org}', 'sslcommerz', '${tran}', 10000, 'BDT', 'LIVE', '${status}'${
             extra ? `, ${extra.split('=')[1]}` : ''
           })`,
        );

      await attempt('VSP0000000000000000000001');
      // A transaction id is never reused.
      await expect(attempt('VSP0000000000000000000001')).rejects.toThrow();
      // Amounts are positive.
      await expect(
        client.query(
          `insert into payment_attempts (invoice_id, organization_id, provider, merchant_tran_id,
             amount_minor_units, currency, mode)
           values ('${invoice}', '${org}', 'sslcommerz', 'VSP0000000000000000000002', 0, 'BDT', 'LIVE')`,
        ),
      ).rejects.toThrow();
      // A recorded attempt carries its time; a held attempt carries its reason.
      await expect(attempt('VSP0000000000000000000003', '', 'RECORDED')).rejects.toThrow();
      await expect(attempt('VSP0000000000000000000004', '', 'HELD_FOR_REVIEW')).rejects.toThrow();
      await attempt('VSP0000000000000000000005', 'recorded_at=now()', 'RECORDED');
      await attempt('VSP0000000000000000000006', `reason_code='mismatch'`, 'HELD_FOR_REVIEW');
      // One gateway payment id belongs to one attempt.
      await attempt('VSP0000000000000000000007', `provider_val_id='VAL1234567'`);
      await expect(
        attempt('VSP0000000000000000000008', `provider_val_id='VAL1234567'`),
      ).rejects.toThrow();
      // Statuses outside the list are refused.
      await expect(attempt('VSP0000000000000000000009', '', 'PAID')).rejects.toThrow();
      // Attempts keep their invoice and agency: neither can be deleted from under them.
      await expect(client.query(`delete from invoices where id = '${invoice}'`)).rejects.toThrow();
      await expect(client.query(`delete from organizations where id = '${org}'`)).rejects.toThrow();
    },
    MIGRATION_TIMEOUT_MS,
  );
});
