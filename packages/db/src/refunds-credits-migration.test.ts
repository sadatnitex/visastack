import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

const MIGRATION_TIMEOUT_MS = 180_000;
const FILE = '0104_refunds_credits';

function statements(): string[] {
  return readFileSync(join(migrationsFolder, `${FILE}.sql`), 'utf8').split(
    '--> statement-breakpoint',
  );
}

/** A copy of the migrations folder holding every migration before 0104: the database as production has it today. */
function folderBefore0104(): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  const at = journal.entries.findIndex((e: { tag: string }) => e.tag === FILE);
  if (at === -1) throw new Error(`${FILE} is not in the journal`);
  const prior = journal.entries.slice(0, at) as { tag: string }[];
  const folder = mkdtempSync(join(tmpdir(), 'visastack-0104-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: prior }));
  for (const entry of prior) {
    copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

async function seed(client: PGlite) {
  const one = async (text: string): Promise<string> => {
    const id = (await client.query<{ id: string }>(text)).rows[0]?.id;
    if (!id) throw new Error(`no row from: ${text}`);
    return id;
  };
  const org = await one(
    `insert into organizations (name, status) values ('Synthetic Agency', 'ACTIVE') returning id`,
  );
  const plan = await one(`select id from plans where key = 'agency_starter'`);
  const invoice = await one(
    `insert into invoices (organization_id, plan_id, period_start, period_end, invoice_ref, invoiced_amount_minor_units, collected_amount_minor_units, currency, due_date, status)
     values ('${org}', '${plan}', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'INV-R1', 5000, 5000, 'BDT', '2026-11-08T00:00:00Z', 'PAID') returning id`,
  );
  const entry = await one(
    `insert into invoice_payments (invoice_id, amount_minor_units, currency, kind, reference, collected_date, recorded_by_account_id)
     values ('${invoice}', 5000, 'BDT', 'ADMIN_RECORDED', 'BANK-1', now(), gen_random_uuid()) returning id`,
  );
  const attempt = await one(
    `insert into payment_attempts (invoice_id, organization_id, provider, merchant_tran_id, amount_minor_units, currency, status, reason_code)
     values ('${invoice}', '${org}', 'sslcommerz', 'VSP${'a'.repeat(26)}', 5000, 'BDT', 'HELD_FOR_REVIEW', 'already_paid') returning id`,
  );
  return { org, invoice, entry, attempt };
}

describe('migration 0104: refunds, credits and the accounting export', () => {
  it(
    'runs twice on a database as production has it, adds the attempt status, and refuses bad rows',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder: folderBefore0104() });
      const { org, invoice, entry, attempt } = await seed(client);
      const before = await client.query<{ present: boolean }>(
        `select to_regclass('refund_requests') is not null as present`,
      );
      expect(before.rows[0]?.present).toBe(false);
      // The runbook's pre-check: nothing has ever been refunded or credited.
      const precheck = await client.query<{ n: number }>(
        `select count(*)::int as n from invoice_payments where kind in ('REFUND', 'CREDIT')`,
      );
      expect(precheck.rows[0]?.n).toBe(0);

      // Statement by statement, twice: the second run changes nothing and raises nothing.
      for (let run = 0; run < 2; run++) {
        for (const statement of statements()) await client.exec(statement);
      }

      const values = await client.query<{ v: string }>(
        'select unnest(enum_range(null::payment_attempt_status))::text as v',
      );
      expect(values.rows.map((r) => r.v)).toContain('REFUNDED');
      await client.query(`update payment_attempts set status = 'REFUNDED' where id = '${attempt}'`);

      const request = (fields: Record<string, string | null>) => {
        const base: Record<string, string | null> = {
          organization_id: org,
          invoice_id: invoice,
          invoice_payment_id: entry,
          payment_attempt_id: null,
          method: 'PROVIDER',
          status: 'REQUESTED',
          amount_minor_units: '1000',
          currency: 'BDT',
          provider: 'sslcommerz',
          idempotency_key: crypto.randomUUID(),
          reason: 'Agency overpaid',
          requested_by_account_id: crypto.randomUUID(),
          ...fields,
        };
        const names = Object.keys(base);
        const list = names
          .map((name) => (base[name] === null ? 'null' : `'${String(base[name])}'`))
          .join(', ');
        return client.query<{ id: string }>(
          `insert into refund_requests (${names.join(', ')}) values (${list}) returning id`,
        );
      };

      const good = (await request({})).rows[0]?.id;
      expect(good).toBeTruthy();
      // One source, never both and never none.
      await expect(request({ payment_attempt_id: attempt })).rejects.toThrow();
      await expect(request({ invoice_payment_id: null })).rejects.toThrow();
      await expect(request({ amount_minor_units: '0' })).rejects.toThrow();
      await expect(request({ currency: 'bdt' })).rejects.toThrow();
      await expect(request({ reason: '   ' })).rejects.toThrow();
      // A manual refund is born confirmed, with no provider and a reference.
      await expect(request({ method: 'MANUAL', provider: null })).rejects.toThrow();
      await expect(
        request({
          method: 'MANUAL',
          provider: null,
          status: 'CONFIRMED',
          confirmed_at: new Date().toISOString(),
        }),
      ).rejects.toThrow();
      await request({
        method: 'MANUAL',
        provider: null,
        status: 'CONFIRMED',
        confirmed_at: new Date().toISOString(),
        reference: 'BANK-REFUND-1',
      });
      // A provider refund past REQUESTED has the gateway's reference; confirmed has a time; failed a code.
      await expect(request({ status: 'SUBMITTED' })).rejects.toThrow();
      await expect(
        request({ status: 'CONFIRMED', provider_refund_id: 'RR1', confirmed_at: null }),
      ).rejects.toThrow();
      await expect(request({ status: 'FAILED' })).rejects.toThrow();
      // One gateway refund reference per provider, and one idempotency key.
      await request({ status: 'SUBMITTED', provider_refund_id: 'RR2' });
      await expect(request({ status: 'SUBMITTED', provider_refund_id: 'RR2' })).rejects.toThrow();
      const key = crypto.randomUUID();
      await request({ idempotency_key: key });
      await expect(request({ idempotency_key: key })).rejects.toThrow();

      // The guard: progress may move, money and source never; final rows are frozen; no deletes.
      const update = (fields: string, id = good) =>
        client.query(`update refund_requests set ${fields} where id = '${id}'`);
      await expect(update('amount_minor_units = 2000')).rejects.toThrow();
      await expect(
        update(`invoice_payment_id = null, payment_attempt_id = '${attempt}'`),
      ).rejects.toThrow();
      await expect(update(`method = 'MANUAL'`)).rejects.toThrow();
      await expect(update(`reason = 'changed'`)).rejects.toThrow();
      await expect(update('requested_by_account_id = gen_random_uuid()')).rejects.toThrow();
      await update(`status = 'SUBMITTED', provider_refund_id = 'RR3', submitted_at = now()`);
      await expect(update(`provider_refund_id = 'RR4'`)).rejects.toThrow();
      await update(`status = 'CONFIRMED', confirmed_at = now()`);
      await expect(update('last_checked_at = now()')).rejects.toThrow();
      await expect(update(`status = 'FAILED', failure_code = 'x'`)).rejects.toThrow();
      await expect(
        client.query(`delete from refund_requests where id = '${good}'`),
      ).rejects.toThrow();
      await expect(client.query('truncate refund_requests')).rejects.toThrow();

      const indexes = await client.query<{ indexname: string }>(
        `select indexname from pg_indexes where indexname in ('refund_requests_open_idx', 'refund_requests_payment_idx', 'refund_requests_attempt_idx', 'invoice_payments_created_idx') order by 1`,
      );
      expect(indexes.rows.map((r) => r.indexname)).toEqual([
        'invoice_payments_created_idx',
        'refund_requests_attempt_idx',
        'refund_requests_open_idx',
        'refund_requests_payment_idx',
      ]);
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'is applied by the normal migration run, with every constraint once',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder });
      for (const statement of statements()) await client.exec(statement);
      const constraints = await client.query<{ conname: string }>(
        `select conname from pg_constraint where conrelid = 'refund_requests'::regclass order by 1`,
      );
      const names = constraints.rows.map((r) => r.conname);
      expect(new Set(names).size).toBe(names.length);
      expect(names).toEqual(
        expect.arrayContaining([
          'refund_requests_one_source',
          'refund_requests_manual_shape',
          'refund_requests_sent_has_ref',
          'refund_requests_confirmed_time',
          'refund_requests_failed_code',
          'refund_requests_idempotency_unique',
          'refund_requests_provider_refund_unique',
        ]),
      );
    },
    MIGRATION_TIMEOUT_MS,
  );
});
