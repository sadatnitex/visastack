import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';
import { createMigratedPglite } from './testing';

/** Passkeys that confirm sensitive actions (Q8, ADR 0028). Found by what it creates, never by its number. */
function migrationFile(): string {
  const file = readdirSync(migrationsFolder)
    .filter((name) => name.endsWith('.sql'))
    .find((name) =>
      readFileSync(join(migrationsFolder, name), 'utf8').includes(
        'CREATE TABLE IF NOT EXISTS "passkey_credentials"',
      ),
    );
  if (!file) throw new Error('the passkey credentials migration is missing');
  return readFileSync(join(migrationsFolder, file), 'utf8');
}

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

const insertRow = (
  credentialId: string,
  overrides: { label?: string; device?: string; count?: number } = {},
) => `
  insert into passkey_credentials
    (account_id, credential_id, public_key, sign_count, device_type, label)
  values ('${ACCOUNT}', '${credentialId}', '\\x01', ${overrides.count ?? 0},
    '${overrides.device ?? 'multiDevice'}', '${overrides.label ?? 'Phone'}')`;

describe('passkey credentials migration', () => {
  it('creates one table and changes no existing table', () => {
    const sql = migrationFile();
    const touched = [
      ...sql.matchAll(/(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE) "([a-z_]+)"/g),
    ].map((m) => m[1]);
    expect(new Set(touched)).toEqual(new Set(['passkey_credentials']));
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
      `select count(*)::int as n from information_schema.tables where table_name = 'passkey_credentials'`,
    );
    expect(result.rows[0]?.n).toBe(1);
  });

  it('keeps one row per passkey, refuses bad values and leaves with the account', async () => {
    const client = await createMigratedPglite();
    await client.exec(
      `insert into accounts (id, email) values ('${ACCOUNT}', 'owner@example.com')`,
    );
    await client.exec(insertRow('a'));
    await expect(client.exec(insertRow('a'))).rejects.toThrow();
    await expect(client.exec(insertRow('b', { count: -1 }))).rejects.toThrow();
    await expect(client.exec(insertRow('c', { label: '' }))).rejects.toThrow();
    await expect(client.exec(insertRow('d', { label: 'x'.repeat(61) }))).rejects.toThrow();
    await expect(client.exec(insertRow('e', { device: 'laptop' }))).rejects.toThrow();
    await expect(client.exec(insertRow(''))).rejects.toThrow();
    await client.exec(`delete from accounts where id = '${ACCOUNT}'`);
    const left = await client.query<{ n: number }>(
      'select count(*)::int as n from passkey_credentials',
    );
    expect(left.rows[0]?.n).toBe(0);
  });
});
