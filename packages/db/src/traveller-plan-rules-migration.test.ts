import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';
import * as schema from './schema';
import { createMigratedPglite } from './testing';

const MIGRATION_TIMEOUT_MS = 180_000;
const FILE = '0111_traveller_plan_rules';

function statements(): string[] {
  return readFileSync(join(migrationsFolder, `${FILE}.sql`), 'utf8').split(
    '--> statement-breakpoint',
  );
}

/** A copy of the migrations folder holding every migration before 0111. */
function folderBefore(): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  const at = journal.entries.findIndex((e: { tag: string }) => e.tag === FILE);
  if (at === -1) throw new Error(`${FILE} is not in the journal`);
  const prior = journal.entries.slice(0, at) as { tag: string }[];
  const folder = mkdtempSync(join(tmpdir(), 'visastack-0111-'));
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

describe('migration 0111: traveller plan rules (ADR 0025, T2)', () => {
  it(
    'runs twice on the database as it is today, keeps an organization’s assigner required, and frees a person’s own purchase',
    async () => {
      const client = new PGlite();
      const folder = folderBefore();
      try {
        await migrate(drizzle(client), { migrationsFolder: folder });
        const admin = await account(client, 'admin');
        const org = await one(
          client,
          `insert into organizations (name, status) values ('Synthetic Agency', 'ACTIVE') returning id`,
        );
        const agencyPlan = await one(client, `select id from plans where key = 'agency_starter'`);
        await client.query(
          `insert into subscriptions (organization_id, plan_id, assigned_by_account_id, reason) values ('${org}', '${agencyPlan}', '${admin}', 'Synthetic')`,
        );

        for (let run = 0; run < 2; run++) {
          for (const statement of statements()) await client.exec(statement);
        }

        // An organization's subscription still names who assigned it.
        await expect(
          client.query(
            `insert into subscriptions (organization_id, plan_id, reason) values ('${org}', '${agencyPlan}', 'Synthetic')`,
          ),
        ).rejects.toThrow(/subscriptions_organization_assigned/);
        // A person's own purchase names no assigner, and never blocks deleting their account.
        const person = await account(client, 'buyer');
        const free = await one(client, `select id from plans where key = 'traveller_free'`);
        await client.query(
          `insert into subscriptions (payer_account_id, plan_id, reason) values ('${person}', '${free}', 'Bought for themselves')`,
        );
        await client.query(`delete from accounts where id = '${person}'`);
        const left = await client.query<{ n: number }>(
          `select count(*)::int as n from subscriptions where payer_account_id = '${person}'`,
        );
        expect(left.rows[0]?.n).toBe(0);
        // The assigner of an organization's subscription still cannot be deleted (unchanged).
        await expect(client.query(`delete from accounts where id = '${admin}'`)).rejects.toThrow(
          /subscriptions_assigned_by_account_id/,
        );

        // The two storage rules, counted in total only.
        for (const key of ['account_storage_bytes', 'person_storage_bytes']) {
          await client.query(
            `insert into plan_entitlements (plan_id, key, included, limit_value, per) values ('${free}', '${key}', true, 1048576, 'TOTAL')`,
          );
          await expect(
            client.query(
              `update plan_entitlements set per = 'DAY' where plan_id = '${free}' and key = '${key}'`,
            ),
          ).rejects.toThrow(/plan_entitlements_per_matches_key/);
        }
        await expect(
          client.query(
            `insert into plan_entitlements (plan_id, key, included, limit_value, per) values ('${free}', 'people_storage', true, 1, 'TOTAL')`,
          ),
        ).rejects.toThrow(/plan_entitlements_key_shape/);
      } finally {
        await client.close();
        rmSync(folder, { recursive: true, force: true });
      }
    },
    MIGRATION_TIMEOUT_MS,
  );
});

