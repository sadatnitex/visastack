import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

const MIGRATION_TIMEOUT_MS = 180_000;
const ENUM_FILE = '0108_ai_assist_permission';
const TABLES_FILE = '0109_agency_ai_connections';

function statements(file: string): string[] {
  return readFileSync(join(migrationsFolder, `${file}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .filter((statement) => statement.replace(/--[^\n]*/g, '').trim().length > 0);
}

/** A copy of the migrations folder holding every migration before `file`, as production has it today. */
function foldersBefore(file: string): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  const at = journal.entries.findIndex((e: { tag: string }) => e.tag === file);
  if (at === -1) throw new Error(`${file} is not in the journal`);
  const prior = journal.entries.slice(0, at) as { tag: string }[];
  const folder = mkdtempSync(join(tmpdir(), 'visastack-agency-ai-'));
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

describe('migrations 0108 and 0109: agency AI connectors', () => {
  it('keeps the new permission alone in the first file, before the tables', () => {
    const first = statements(ENUM_FILE);
    expect(first).toHaveLength(1);
    expect(first[0]).toContain(
      `ALTER TYPE "public"."permission_action" ADD VALUE IF NOT EXISTS 'AI_ASSIST';`,
    );
    // The second file never uses the new value: Postgres refuses it in the transaction that adds it.
    expect(readFileSync(join(migrationsFolder, `${TABLES_FILE}.sql`), 'utf8')).not.toContain(
      'AI_ASSIST',
    );
    // Neither file names its own number, so renumbering is a rename only.
    for (const file of [ENUM_FILE, TABLES_FILE]) {
      const text = readFileSync(join(migrationsFolder, `${file}.sql`), 'utf8');
      expect(text).not.toMatch(/\b010[89]\b/);
    }
  });

  it(
    'runs twice on the database as it is today and keeps a record or an agency, never both',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder: foldersBefore(ENUM_FILE) });
      const account = await one(
        client,
        `insert into accounts (email) values ('owner-${Math.random()}@example.test') returning id`,
      );
      const applicant = await one(
        client,
        `insert into applicants (owner_account_id, display_name) values ('${account}', 'Synthetic Traveller') returning id`,
      );
      const organization = await one(
        client,
        `insert into organizations (name, status) values ('Synthetic Agency', 'ACTIVE') returning id`,
      );
      const existing = await one(
        client,
        `insert into ai_connections (account_id, applicant_id, client_id, client_name, client_host, case_mode)
         values ('${account}', '${applicant}', 'https://claude.ai/meta', 'Claude', 'claude.ai', 'NONE') returning id`,
      );

      // Statement by statement, twice: the second run changes nothing.
      for (let pass = 0; pass < 2; pass++) {
        for (const file of [ENUM_FILE, TABLES_FILE]) {
          for (const statement of statements(file)) await client.exec(statement);
        }
      }

      const values = await client.query<{ value: string }>(
        'select unnest(enum_range(null::permission_action))::text as value',
      );
      expect(values.rows.map((row) => row.value)).toContain('AI_ASSIST');
      // A grant can now hold it.
      await client.query(
        `insert into grants (applicant_id, recipient_organization_id, actions, purpose, start_at)
         values ($1, $2, '{VIEW_METADATA,AI_ASSIST}', 'visa_application', now())`,
        [applicant, organization],
      );

      // The connection written before keeps its record and names no agency.
      const kept = await client.query<{ applicant_id: string }>(
        `select applicant_id from ai_connections where id = '${existing}'`,
      );
      expect(kept.rows[0]?.applicant_id).toBe(applicant);

      const agencyConnection = async (withAgencyRow: boolean) => {
        await client.exec('begin');
        try {
          const id = await one(
            client,
            `insert into ai_connections (account_id, client_id, client_name, client_host, case_mode)
             values ('${account}', 'https://claude.ai/meta', 'Claude', 'claude.ai', 'ALL_CURRENT') returning id`,
          );
          if (withAgencyRow) {
            await client.query(
              'insert into ai_connection_agencies (connection_id, organization_id) values ($1, $2)',
              [id, organization],
            );
          }
          await client.exec('commit');
          return id;
        } catch (error) {
          await client.exec('rollback');
          throw error;
        }
      };
      // An agency connection: no record, one agency row, written one after the other.
      const agency = await agencyConnection(true);
      // No record and no agency: refused when the transaction ends.
      await expect(agencyConnection(false)).rejects.toThrow(/either a record or an agency/);
      // A record and an agency: refused.
      await expect(
        client.query(
          'insert into ai_connection_agencies (connection_id, organization_id) values ($1, $2)',
          [existing, organization],
        ),
      ).rejects.toThrow(/either a record or an agency/);
      // Giving the agency connection a record: refused.
      await expect(
        client.query('update ai_connections set applicant_id = $1 where id = $2', [
          applicant,
          agency,
        ]),
      ).rejects.toThrow(/either a record or an agency/);
      // The agency row never moves to another connection or agency.
      const second = await agencyConnection(true);
      await expect(
        client.query(
          'update ai_connection_agencies set connection_id = $1 where connection_id = $2',
          [existing, second],
        ),
      ).rejects.toThrow(/keeps its connection and its agency/);
      // Removing the agency row removes its connection with it.
      await client.query('delete from ai_connection_agencies where connection_id = $1', [agency]);
      expect(
        (await client.query('select id from ai_connections where id = $1', [agency])).rows,
      ).toHaveLength(0);
      // Removing the connection takes its agency row with it.
      await client.query(`delete from ai_connections where id = '${second}'`);
      expect((await client.query('select * from ai_connection_agencies')).rows).toHaveLength(0);

      // The agency setting: off unless written.
      await client.query('insert into organization_ai_settings (organization_id) values ($1)', [
        organization,
      ]);
      const setting = await client.query<{ ai_connections_enabled: boolean }>(
        'select ai_connections_enabled from organization_ai_settings',
      );
      expect(setting.rows[0]?.ai_connections_enabled).toBe(false);

      // Removing an agency with a live agency connection works, and the connection goes with it.
      const live = await agencyConnection(true);
      await client.query(
        `insert into ai_connection_tokens (connection_id, kind, token_hash, family_id, resource, expires_at)
         values ($1, 'ACCESS', 'hash-agency', gen_random_uuid(), 'https://vs.example.test/mcp', now() + interval '1 hour')`,
        [live],
      );
      await client.query('delete from grants');
      await client.query(`delete from organizations where id = '${organization}'`);
      expect(
        (await client.query('select id from ai_connections where id = $1', [live])).rows,
      ).toHaveLength(0);
      expect((await client.query('select * from ai_connection_tokens')).rows).toHaveLength(0);
      expect((await client.query('select * from organization_ai_settings')).rows).toHaveLength(0);
      // The connection written before keeps its record.
      expect(
        (await client.query('select id from ai_connections where id = $1', [existing])).rows,
      ).toHaveLength(1);

      const triggers = await client.query<{ count: number }>(
        `select count(*)::int as count from pg_trigger where tgname in ('ai_connections_kind_guard', 'ai_connection_agencies_kind_guard', 'ai_connection_agencies_removed', 'ai_connection_agencies_fixed')`,
      );
      expect(triggers.rows[0]?.count).toBe(4);
    },
    MIGRATION_TIMEOUT_MS,
  );
});
