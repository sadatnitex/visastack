import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

/**
 * Migration 0114 (ADR 0025 T6): the daily counts of Plan & Usage views and Get taps (a day, an
 * event, a number: never who) and the owner's one row of traveller payment alert thresholds.
 */

const MIGRATION_TIMEOUT_MS = 180_000;
const FILE = '0114_traveller_plan_metrics';

function statements(): string[] {
  return readFileSync(join(migrationsFolder, `${FILE}.sql`), 'utf8').split(
    '--> statement-breakpoint',
  );
}

/** A copy of the migrations folder holding every migration before 0114. */
function folderBefore(): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  const at = journal.entries.findIndex((e: { tag: string }) => e.tag === FILE);
  if (at === -1) throw new Error(`${FILE} is not in the journal`);
  const prior = journal.entries.slice(0, at) as { tag: string }[];
  const folder = mkdtempSync(join(tmpdir(), 'visastack-0114-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: prior }));
  for (const entry of prior) {
    copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

describe('migration 0114: traveller plan metrics (ADR 0025, T6)', () => {
  it(
    'runs twice, seeds the standard thresholds once, and keeps counts to a day, an event and a number',
    async () => {
      const client = new PGlite();
      const folder = folderBefore();
      try {
        await migrate(drizzle(client), { migrationsFolder: folder });
        for (let run = 0; run < 2; run++) {
          for (const statement of statements()) await client.exec(statement);
        }
        const settings = await client.query<Record<string, unknown>>(
          'select * from traveller_plan_health_settings',
        );
        expect(settings.rows).toHaveLength(1);
        expect(settings.rows[0]).toMatchObject({
          id: true,
          checkout_success_min_percent: 50,
          confirmation_max_minutes: 15,
          stuck_confirming_max: 0,
          needs_check_max: 0,
        });
        // One row only, and only sensible values.
        await expect(
          client.query('insert into traveller_plan_health_settings (id) values (false)'),
        ).rejects.toThrow();
        await expect(
          client.query(
            'update traveller_plan_health_settings set checkout_success_min_percent = 101',
          ),
        ).rejects.toThrow();
        await expect(
          client.query('update traveller_plan_health_settings set confirmation_max_minutes = 0'),
        ).rejects.toThrow();
        // Counts: only the two events, never below zero, one row per day and event.
        await client.query(
          "insert into traveller_plan_daily_counts (day, event, count) values ('2026-11-01', 'PLAN_VIEWED', 1)",
        );
        await expect(
          client.query(
            "insert into traveller_plan_daily_counts (day, event) values ('2026-11-01', 'SOMEONE')",
          ),
        ).rejects.toThrow();
        await expect(
          client.query(
            "insert into traveller_plan_daily_counts (day, event, count) values ('2026-11-02', 'GET_TAPPED', -1)",
          ),
        ).rejects.toThrow();
        await expect(
          client.query(
            "insert into traveller_plan_daily_counts (day, event) values ('2026-11-01', 'PLAN_VIEWED')",
          ),
        ).rejects.toThrow();
        // Nothing in either table can name a person: no column for it.
        const columns = await client.query<{ column_name: string }>(
          "select column_name from information_schema.columns where table_name = 'traveller_plan_daily_counts' order by 1",
        );
        expect(columns.rows.map((r) => r.column_name)).toEqual(['count', 'day', 'event']);
      } finally {
        await client.close();
        rmSync(folder, { recursive: true, force: true });
      }
    },
    MIGRATION_TIMEOUT_MS,
  );
});
