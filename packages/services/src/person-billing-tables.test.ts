import { createMigratedPglite } from '@visastack/db/testing';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { PERSON_BILLING_TABLES } from './person-billing-tables';

/**
 * ADR 0025: the person billing declarations are a second view of the real billing tables, so they
 * must match the migrated database exactly: every column, its nullability and its type, and no
 * column left out. A migration that changes one of these tables fails here until the declaration
 * follows it.
 */

describe('the person billing declarations match the database (ADR 0025)', () => {
  it('declares every column of each table with its nullability and type, and nothing else', async () => {
    const client = await createMigratedPglite();
    try {
      expect(PERSON_BILLING_TABLES).toHaveLength(6);
      for (const table of PERSON_BILLING_TABLES) {
        const config = getTableConfig(table);
        const rows = await client.query<{
          column_name: string;
          is_nullable: string;
          data_type: string;
          udt_name: string;
        }>(
          `select column_name, is_nullable, data_type, udt_name from information_schema.columns where table_schema = 'public' and table_name = '${config.name}'`,
        );
        expect(rows.rows.length, `${config.name} exists`).toBeGreaterThan(0);
        const actual = Object.fromEntries(
          rows.rows.map((c) => [
            c.column_name,
            {
              nullable: c.is_nullable === 'YES',
              type: c.data_type === 'USER-DEFINED' ? c.udt_name : c.data_type,
            },
          ]),
        );
        const declared = Object.fromEntries(
          config.columns.map((c) => {
            const enumName = (c as { enum?: { enumName?: string } }).enum?.enumName;
            const type = enumName ?? c.getSQLType();
            return [c.name, { nullable: !c.notNull, type }];
          }),
        );
        expect(declared, `${config.name} columns`).toEqual(actual);
      }
    } finally {
      await client.close();
    }
  }, 60_000);
});