/**
 * What migration 0110 added that schema.ts does not declare yet (ADR 0025 section 13: the database
 * gains person payers first, and code reads them with plain SQL until the agency billing paths are
 * moved). Each table's columns, checks and indexes must equal schema.ts plus exactly these.
 */
const PERSON_PAYER_EXTRAS: Record<
  string,
  { columns: Record<string, boolean>; checks: string[]; indexes: string[] }
> = {
  subscriptions: {
    columns: { organization_id: true, payer_account_id: true, renews: false },
    checks: ['subscriptions_one_payer'],
    indexes: ['subscriptions_one_current_per_person', 'subscriptions_payer_idx'],
  },
  invoices: {
    columns: { organization_id: true, payer_account_id: true, subscription_id: true },
    checks: ['invoices_one_payer'],
    indexes: [
      'invoices_person_plan_period_unique',
      'invoices_person_paid_period_idx',
      'invoices_subscription_idx',
    ],
  },
  payment_attempts: {
    columns: { organization_id: true, payer_account_id: true },
    checks: ['payment_attempts_one_payer'],
    indexes: ['payment_attempts_payer_idx'],
  },
  refund_requests: {
    columns: { organization_id: true, payer_account_id: true },
    checks: ['refund_requests_one_payer'],
    indexes: ['refund_requests_payer_idx'],
  },
  payment_receipts: {
    columns: { organization_id: true, payer_account_id: true },
    checks: ['payment_receipts_one_payer'],
    indexes: ['payment_receipts_person_number_unique'],
  },
};

describe('the billing tables are what the code declares plus the documented person-payer additions', () => {
  const tables = [
    schema.subscriptions,
    schema.invoices,
    schema.paymentAttempts,
    schema.refundRequests,
    schema.paymentReceipts,
  ];

  it(
    'has exactly the declared and documented column names and nullability, check names and index names',
    async () => {
      const client = await createMigratedPglite();
      try {
        for (const table of tables) {
          const config = getTableConfig(table);
          const extras = PERSON_PAYER_EXTRAS[config.name];
          if (!extras) throw new Error(`no documented additions for ${config.name}`);
          const columns = await client.query<{ column_name: string; is_nullable: string }>(
            `select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = '${config.name}'`,
          );
          const actual = Object.fromEntries(
            columns.rows.map((c) => [c.column_name, c.is_nullable === 'YES']),
          );
          const declared = {
            ...Object.fromEntries(config.columns.map((c) => [c.name, !c.notNull])),
            ...extras.columns,
          };
          expect(actual, `${config.name} columns`).toEqual(declared);

          const checks = await client.query<{ conname: string }>(
            `select conname from pg_constraint where conrelid = '${config.name}'::regclass and contype = 'c'`,
          );
          expect(checks.rows.map((c) => c.conname).sort(), `${config.name} checks`).toEqual(
            [...config.checks.map((c) => c.name), ...extras.checks].sort(),
          );

          const indexes = await client.query<{ indexname: string }>(
            `select indexname from pg_indexes where schemaname = 'public' and tablename = '${config.name}'`,
          );
          const declaredIndexes = [
            ...config.indexes.map((i) => i.config.name),
            ...config.uniqueConstraints.map((u) => u.getName()),
            ...config.columns.filter((c) => c.isUnique).map((c) => c.uniqueName ?? ''),
            `${config.name}_pkey`,
            ...extras.indexes,
          ];
          expect(indexes.rows.map((i) => i.indexname).sort(), `${config.name} indexes`).toEqual(
            [...new Set(declaredIndexes)].sort(),
          );
        }

        const counters = await client.query<{ column_name: string; is_nullable: string }>(
          `select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'person_receipt_counters' order by column_name`,
        );
        expect(counters.rows).toEqual([
          { column_name: 'account_id', is_nullable: 'NO' },
          { column_name: 'last_number', is_nullable: 'NO' },
        ]);
      } finally {
        await client.close();
      }
    },
    MIGRATION_TIMEOUT_MS,
  );
});
