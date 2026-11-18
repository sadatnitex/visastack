import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';
import { createMigratedPglite } from './testing';

/** Invitation decline (DECL1). Found by what it changes, never by its number. */
function migrationFile(): string {
  const file = readdirSync(migrationsFolder)
    .filter((name) => name.endsWith('.sql'))
    .find((name) =>
      readFileSync(join(migrationsFolder, name), 'utf8').includes(
        `ALTER TYPE "public"."client_invitation_status" ADD VALUE IF NOT EXISTS 'DECLINED'`,
      ),
    );
  if (!file) throw new Error('the invitation decline migration is missing');
  return readFileSync(join(migrationsFolder, file), 'utf8');
}

const statements = () =>
  migrationFile()
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter(Boolean);

describe('invitation decline migration', () => {
  it('only adds the DECLINED value and widens the sharing check', () => {
    const sql = migrationFile();
    const types = [...sql.matchAll(/ALTER TYPE "public"\."([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(types)).toEqual(
      new Set([
        'client_invitation_status',
        'contributor_request_status',
        'organization_invitation_status',
      ]),
    );
    const tables = [...sql.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(['sharing_invitations']));
    expect(sql).not.toMatch(/\b(ADD COLUMN|UPDATE|DELETE|DROP TABLE|DROP TYPE)\b/);
  });

  it('runs again from the top without error', async () => {
    const client = await createMigratedPglite();
    for (const statement of statements()) await client.exec(statement);
    const labels = await client.query<{ typname: string }>(
      `select t.typname from pg_enum e join pg_type t on t.oid = e.enumtypid
       where e.enumlabel = 'DECLINED' and t.typname in
         ('client_invitation_status', 'contributor_request_status', 'organization_invitation_status')
       order by t.typname`,
    );
    expect(labels.rows.map((row) => row.typname)).toEqual([
      'client_invitation_status',
      'contributor_request_status',
      'organization_invitation_status',
    ]);
  });

  it('lets a sharing invitation be DECLINED and still refuses other words', async () => {
    const client = await createMigratedPglite();
    const check = await client.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
       where conname = 'sharing_invitations_status_check'`,
    );
    expect(check.rows[0]?.def).toContain("'DECLINED'");
    expect(check.rows[0]?.def).not.toContain("'CANCELLED'");
  });
});
