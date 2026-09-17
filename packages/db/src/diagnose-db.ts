import { neon } from '@neondatabase/serverless';
import { DATABASE_URL_ENV_CANDIDATES, resolveDatabaseUrl } from './client';

/**
 * READ-ONLY diagnostic, temporary like repair-migration-tracking.ts (deleted
 * alongside it once this incident is resolved). Exists because the repair run
 * on 2026-09-17 hit "type \"permission_action\" does not exist" while creating
 * support_grants (migration 0028) even though that type is the very first
 * statement in migration 0000, and the tracking table claims migrations
 * 0000-0027 already applied. That combination only makes sense if this
 * connection is not the database everyone assumes it is, so before writing
 * anything else, establish hard facts about what this connection actually
 * sees. No statement here does anything but select from catalogs/tables.
 */

interface IdentityRow {
  readonly db: string;
  readonly usr: string;
  readonly server_addr: string | null;
  readonly pg_version: string;
}

interface SearchPathRow {
  readonly search_path: string;
}

interface EnumRow {
  readonly schema: string;
  readonly name: string;
}

interface TableRow {
  readonly table_schema: string;
  readonly table_name: string;
}

interface CountRow {
  readonly n: number;
}

interface TrackingRow {
  readonly id: number;
  readonly hash: string;
  readonly created_at: string | number;
}

interface AllTableRow {
  readonly table_name: string;
}

interface ColumnRow {
  readonly column_name: string;
  readonly data_type: string;
  readonly is_nullable: string;
}

async function main(): Promise<void> {
  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    throw new Error(
      `No database connection string found. Set one of these as a repository Actions secret: ${DATABASE_URL_ENV_CANDIDATES.join(', ')}.`,
    );
  }
  const sql = neon(connectionString);

  const identity = (await sql(
    'select current_database() as db, current_user as usr, inet_server_addr()::text as server_addr, version() as pg_version',
  )) as unknown as ReadonlyArray<IdentityRow>;
  process.stdout.write(`connection identity: ${JSON.stringify(identity[0])}\n`);

  const searchPath = (await sql('show search_path')) as unknown as ReadonlyArray<SearchPathRow>;
  process.stdout.write(`search_path: ${JSON.stringify(searchPath[0])}\n`);

  const enums = (await sql(
    `select n.nspname as schema, t.typname as name
     from pg_type t
     join pg_namespace n on n.oid = t.typnamespace
     where t.typtype = 'e'
     order by n.nspname, t.typname`,
  )) as unknown as ReadonlyArray<EnumRow>;
  process.stdout.write(`\nenum types found (${enums.length}):\n`);
  for (const row of enums) process.stdout.write(`  ${row.schema}.${row.name}\n`);

  const expectedTables = [
    'accounts',
    'applicants',
    'organizations',
    'memberships',
    'missions',
    'documents',
    'fact_versions',
    'case_access_grants',
    'support_grants',
    'data_keys',
  ];
  const tables = (await sql(
    `select table_schema, table_name
     from information_schema.tables
     where table_name = any($1)
     order by table_name`,
    [expectedTables],
  )) as unknown as ReadonlyArray<TableRow>;
  const foundNames = new Set(tables.map((t) => t.table_name));
  process.stdout.write(`\nexpected tables present (${tables.length}/${expectedTables.length}):\n`);
  for (const row of tables) process.stdout.write(`  ${row.table_schema}.${row.table_name}\n`);
  const missing = expectedTables.filter((t) => !foundNames.has(t));
  if (missing.length > 0) {
    process.stdout.write(`missing entirely: ${missing.join(', ')}\n`);
  }

  for (const name of ['accounts', 'applicants', 'documents', 'organizations']) {
    if (!foundNames.has(name)) continue;
    const counts = (await sql(
      `select count(*)::int as n from ${name}`,
    )) as unknown as ReadonlyArray<CountRow>;
    process.stdout.write(`${name} row count: ${counts[0]?.n}\n`);
  }

  const allTables = (await sql(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`,
  )) as unknown as ReadonlyArray<AllTableRow>;
  process.stdout.write(`\nALL tables actually in public schema (${allTables.length}):\n`);
  for (const row of allTables) process.stdout.write(`  ${row.table_name}\n`);

  for (const name of ['accounts', 'documents', 'organizations']) {
    if (!foundNames.has(name)) continue;
    const columns = (await sql(
      `select column_name, data_type, is_nullable
       from information_schema.columns
       where table_schema = 'public' and table_name = $1
       order by ordinal_position`,
      [name],
    )) as unknown as ReadonlyArray<ColumnRow>;
    process.stdout.write(`\n${name} columns (${columns.length}):\n`);
    for (const row of columns) {
      process.stdout.write(
        `  ${row.column_name} ${row.data_type} ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}\n`,
      );
    }
  }

  try {
    const tracking = (await sql(
      'select id, hash, created_at from drizzle.__drizzle_migrations order by created_at asc',
    )) as unknown as ReadonlyArray<TrackingRow>;
    process.stdout.write(`\ndrizzle.__drizzle_migrations rows (${tracking.length}):\n`);
    for (const row of tracking) {
      process.stdout.write(`  id=${row.id} created_at=${row.created_at} hash=${row.hash}\n`);
    }
  } catch (error) {
    process.stdout.write(
      `\ndrizzle.__drizzle_migrations: not present (${(error as Error).message})\n`,
    );
  }

  process.stdout.write('\ndiagnostics complete\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`diagnostics failed: ${(error as Error).message}\n`);
  process.exit(1);
});
