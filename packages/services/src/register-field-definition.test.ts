import type { PGlite } from '@electric-sql/pglite';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import type { Db } from './db';
import { registerFieldDefinition } from './profile';

/**
 * Two first saves of the same detail can race (for example two AI app suggestions at once, S21
 * round 3): both see no definition, both insert. The second must get the row that won, never a
 * unique-key error that would fail its whole transaction.
 */
describe('registerFieldDefinition when two first saves race', () => {
  it('returns the row someone else registered between the check and the insert', async () => {
    const client: PGlite = await createMigratedPglite();
    let raced: Promise<unknown> | undefined;
    // Just before this call's insert is sent, another writer's insert of the same key is queued
    // ahead of it on the same database, as a concurrent first save would land.
    const db = drizzle(client, {
      schema,
      logger: {
        logQuery: (query) => {
          if (!raced && query.startsWith('insert into "field_definitions"')) {
            raced = client.query(
              `insert into field_definitions (key, data_type, sensitivity) values ('phone', 'string', 'SENSITIVE')`,
            );
          }
        },
      },
    }) as unknown as Db;
    const definition = await registerFieldDefinition(db, {
      key: 'phone',
      dataType: 'string',
      sensitivity: 'STANDARD',
    });
    await raced;
    expect(raced).toBeDefined();
    // The winner's row, unchanged, and only one of it.
    expect(definition).toMatchObject({ key: 'phone', sensitivity: 'SENSITIVE' });
    const rows = await db
      .select()
      .from(schema.fieldDefinitions)
      .where(eq(schema.fieldDefinitions.key, 'phone'));
    expect(rows).toHaveLength(1);
  });

  it('still registers a new key, and returns an existing one as it is', async () => {
    const db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
    const created = await registerFieldDefinition(db, { key: 'home_city', dataType: 'string' });
    expect(created).toMatchObject({ key: 'home_city', sensitivity: 'STANDARD', repeating: false });
    const again = await registerFieldDefinition(db, {
      key: 'home_city',
      dataType: 'date',
      sensitivity: 'RESTRICTED',
    });
    expect(again).toEqual(created);
  });
});
