import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

const MIGRATION_TIMEOUT_MS = 180_000;
const FILE = '0106_ai_connection_documents';

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
  const folder = mkdtempSync(join(tmpdir(), 'visastack-ai-files-'));
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
  const record = async (email: string) => {
    const account = await one(
      `insert into accounts (email) values ('${email}-${Math.random()}@example.test') returning id`,
    );
    const applicant = await one(
      `insert into applicants (owner_account_id, display_name) values ('${account}', 'Synthetic Traveller') returning id`,
    );
    const document = await one(
      `insert into documents (applicant_id, original_name, doc_type) values ('${applicant}', 'visa.pdf', 'VISA') returning id`,
    );
    const connection = await one(
      `insert into ai_connections (account_id, applicant_id, client_id, client_name, client_host, case_mode)
       values ('${account}', '${applicant}', 'https://claude.ai/meta', 'Claude', 'claude.ai', 'NONE') returning id`,
    );
    return { account, applicant, document, connection };
  };
  return { mine: await record('owner'), theirs: await record('other') };
}

describe('migration 0106: AI app original files', () => {
  it(
    'runs twice on the database as it is today and refuses what it should',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder: foldersBefore() });
      const { mine, theirs } = await seed(client);
      const before = await client.query<{ present: boolean }>(
        `select to_regclass('ai_connection_documents') is not null as present`,
      );
      expect(before.rows[0]).toEqual({ present: false });

      // Statement by statement, twice: the second run changes nothing.
      for (let pass = 0; pass < 2; pass++) {
        for (const statement of statements()) await client.exec(statement);
      }

      const pick = (connection: string, document: string, variant: string) =>
        client.query(
          'insert into ai_connection_documents (connection_id, document_id, variant) values ($1, $2, $3)',
          [connection, document, variant],
        );
      await pick(mine.connection, mine.document, 'SAFE_COPY');
      // One row per chosen document.
      await expect(pick(mine.connection, mine.document, 'ORIGINAL')).rejects.toThrow();
      // Only the two ways of giving a file.
      await expect(pick(theirs.connection, theirs.document, 'ANYTHING')).rejects.toThrow();
      // Never a document of another record, on insert or on a later change.
      await expect(pick(mine.connection, theirs.document, 'SAFE_COPY')).rejects.toThrow(
        /only name documents of its own record/,
      );
      await expect(
        client.query(
          'update ai_connection_documents set document_id = $1 where connection_id = $2',
          [theirs.document, mine.connection],
        ),
      ).rejects.toThrow(/only name documents of its own record/);
      await pick(theirs.connection, theirs.document, 'ORIGINAL');

      // A removed document, or a removed connection, takes its choices with it.
      await client.query(`delete from documents where id = '${theirs.document}'`);
      await client.query(`delete from ai_connections where id = '${mine.connection}'`);
      expect((await client.query('select * from ai_connection_documents')).rows).toHaveLength(0);

      const trigger = await client.query<{ count: number }>(
        `select count(*)::int as count from pg_trigger where tgname = 'ai_connection_documents_same_record'`,
      );
      expect(trigger.rows[0]?.count).toBe(1);
    },
    MIGRATION_TIMEOUT_MS,
  );
});
