import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REQUIREMENT_PROVENANCES } from '@visastack/core';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';
import { createMigratedPglite } from './testing';

/**
 * The UMPE G2 migration (rule details, route conditions, the FIELD_OBSERVATION provenance). Found by
 * what it creates, never by its number: the lead renumbers migrations in merge order.
 */
function g2Statements(): string[] {
  const file = readdirSync(migrationsFolder)
    .filter((name) => name.endsWith('.sql'))
    .find((name) =>
      readFileSync(join(migrationsFolder, name), 'utf8').includes(
        'CREATE TABLE IF NOT EXISTS "pack_route_conditions"',
      ),
    );
  if (!file) throw new Error('the G2 migration is missing');
  return readFileSync(join(migrationsFolder, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

describe('UMPE G2 migration', () => {
  it('adds the provenance word and both side tables, and runs again without harm', async () => {
    const client = await createMigratedPglite();
    for (const statement of g2Statements()) await client.exec(statement);
    const words = await client.query<{ word: string }>(
      `select e.enumlabel as word from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = 'requirement_provenance' order by e.enumsortorder`,
    );
    expect(words.rows.map((row) => row.word)).toEqual([...REQUIREMENT_PROVENANCES]);
    const tables = await client.query<{ name: string }>(
      `select table_name as name from information_schema.tables
       where table_name in ('pack_requirement_details', 'pack_route_conditions') order by 1`,
    );
    expect(tables.rows.map((row) => row.name)).toEqual([
      'pack_requirement_details',
      'pack_route_conditions',
    ]);
    // Unknown words, out-of-range months and a reversed window are refused by the database itself.
    const checks = await client.query<{ name: string }>(
      `select conname as name from pg_constraint where conname like 'pack_requirement_details_%' or conname like 'pack_route_conditions_%' order by 1`,
    );
    expect(checks.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'pack_requirement_details_accepted_form_known',
        'pack_requirement_details_category_known',
        'pack_requirement_details_statement_period_range',
        'pack_requirement_details_valid_after_travel_range',
        'pack_route_conditions_window_order',
      ]),
    );
  }, 60_000);
});
