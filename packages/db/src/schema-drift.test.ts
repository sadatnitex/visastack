import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MigrationJournalEntry } from './migration-status';
import { migrationsFolder as shippedMigrationsFolder } from './paths';

/*
 * Schema and migration drift guard.
 *
 * `src/schema.ts` is what the code believes the database looks like; `migrations/` is what
 * production actually receives. If someone edits the schema and forgets
 * `pnpm --filter @visastack/db db:generate`, the code ships expecting tables or columns that
 * were never created. This test runs `drizzle-kit generate` against a throwaway copy of the
 * committed migrations and fails if it would write anything new.
 *
 * - Offline: drizzle-kit diffs the schema against the latest snapshot in migrations/meta, so no
 *   database or network is needed.
 * - Same settings as `db:generate`: the real drizzle.config.ts is loaded and only `schema`
 *   (made absolute) and `out` (pointed at the temp copy) are replaced.
 * - The real migrations folder is never written to. drizzle-kit only accepts a relative `out`
 *   path (an absolute one is mangled into "./" + path), so it runs with its working directory
 *   set to the temp folder.
 * - Fails closed. drizzle-kit exits 0 even when it aborts, for example when a renamed or
 *   dropped column needs an interactive "rename or create?" answer and there is no terminal
 *   (stdin is closed here, so it can never hang waiting). A pass therefore needs all three:
 *   exit 0, no new or changed files, and drizzle-kit's own "No schema changes" line.
 * - drizzle-kit picks the newest file in migrations/meta as its comparison point, so the first
 *   test also proves meta holds exactly the journal's snapshots and nothing left over.
 */

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const configFile = join(packageRoot, 'drizzle.config.ts');
const drizzleKitBin = join(packageRoot, 'node_modules', 'drizzle-kit', 'bin.cjs');

const NO_CHANGES_MARKER = 'No schema changes, nothing to migrate';
const INTERACTIVE_MARKER = /Interactive prompts require a TTY/i;
const FIX_COMMAND = 'pnpm --filter @visastack/db db:generate';
const GENERATE_TIMEOUT_MS = 120_000;

interface JournalEntry extends MigrationJournalEntry {
  readonly idx: number;
}

interface DrizzleConfig {
  readonly schema: string | readonly string[];
  readonly out: string;
  readonly [key: string]: unknown;
}

async function loadConfig(): Promise<DrizzleConfig> {
  // A runtime path, not a static import: the config sits outside this package's `src` rootDir.
  const loaded = (await import(pathToFileURL(configFile).href)) as { default: DrizzleConfig };
  return loaded.default;
}

function fromPackage(path: string): string {
  return isAbsolute(path) ? path : resolve(packageRoot, path);
}

function readJournal(folder: string): JournalEntry[] {
  const raw = readFileSync(join(folder, 'meta', '_journal.json'), 'utf8');
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

/** Every file under `folder`, relative to it, mapped to its contents. */
function snapshotFolder(folder: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath, entry.name);
    files.set(full.slice(folder.length + 1), readFileSync(full, 'utf8'));
  }
  return files;
}

function runGenerate(cwd: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [drizzleKitBin, 'generate', '--config', 'config.json'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GENERATE_TIMEOUT_MS,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolvePromise({ code: signal ? null : code, output });
    });
  });
}

