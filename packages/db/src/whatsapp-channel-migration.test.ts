import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

const MIGRATION_TIMEOUT_MS = 120_000;

describe('migration 0095: WhatsApp channel (Lane D)', () => {
  it(
    'creates the channel tables, is safe to run again, and holds the identity rules',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder });

      // Production applies each statement on its own; running the whole file again must not fail.
      const sql = readFileSync(join(migrationsFolder, '0095_whatsapp_channel.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) await client.exec(statement);

      const account = (
        await client.query<{ id: string }>(
          `insert into accounts (email) values ('wa-migration@example.test') returning id`,
        )
      ).rows[0]?.id;
      const identity = (sender: string, status: string, accountId: string | null) =>
        client.query(
          `insert into channel_identities (provider_scope, external_user_id, status, account_id)
           values ('106540352242922', '${sender}', '${status}', ${accountId ? `'${accountId}'` : 'null'})`,
        );

      await identity('BD.1', 'PROVISIONAL', null);
      // The same sender on the same business number is one identity.
      await expect(identity('BD.1', 'PROVISIONAL', null)).rejects.toThrow();
      // Linked means exactly one account; anything else means none.
      await expect(identity('BD.2', 'LINKED', null)).rejects.toThrow();
      await expect(identity('BD.3', 'PROVISIONAL', account ?? null)).rejects.toThrow();
      await identity('BD.4', 'LINKED', account ?? null);
      // One linked WhatsApp per account.
      await expect(identity('BD.5', 'LINKED', account ?? null)).rejects.toThrow();
      await expect(identity('BD.6', 'BLOCKED', null)).rejects.toThrow();
      await expect(
        client.query(
          `insert into channel_identities (provider_scope, external_user_id, phone_last4)
           values ('106540352242922', 'BD.7', '12a4')`,
        ),
      ).rejects.toThrow();

      // A message id is recorded once; a repeated delivery is a conflict, not a second row.
      const identityId = (
        await client.query<{ id: string }>(
          `select id from channel_identities where external_user_id = 'BD.4'`,
        )
      ).rows[0]?.id;
      const message = () =>
        client.query(
          `insert into channel_messages (identity_id, direction, provider_message_id, kind, state)
           values ('${identityId}', 'IN', 'wamid.same', 'text', 'RECEIVED')`,
        );
      await message();
      await expect(message()).rejects.toThrow();

      // The inbox keeps an encrypted payload whole or not at all.
      await expect(
        client.query(
          `insert into channel_webhook_events (event_hash, payload_ciphertext) values ('h1', '\\x00')`,
        ),
      ).rejects.toThrow();

      // Closing an account removes its WhatsApp connection and codes with it.
      await client.query(
        `insert into channel_link_codes (account_id, code_hash, opt_in_version, expires_at)
         values ('${account}', 'hash', 'v1', now())`,
      );
      await client.query(`delete from accounts where id = '${account}'`);
      const left = await client.query<{ n: number }>(
        `select (select count(*) from channel_identities where external_user_id = 'BD.4')::int
              + (select count(*) from channel_link_codes)::int as n`,
      );
      expect(left.rows[0]?.n).toBe(0);
    },
    MIGRATION_TIMEOUT_MS,
  );
});
