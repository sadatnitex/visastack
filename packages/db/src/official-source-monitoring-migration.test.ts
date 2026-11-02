import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

/**
 * Migration 0115 (UMPE P10): the official-source register, the Saturday check runs, what each
 * fetch observed, and the machine-detected change candidates. Additive and re-runnable.
 */

const MIGRATION_TIMEOUT_MS = 180_000;
const FILE = '0115_official_source_monitoring';
const TABLES = [
  'official_sources',
  'source_change_candidates',
  'source_check_runs',
  'source_observations',
];
/** Columns that would make a table applicant-owned for the access ratchet. None may appear. */
const OWNED_COLUMNS = [
  'applicant_id',
  'mission_id',
  'document_id',
  'document_version_id',
  'owner_account_id',
];

function statements(): string[] {
  return readFileSync(join(migrationsFolder, `${FILE}.sql`), 'utf8').split(
    '--> statement-breakpoint',
  );
}

/** A copy of the migrations folder holding every migration before 0115. */
function folderBefore(): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  const at = journal.entries.findIndex((e: { tag: string }) => e.tag === FILE);
  if (at === -1) throw new Error(`${FILE} is not in the journal`);
  const prior = journal.entries.slice(0, at) as { tag: string }[];
  const folder = mkdtempSync(join(tmpdir(), 'visastack-0115-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: prior }));
  for (const entry of prior) {
    copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

describe('migration 0115: official-source monitoring (UMPE P10)', () => {
  it(
    'runs twice, adds only the four new tables, and enforces the register and candidate rules',
    async () => {
      const client = new PGlite();
      const folder = folderBefore();
      try {
        await migrate(drizzle(client), { migrationsFolder: folder });
        const tablesBefore = await client.query<{ table_name: string }>(
          "select table_name from information_schema.tables where table_schema = 'public' order by 1",
        );
        for (let run = 0; run < 2; run++) {
          for (const statement of statements()) await client.exec(statement);
        }
        const tablesAfter = await client.query<{ table_name: string }>(
          "select table_name from information_schema.tables where table_schema = 'public' order by 1",
        );
        const before = new Set(tablesBefore.rows.map((r) => r.table_name));
        expect(tablesAfter.rows.map((r) => r.table_name).filter((t) => !before.has(t))).toEqual(
          TABLES,
        );

        const owned = await client.query<{ table_name: string; column_name: string }>(
          `select table_name, column_name from information_schema.columns
           where table_name in (${TABLES.map((t) => `'${t}'`).join(', ')})`,
        );
        expect(owned.rows.filter((r) => OWNED_COLUMNS.includes(r.column_name))).toEqual([]);

        // The register: https only, a two-letter jurisdiction, a known authority tier, and one
        // active row per address.
        const insertSource = (url: string, jurisdiction = 'GB', tier = 'GOVERNMENT') =>
          client.query(
            `insert into official_sources (jurisdiction, url, title, publisher, authority_tier)
             values ($1, $2, 'Synthetic Page', 'Synthetic Authority', $3) returning id`,
            [jurisdiction, url, tier],
          );
        const created = await insertSource('https://synthetic.example/visit');
        const sourceId = (created.rows[0] as { id: string }).id;
        await expect(insertSource('http://synthetic.example/plain')).rejects.toThrow();
        await expect(insertSource('https://synthetic.example/a', 'gbr')).rejects.toThrow();
        await expect(insertSource('https://synthetic.example/b', 'GB', 'BLOG')).rejects.toThrow();
        await expect(insertSource('https://synthetic.example/visit')).rejects.toThrow();
        // Deactivating frees the address; active and the deactivation time must agree.
        await expect(
          client.query('update official_sources set active = false where id = $1', [sourceId]),
        ).rejects.toThrow();
        await client.query(
          'update official_sources set active = false, deactivated_at = now() where id = $1',
          [sourceId],
        );
        await insertSource('https://synthetic.example/visit');

        // Runs: one per key, known triggers, counts never below zero.
        const run = await client.query<{ id: string }>(
          "insert into source_check_runs (run_key, trigger) values ('scheduled:2026-11-07', 'SCHEDULED') returning id",
        );
        const runId = run.rows[0]?.id;
        await expect(
          client.query(
            "insert into source_check_runs (run_key, trigger) values ('scheduled:2026-11-07', 'SCHEDULED')",
          ),
        ).rejects.toThrow();
        await expect(
          client.query(
            "insert into source_check_runs (run_key, trigger) values ('x', 'SOMETIMES')",
          ),
        ).rejects.toThrow();
        await expect(
          client.query(
            "insert into source_check_runs (run_key, trigger, checked) values ('y', 'MANUAL', -1)",
          ),
        ).rejects.toThrow();

        // Observations: one per source per run, a known outcome, a fetched page has a fingerprint.
        const observe = (outcome: string, hash: string | null) =>
          client.query<{ id: string }>(
            `insert into source_observations (source_id, run_id, fetched_at, outcome, normalized_sha256)
             values ($1, $2, now(), $3, $4) returning id`,
            [sourceId, runId, outcome, hash],
          );
        await expect(observe('FETCHED', null)).rejects.toThrow();
        await expect(observe('GUESSED', 'abc')).rejects.toThrow();
        const observation = await observe('FETCHED', 'abc');
        await expect(observe('BLOCKED', null)).rejects.toThrow();
        await expect(
          client.query(
            `insert into source_check_runs (run_key, trigger) values ('z', 'MANUAL');
             update source_observations set excerpt = repeat('x', 2001)`,
          ),
        ).rejects.toThrow();

        // Candidates: one per source and fingerprint, known statuses only.
        const candidate = (hash: string, status = 'NEW') =>
          client.query(
            `insert into source_change_candidates (source_id, observation_id, normalized_sha256, status)
             values ($1, $2, $3, $4)`,
            [sourceId, observation.rows[0]?.id, hash, status],
          );
        await candidate('abc');
        await expect(candidate('abc')).rejects.toThrow();
        await expect(candidate('def', 'PUBLISHED')).rejects.toThrow();
      } finally {
        await client.close();
        rmSync(folder, { recursive: true, force: true });
      }
    },
    MIGRATION_TIMEOUT_MS,
  );
});
