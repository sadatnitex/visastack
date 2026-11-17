import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';
import { createMigratedPglite } from './testing';

/** Web Push subscriptions (WP-PIC18). Found by what it creates, never by its number. */
function migrationFile(): string {
  const file = readdirSync(migrationsFolder)
    .filter((name) => name.endsWith('.sql'))
    .find((name) =>
      readFileSync(join(migrationsFolder, name), 'utf8').includes(
        'CREATE TABLE IF NOT EXISTS "web_push_subscriptions"',
      ),
    );
  if (!file) throw new Error('the web push subscriptions migration is missing');
  return readFileSync(join(migrationsFolder, file), 'utf8');
}

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

const insertRow = (hash: string, failures = 0) => `
  insert into web_push_subscriptions
    (account_id, endpoint_hash, endpoint_ciphertext, endpoint_nonce, keys_ciphertext, keys_nonce, key_version, failure_count)
  values ('${ACCOUNT}', '${hash}', '\\x01', '\\x02', '\\x03', '\\x04', 'v1', ${failures})`;

describe('web push subscriptions migration', () => {
  it('creates one table and changes no existing table', () => {
    const sql = migrationFile();
    const touched = [
      ...sql.matchAll(/(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE) "([a-z_]+)"/g),
    ].map((m) => m[1]);
    expect(new Set(touched)).toEqual(new Set(['web_push_subscriptions']));
    const body = sql.replace(/ON (DELETE|UPDATE) (cascade|no action)/g, '');
    expect(body).not.toMatch(/\b(DROP|UPDATE|DELETE)\b/);
  });

  it('runs twice without error', async () => {
    const client = await createMigratedPglite();
    const statements = migrationFile()
      .split('--> statement-breakpoint')
      .map((part) => part.trim())
      .filter(Boolean);
    for (const statement of statements) await client.exec(statement);
    const result = await client.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables where table_name = 'web_push_subscriptions'`,
    );
    expect(result.rows[0]?.n).toBe(1);
  });

  it('keeps one row per address, refuses negative failures and leaves with the account', async () => {
    const client = await createMigratedPglite();
    await client.exec(
      `insert into accounts (id, email) values ('${ACCOUNT}', 'owner@example.com')`,
    );
    await client.exec(insertRow('a'));
    await expect(client.exec(insertRow('a'))).rejects.toThrow();
    await expect(client.exec(insertRow('b', -1))).rejects.toThrow();
    await client.exec(`delete from accounts where id = '${ACCOUNT}'`);
    const left = await client.query<{ n: number }>(
      'select count(*)::int as n from web_push_subscriptions',
    );
    expect(left.rows[0]?.n).toBe(0);
  });
});
