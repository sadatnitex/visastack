import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

const MIGRATION_TIMEOUT_MS = 180_000;
const FILE = '0104_ai_suggestions';

function statements(): string[] {
  return readFileSync(join(migrationsFolder, `${FILE}.sql`), 'utf8').split(
    '--> statement-breakpoint',
  );
}

/** A copy of the migrations folder holding every migration before this one, as production has it today. */
function foldersBefore(): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  const at = journal.entries.findIndex((e: { tag: string }) => e.tag === FILE);
  if (at === -1) throw new Error(`${FILE} is not in the journal`);
  const prior = journal.entries.slice(0, at) as { tag: string }[];
  const folder = mkdtempSync(join(tmpdir(), 'visastack-ai-suggestions-'));
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
    `insert into accounts (email) values ('ai-suggestions-${Math.random()}@example.test') returning id`,
  );
  const applicant = await one(
    `insert into applicants (owner_account_id, display_name) values ('${account}', 'Synthetic Traveller') returning id`,
  );
  const storage = await one(
    `insert into storage_objects (bucket, object_key) values ('CLEAN', 'clean/${Math.random()}') returning id`,
  );
  const document = await one(
    `insert into documents (applicant_id, original_name) values ('${applicant}', 'scan.pdf') returning id`,
  );
  const version = await one(
    `insert into document_versions (document_id, storage_object_id) values ('${document}', '${storage}') returning id`,
  );
  const run = (versionSql: string, model: string) =>
    one(
      `insert into ai_extraction_runs (document_version_id, applicant_id, status, model_version, prompt_version)
       values (${versionSql}, '${applicant}', 'SUCCEEDED', '${model}', 'p') returning id`,
    );
  const proposal = (runId: string, versionSql: string) =>
    one(
      `insert into field_proposals (ai_extraction_run_id, document_version_id, applicant_id, type, field_key, value, confidence)
       values ('${runId}', ${versionSql}, '${applicant}', 'UPDATE', 'home_city', 'Dhaka', 0) returning id`,
    );
  return { one, account, applicant, version, run, proposal };
}

describe('migration 0104: AI app suggestions', () => {
  it(
    'runs twice on the database as it is today, keeps every existing suggestion and refuses what it should',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder: foldersBefore() });
      const { applicant, version, run, proposal } = await seed(client);
      // What every existing row looks like: a document on both the run and the suggestion.
      const oldRun = await run(`'${version}'`, 'gpt-x');
      await proposal(oldRun, `'${version}'`);
      // Before: a suggestion with no document is refused, and the new tables are absent.
      await expect(run('null', 'connector:claude.ai')).rejects.toThrow();
      const before = await client.query<{ drafts: boolean; origins: boolean; settings: boolean }>(
        `select to_regclass('ai_drafts') is not null as drafts, to_regclass('ai_task_origins') is not null as origins,
                to_regclass('platform_ai_feature_settings') is not null as settings`,
      );
      expect(before.rows[0]).toEqual({ drafts: false, origins: false, settings: false });

      // Statement by statement, twice: the second run changes nothing.
      for (let pass = 0; pass < 2; pass++) {
        for (const statement of statements()) await client.exec(statement);
      }

      const kept = await client.query<{ document_version_id: string }>(
        'select document_version_id from field_proposals',
      );
      expect(kept.rows).toEqual([{ document_version_id: version }]);

      // A connector run may have no document; any other run still needs one.
      const connectorRun = await run('null', 'connector:claude.ai');
      await expect(run('null', 'gpt-x')).rejects.toThrow();
      await expect(run('null', 'deterministic:mrz-td3/1')).rejects.toThrow();
      // A suggestion with no document only from a connector run.
      await proposal(connectorRun, 'null');
      await expect(proposal(oldRun, 'null')).rejects.toThrow(/must come from an AI app/);
      // Nor can an existing suggestion lose its document afterwards.
      await expect(
        client.query(
          `update field_proposals set document_version_id = null where ai_extraction_run_id = '${oldRun}'`,
        ),
      ).rejects.toThrow(/must come from an AI app/);
      // A connector suggestion about a document keeps its document.
      await proposal(connectorRun, `'${version}'`);

      // Drafts: a title and a body within their limits.
      const draft = (title: string, body: string) =>
        client.query(
          `insert into ai_drafts (applicant_id, client_name, client_host, title, body)
           values ('${applicant}', 'Claude', 'claude.ai', $1, $2)`,
          [title, body],
        );
      await draft('Cover Letter', 'Dear Sir or Madam');
      await expect(draft('', 'body')).rejects.toThrow();
      await expect(draft('x'.repeat(121), 'body')).rejects.toThrow();
      await expect(draft('Title', '')).rejects.toThrow();
      await expect(draft('Title', 'y'.repeat(20_001))).rejects.toThrow();
      await draft('x'.repeat(120), 'y'.repeat(20_000));

      // The platform owner's AI feature switches: a limit from 1 to 1000, or none.
      const setting = (key: string, limit: string) =>
        client.query(
          `insert into platform_ai_feature_settings (feature_key, enabled, daily_limit) values ('${key}', true, ${limit})`,
        );
      await setting('ai_app_suggestions', '15');
      await setting('feature_without_limit', 'null');
      await expect(setting('limit_zero', '0')).rejects.toThrow();
      await expect(setting('limit_too_high', '1001')).rejects.toThrow();
      await expect(setting('ai_app_suggestions', '10')).rejects.toThrow();

      // Removing the record removes its drafts.
      await client.query(`delete from applicants where id = '${applicant}'`);
      expect((await client.query('select id from ai_drafts')).rows).toHaveLength(0);

      const nullable = await client.query<{ table_name: string; is_nullable: string }>(
        `select table_name, is_nullable from information_schema.columns
         where column_name = 'document_version_id' and table_name in ('field_proposals', 'ai_extraction_runs')
         order by table_name`,
      );
      expect(nullable.rows).toEqual([
        { table_name: 'ai_extraction_runs', is_nullable: 'YES' },
        { table_name: 'field_proposals', is_nullable: 'YES' },
      ]);
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'removes the app label with the reminder it belongs to',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder });
      const { one, applicant } = await seed(client);
      const mission = await one(
        `insert into missions (applicant_id, title) values ('${applicant}', 'London Trip') returning id`,
      );
      const task = await one(
        `insert into mission_tasks (mission_id, description) values ('${mission}', 'Book the appointment') returning id`,
      );
      await client.query(
        `insert into ai_task_origins (task_id, client_name, client_host) values ('${task}', 'Claude', 'claude.ai')`,
      );
      await expect(
        client.query(
          `insert into ai_task_origins (task_id, client_name, client_host) values ('${task}', 'Claude', 'claude.ai')`,
        ),
      ).rejects.toThrow();
      await client.query(`delete from mission_tasks where id = '${task}'`);
      expect((await client.query('select task_id from ai_task_origins')).rows).toHaveLength(0);
    },
    MIGRATION_TIMEOUT_MS,
  );
});
