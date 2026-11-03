import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  REQUIREMENT_GROUP_MODES,
  REQUIREMENT_NECESSITIES,
  REQUIREMENT_PROVENANCES,
} from '@visastack/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

/**
 * Migration 0116 (UMPE P1): necessity, provenance and alternative groups on pack requirements,
 * and the manifest format on pack versions. Additive, nullable, re-runnable, and it leaves every
 * existing row exactly as it was.
 */

const MIGRATION_TIMEOUT_MS = 180_000;
const FILE = '0116_p1_requirement_necessity';

function statements(): string[] {
  return readFileSync(join(migrationsFolder, `${FILE}.sql`), 'utf8').split(
    '--> statement-breakpoint',
  );
}

/** A copy of the migrations folder holding every migration before 0116. */
function folderBefore(): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  const at = journal.entries.findIndex((e: { tag: string }) => e.tag === FILE);
  if (at === -1) throw new Error(`${FILE} is not in the journal`);
  const prior = journal.entries.slice(0, at) as { tag: string }[];
  const folder = mkdtempSync(join(tmpdir(), 'visastack-0116-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: prior }));
  for (const entry of prior) {
    copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

async function enumValues(client: PGlite, name: string): Promise<string[]> {
  const result = await client.query<{ value: string }>(
    `select e.enumlabel as value from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = $1 order by e.enumsortorder`,
    [name],
  );
  return result.rows.map((r) => r.value);
}

describe('migration 0116: requirement necessity (UMPE P1)', () => {
  it(
    'runs twice, adds only nullable columns, keeps old rows and pairs group key with mode',
    async () => {
      const client = new PGlite();
      const folder = folderBefore();
      try {
        await migrate(drizzle(client), { migrationsFolder: folder });
        // A pack, a version and a legacy requirement written before the migration.
        const pack = await client.query<{ id: string }>(
          "insert into packs (key, name) values ('synthetic.p1', 'Synthetic P1') returning id",
        );
        const version = await client.query<{ id: string }>(
          'insert into pack_versions (pack_id, version) values ($1, 1) returning id',
          [pack.rows[0]?.id],
        );
        const versionId = version.rows[0]?.id;
        await client.query(
          `insert into pack_requirements (pack_version_id, kind, doc_type, citation, optional)
           values ($1, 'DOCUMENT', 'bank_statement', 'Synthetic rule 1', true)`,
          [versionId],
        );

        for (let run = 0; run < 2; run++) {
          for (const statement of statements()) await client.exec(statement);
        }

        // The enum words are exactly the shared definition's.
        expect(await enumValues(client, 'requirement_necessity')).toEqual([
          ...REQUIREMENT_NECESSITIES,
        ]);
        // 0116's own words; a later migration (UMPE G2) appends FIELD_OBSERVATION to the shared list.
        expect(await enumValues(client, 'requirement_provenance')).toEqual(
          REQUIREMENT_PROVENANCES.filter((word) => word !== 'FIELD_OBSERVATION'),
        );
        expect(await enumValues(client, 'requirement_group_mode')).toEqual([
          ...REQUIREMENT_GROUP_MODES,
        ]);

        const columns = await client.query<{
          table_name: string;
          column_name: string;
          is_nullable: string;
          column_default: string | null;
        }>(
          `select table_name, column_name, is_nullable, column_default from information_schema.columns
           where (table_name = 'pack_requirements' and column_name in ('necessity', 'provenance', 'group_key', 'group_mode'))
              or (table_name = 'pack_versions' and column_name = 'manifest_format')
           order by table_name, column_name`,
        );
        expect(columns.rows).toEqual([
          {
            table_name: 'pack_requirements',
            column_name: 'group_key',
            is_nullable: 'YES',
            column_default: null,
          },
          {
            table_name: 'pack_requirements',
            column_name: 'group_mode',
            is_nullable: 'YES',
            column_default: null,
          },
          {
            table_name: 'pack_requirements',
            column_name: 'necessity',
            is_nullable: 'YES',
            column_default: null,
          },
          {
            table_name: 'pack_requirements',
            column_name: 'provenance',
            is_nullable: 'YES',
            column_default: null,
          },
          {
            table_name: 'pack_versions',
            column_name: 'manifest_format',
            is_nullable: 'YES',
            column_default: null,
          },
        ]);

        // The old row is untouched: every new field is empty, its optional flag unchanged.
        const old = await client.query(
          'select optional, necessity, provenance, group_key, group_mode from pack_requirements',
        );
        expect(old.rows).toEqual([
          { optional: true, necessity: null, provenance: null, group_key: null, group_mode: null },
        ]);
        const oldVersion = await client.query('select manifest_format from pack_versions');
        expect(oldVersion.rows).toEqual([{ manifest_format: null }]);

        // Group key and mode come together; unknown words are refused.
        const insert = (extra: string, values: string) =>
          client.query(
            `insert into pack_requirements (pack_version_id, kind, doc_type, citation${extra})
             values ($1, 'DOCUMENT', 'sponsor_letter', 'Synthetic rule 2'${values})`,
            [versionId],
          );
        await expect(insert(', group_key', ", 'funds'")).rejects.toThrow();
        await expect(insert(', group_mode', ", 'ANY_OF'")).rejects.toThrow();
        await expect(insert(', necessity', ", 'ALTERNATIVE_GROUP'")).rejects.toThrow();
        await expect(insert(', provenance', ", 'ADDITIONAL_REQUEST'")).rejects.toThrow();
        await insert(
          ', necessity, provenance, group_key, group_mode',
          ", 'MANDATORY', 'OFFICIAL', 'funds', 'ANY_OF'",
        );
      } finally {
        await client.close();
        rmSync(folder, { recursive: true, force: true });
      }
    },
    MIGRATION_TIMEOUT_MS,
  );
});
