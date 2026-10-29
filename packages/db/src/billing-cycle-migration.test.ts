import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

const MIGRATION_TIMEOUT_MS = 180_000;
const FILE = '0103_billing_cycle';

function statements(): string[] {
  return readFileSync(join(migrationsFolder, `${FILE}.sql`), 'utf8').split(
    '--> statement-breakpoint',
  );
}

/** A copy of the migrations folder holding every migration before 0103, so a database can be built as production has it today. */
function foldersBefore0103(): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  const at = journal.entries.findIndex((e: { tag: string }) => e.tag === FILE);
  if (at === -1) throw new Error(`${FILE} is not in the journal`);
  const prior = journal.entries.slice(0, at) as { tag: string }[];
  const folder = mkdtempSync(join(tmpdir(), 'visastack-0103-'));
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
  const account = await one(
    `insert into accounts (email) values ('billing-migration-${Math.random()}@example.test') returning id`,
  );
  const org = await one(
    `insert into organizations (name, status) values ('Synthetic Agency', 'ACTIVE') returning id`,
  );
  const billing = await one(
    `insert into billing_accounts (organization_id, status) values ('${org}', 'ACTIVE') returning id`,
  );
  const plan = await one(`select id from plans where key = 'agency_starter'`);
  return { one, account, org, billing, plan };
}

describe('migration 0103: recurring invoices and overdue handling', () => {
  it(
    'is safe to run again, holds one row of rules, and refuses what it should',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder });
      for (const statement of statements()) await client.exec(statement);

      const { account, org, billing, plan } = await seed(client);

      // One row of rules with the standard values.
      const rules = await client.query<Record<string, unknown>>('select * from billing_settings');
      expect(rules.rows).toHaveLength(1);
      expect(rules.rows[0]).toMatchObject({
        id: true,
        due_days: 7,
        overdue_handling_enabled: false,
        grace_after_days: null,
        suspend_after_days: null,
      });
      await expect(
        client.query('insert into billing_settings (id) values (false)'),
      ).rejects.toThrow();
      await expect(
        client.query('insert into billing_settings (id) values (true)'),
      ).rejects.toThrow();
      const set = (fields: string) => client.query(`update billing_settings set ${fields}`);
      await expect(set('due_days = 0')).rejects.toThrow();
      await expect(set('due_days = 61')).rejects.toThrow();
      await expect(set('overdue_handling_enabled = true')).rejects.toThrow();
      await expect(set('grace_after_days = 7, suspend_after_days = 7')).rejects.toThrow();
      await expect(set('grace_after_days = 7, suspend_after_days = 366')).rejects.toThrow();
      await expect(set('grace_after_days = -1, suspend_after_days = 30')).rejects.toThrow();
      // Overdue starts the day after the due day, so Grace starts at 1 at the earliest.
      await expect(set('grace_after_days = 0, suspend_after_days = 30')).rejects.toThrow();
      await set('grace_after_days = 1, suspend_after_days = 2');
      await set('grace_after_days = 7, suspend_after_days = 30, overdue_handling_enabled = true');

      // A history row by a person names them; one by the system has no person, cause NONPAYMENT
      // and a reason starting "system:". Nothing in between.
      const history = (actor: string | null, cause: string, reason: string) =>
        client.query(
          `insert into billing_status_history (billing_account_id, from_status, to_status, actor_account_id, reason, cause)
           values ('${billing}', 'ACTIVE', 'GRACE', ${actor === null ? 'null' : `'${actor}'`}, '${reason}', '${cause}')`,
        );
      await history(account, 'MANUAL', 'agreed by phone');
      await history(null, 'NONPAYMENT', 'system: overdue 7 days (INV-1)');
      await expect(history(null, 'MANUAL', 'system: overdue')).rejects.toThrow();
      await expect(history(null, 'NONPAYMENT', 'overdue')).rejects.toThrow();
      await expect(history(account, 'NONPAYMENT', 'system: overdue')).rejects.toThrow();
      await expect(
        client.query(
          `insert into billing_status_history (billing_account_id, to_status, reason) values ('${billing}', 'ACTIVE', 'no person')`,
        ),
      ).rejects.toThrow();

      // One live invoice per organization, plan and period start; a void one does not count.
      const invoice = (ref: string, status = 'OPEN') =>
        client.query(
          `insert into invoices (organization_id, plan_id, period_start, period_end, invoice_ref, invoiced_amount_minor_units, currency, due_date, status)
           values ('${org}', '${plan}', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', '${ref}', 5000, 'BDT', '2026-11-08T00:00:00Z', '${status}')`,
        );
      await invoice('INV-A', 'VOID');
      await invoice('INV-B');
      await expect(invoice('INV-C')).rejects.toThrow();
      await client.query(`update invoices set status = 'VOID' where invoice_ref = 'INV-B'`);
      await invoice('INV-C');

      const indexes = await client.query<{ indexname: string }>(
        `select indexname from pg_indexes where indexname in ('invoices_org_plan_period_unique', 'invoices_open_due_idx', 'billing_status_history_latest_idx') order by 1`,
      );
      expect(indexes.rows.map((r) => r.indexname)).toEqual([
        'billing_status_history_latest_idx',
        'invoices_open_due_idx',
        'invoices_org_plan_period_unique',
      ]);
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'keeps every history row a person already wrote, as MANUAL, when run on a database as it is today',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder: foldersBefore0103() });
      const { account, billing } = await seed(client);
      // The shape every existing row has: a person and a reason, no cause.
      await client.query(
        `insert into billing_status_history (billing_account_id, from_status, to_status, actor_account_id, reason)
         values ('${billing}', null, 'ACTIVE', '${account}', 'opened by hand')`,
      );
      const before = await client.query<{ present: boolean }>(
        `select to_regclass('billing_settings') is not null as present`,
      );
      expect(before.rows[0]?.present).toBe(false);

      // Statement by statement, twice: the second run changes nothing.
      for (let run = 0; run < 2; run++) {
        for (const statement of statements()) await client.exec(statement);
      }
      const rows = await client.query<{ cause: string; actor_account_id: string; reason: string }>(
        'select cause::text as cause, actor_account_id, reason from billing_status_history',
      );
      expect(rows.rows).toEqual([
        { cause: 'MANUAL', actor_account_id: account, reason: 'opened by hand' },
      ]);
      expect((await client.query('select id from billing_settings')).rows).toHaveLength(1);
    },
    MIGRATION_TIMEOUT_MS,
  );
});
