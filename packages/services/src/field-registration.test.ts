import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db';
import { registerFieldDefinition, registerFieldDefinitions } from './profile';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

describe('registerFieldDefinitions: many fields at once', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('adds only what is missing and reports how many', async () => {
    await registerFieldDefinition(db, { key: 'already_there', dataType: 'string' });
    const added = await registerFieldDefinitions(db, [
      { key: 'already_there', dataType: 'string' },
      { key: 'new_one', dataType: 'string', sensitivity: 'SENSITIVE', packId: 'study' },
      { key: 'new_date', dataType: 'date', repeating: true },
    ]);
    expect(added).toBe(2);
    const rows = await db.select().from(schema.fieldDefinitions);
    expect(rows.map((row) => row.key).sort()).toEqual(['already_there', 'new_date', 'new_one']);
    const sensitive = rows.find((row) => row.key === 'new_one');
    expect(sensitive?.sensitivity).toBe('SENSITIVE');
    expect(sensitive?.packId).toBe('study');
    expect(rows.find((row) => row.key === 'new_date')?.repeating).toBe(true);
  });

  it('never changes a field that is already registered (first writer wins)', async () => {
    await registerFieldDefinition(db, {
      key: 'kept',
      dataType: 'string',
      sensitivity: 'RESTRICTED',
      packId: 'universal',
    });
    const added = await registerFieldDefinitions(db, [
      { key: 'kept', dataType: 'date', sensitivity: 'STANDARD', packId: 'study' },
    ]);
    expect(added).toBe(0);
    const [row] = await db
      .select()
      .from(schema.fieldDefinitions)
      .where(eq(schema.fieldDefinitions.key, 'kept'));
    expect(row?.sensitivity).toBe('RESTRICTED');
    expect(row?.packId).toBe('universal');
    expect(row?.dataType).toBe('string');
  });

  it('is safe to run twice, with repeats in the list, and with an empty list', async () => {
    const list = [
      { key: 'twice', dataType: 'string' },
      { key: 'twice', dataType: 'string' },
    ];
    expect(await registerFieldDefinitions(db, list)).toBe(1);
    expect(await registerFieldDefinitions(db, list)).toBe(0);
    expect(await registerFieldDefinitions(db, [])).toBe(0);
    expect(await db.select().from(schema.fieldDefinitions)).toHaveLength(1);
  });
});