describe('schema and migrations agree', () => {
  it('the journal, SQL files and snapshots line up, in order, with nothing left over', async () => {
    const migrationsFolder = fromPackage((await loadConfig()).out);
    // What `db:generate` writes must be what production migrates from, or this guard checks the
    // wrong folder.
    expect(
      resolve(migrationsFolder),
      'drizzle.config.ts "out" must be the folder src/paths.ts ships',
    ).toBe(resolve(shippedMigrationsFolder));
    const journal = readJournal(migrationsFolder);

    expect(
      journal.map((entry) => entry.idx),
      'journal idx must run 0, 1, 2, ... with no gaps',
    ).toEqual(journal.map((_, index) => index));
    for (let index = 1; index < journal.length; index += 1) {
      const previous = journal[index - 1];
      const current = journal[index];
      // The migrator skips any entry whose `when` is not newer than the last one applied.
      expect(
        current && previous && current.when > previous.when,
        `journal "when" must strictly increase (${previous?.tag} -> ${current?.tag})`,
      ).toBe(true);
    }

    const sqlFiles = readdirSync(migrationsFolder).filter((name) => name.endsWith('.sql'));
    expect(sqlFiles.sort(), 'SQL files on disk must match migrations/meta/_journal.json').toEqual(
      journal.map((entry) => `${entry.tag}.sql`).sort(),
    );

    const metaFiles = readdirSync(join(migrationsFolder, 'meta'));
    const expectedMeta = journal.map(
      (entry) => `${String(entry.idx).padStart(4, '0')}_snapshot.json`,
    );
    expect(
      metaFiles.sort(),
      'migrations/meta must hold exactly _journal.json plus one snapshot per journal entry',
    ).toEqual(['_journal.json', ...expectedMeta].sort());
  });

  it(
    'drizzle-kit generate would not produce a new migration',
    async () => {
      const config = await loadConfig();
      const migrationsFolder = fromPackage(config.out);
      const schema =
        typeof config.schema === 'string'
          ? fromPackage(config.schema)
          : config.schema.map(fromPackage);

      const workDir = mkdtempSync(join(tmpdir(), 'visastack-schema-drift-'));
      try {
        const workMigrations = join(workDir, 'migrations');
        cpSync(migrationsFolder, workMigrations, { recursive: true });
        writeFileSync(
          join(workDir, 'config.json'),
          JSON.stringify({ ...config, schema, out: './migrations' }),
        );

        const result = await runGenerate(workDir);
        // drizzle-kit's own stack frames are dropped: they say nothing useful here, and vitest
        // tries to source-map any "at file:line:col" line in an error message and crashes on them.
        const output = result.output
          .split('\n')
          .filter((line) => !/^\s+at\s/.test(line))
          .join('\n')
          .trim();

        const before = snapshotFolder(migrationsFolder);
        const after = snapshotFolder(workMigrations);
        const added = [...after.keys()].filter((file) => !before.has(file)).sort();
        const changed = [...before.keys()]
          .filter((file) => after.has(file) && after.get(file) !== before.get(file))
          .sort();
        const removed = [...before.keys()].filter((file) => !after.has(file)).sort();

        const problems: string[] = [];
        if (result.code !== 0) problems.push(`drizzle-kit exited with status ${result.code}`);
        if (added.length > 0) problems.push(`it would add: ${added.join(', ')}`);
        if (changed.length > 0) problems.push(`it would change: ${changed.join(', ')}`);
        if (removed.length > 0) problems.push(`it would remove: ${removed.join(', ')}`);
        if (!output.includes(NO_CHANGES_MARKER)) {
          problems.push(
            INTERACTIVE_MARKER.test(output)
              ? 'it stopped to ask a question (usually "was this column or table renamed?"), which means the schema changed'
              : `its output did not confirm "${NO_CHANGES_MARKER}"`,
          );
        }

        if (problems.length > 0) {
          const pendingSql = added
            .filter((file) => file.endsWith('.sql'))
            .map(
              (file) => `--- ${file} (would be generated) ---\n${after.get(file)?.slice(0, 4000)}`,
            );
          throw new Error(
            [
              'packages/db/src/schema.ts and packages/db/migrations do not match.',
              ...problems.map((problem) => `  - ${problem}`),
              '',
              `Fix: run \`${FIX_COMMAND}\` in a terminal (answer any rename questions), review the`,
              'new SQL file, and commit it together with the updated migrations/meta files.',
              '',
              ...pendingSql,
              '--- drizzle-kit output (last 4000 characters) ---',
              output.slice(-4000),
            ].join('\n'),
          );
        }
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
    GENERATE_TIMEOUT_MS + 30_000,
  );
});
