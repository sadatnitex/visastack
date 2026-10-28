import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

const MIGRATION_TIMEOUT_MS = 120_000;

describe('migration 0100: AI connections (S13)', () => {
  it(
    'creates the three tables, is safe to run again, and holds the token rules',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder });

      // Production applies each statement on its own; running the whole file again must not fail.
      const sql = readFileSync(join(migrationsFolder, '0100_ai_connections.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) await client.exec(statement);

      const account = (
        await client.query<{ id: string }>(
          `insert into accounts (email) values ('ai-migration@example.test') returning id`,
        )
      ).rows[0]?.id;
      const applicant = (
        await client.query<{ id: string }>(
          `insert into applicants (owner_account_id, display_name)
           values ('${account}', 'Synthetic Traveller') returning id`,
        )
      ).rows[0]?.id;
      expect(account && applicant).toBeTruthy();

      const connection = (mode = 'ALL_CURRENT', extra = '') =>
        client.query<{ id: string }>(
          `insert into ai_connections (account_id, applicant_id, client_id, client_name, client_host,
             case_mode${extra ? `, ${extra.split('=')[0]}` : ''})
           values ('${account}', '${applicant}', 'https://claude.ai/x', 'Claude', 'claude.ai',
             '${mode}'${extra ? `, ${extra.split('=')[1]}` : ''})
           returning id`,
        );
      const id = (await connection()).rows[0]?.id;
      const mission = (
        await client.query<{ id: string }>(
          `insert into missions (applicant_id, title) values ('${applicant}', 'UK Visit') returning id`,
        )
      ).rows[0]?.id;
      // A chosen case only with "one case" (a real case of the same record, so only the check
      // can refuse it); depth stays within its three words.
      await connection('ONE', `mission_id='${mission}'`);
      await expect(connection('ALL_CURRENT', `mission_id='${mission}'`)).rejects.toThrow();
      await expect(connection('ALL_CURRENT', `depth='everything'`)).rejects.toThrow();

      const token = (hash: string, kind = 'ACCESS', extra = '') =>
        client.query(
          `insert into ai_connection_tokens (connection_id, kind, token_hash, family_id, resource,
             expires_at${extra ? `, ${extra.split('=')[0]}` : ''})
           values ('${id}', '${kind}', '${hash}', gen_random_uuid(), 'https://vs.example.test/mcp',
             now() + interval '1 hour'${extra ? `, ${extra.split('=')[1]}` : ''})`,
        );
      await token('hash-1');
      // A token hash is unique; a code always carries its PKCE challenge and return address.
      await expect(token('hash-1')).rejects.toThrow();
      await expect(token('hash-2', 'CODE')).rejects.toThrow();

      // Deleting the record removes its connections and their tokens.
      await client.query(`delete from applicants where id = '${applicant}'`);
      const left = await client.query<{ n: number }>(
        'select (select count(*) from ai_connections)::int + (select count(*) from ai_connection_tokens)::int as n',
      );
      expect(left.rows[0]?.n).toBe(0);

      await client.query(
        `insert into oauth_clients (client_id, client_name, redirect_uris)
         values ('vsc_test', 'AI App', array['http://localhost/callback'])`,
      );
      await expect(
        client.query(
          `insert into oauth_clients (client_id, client_name, redirect_uris)
           values ('vsc_test', 'AI App', array['http://localhost/callback'])`,
        ),
      ).rejects.toThrow();
    },
    MIGRATION_TIMEOUT_MS,
  );
});
