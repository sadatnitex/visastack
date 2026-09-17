import { DATABASE_URL_ENV_CANDIDATES, createPooledDb, resolveDatabaseUrl } from '@visastack/db';
import { backfillProtectedFields } from '@visastack/services';
import { LocalEnvelopeKeyProvider } from './key-management';

/**
 * Retroactive protected-field encryption backfill (Commercial V1 SEC-03),
 * run deliberately (not on every deploy), same operating model as
 * `packages/db/src/migrate.ts`:
 *
 *   DATABASE_URL=... KMS_LOCAL_MASTER_KEY_BASE64=... BACKFILL_ACTOR_ACCOUNT_ID=... \
 *     pnpm --filter @visastack/adapters backfill:protected-fields [--dry-run] [--limit=N]
 *
 * Loops calling `backfillProtectedFields` until a call finds nothing left,
 * printing counts each round: the counts and reconciliation evidence the
 * Part 2 checkpoint requires. `BACKFILL_ACTOR_ACCOUNT_ID` must be a real
 * accounts.id (a platform admin's own account): every row this touches is
 * audited against it, and the foreign key rejects a placeholder.
 */

const DEFAULT_LIMIT = 200;

function readEnv(name: string): string | undefined {
  return process.env[name];
}

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`${name} is required to run the protected-field backfill`);
  }
  return value;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`--limit must be a positive integer, got: ${limitArg}`);
  }

  const connectionString = resolveDatabaseUrl(process.env);
  if (!connectionString) {
    throw new Error(
      `No database connection string found. Set one of: ${DATABASE_URL_ENV_CANDIDATES.join(', ')}.`,
    );
  }
  const actorAccountId = requireEnv('BACKFILL_ACTOR_ACCOUNT_ID');
  const masterKeyBase64 = requireEnv('KMS_LOCAL_MASTER_KEY_BASE64');
  const encryption = new LocalEnvelopeKeyProvider({ masterKeyBase64 });

  const { db, pool } = createPooledDb(connectionString);
  try {
    if (dryRun) {
      // A single call is enough: the plaintext backlog count is a true,
      // unbounded total, not paginated by `limit`. Looping here would
      // never terminate, since a dry run never advances the backlog and
      // every call would return the identical first page.
      const report = await backfillProtectedFields(db, encryption, { actorAccountId, dryRun });
      process.stdout.write(
        `dry run: ${report.alreadyProtectedCount} already protected, ` +
          `${report.plaintextBacklogCount} plaintext value(s) need encryption ` +
          `(showing ${report.plaintextFound.length} of them below), nothing modified\n`,
      );
      for (const row of report.plaintextFound) {
        process.stdout.write(
          `  ${row.fieldKey} (${row.sensitivity}) fact_version ${row.factVersionId}\n`,
        );
      }
      return;
    }

    let round = 0;
    let totalEncrypted = 0;
    let totalErrors = 0;
    for (;;) {
      round += 1;
      const report = await backfillProtectedFields(db, encryption, {
        actorAccountId,
        dryRun: false,
        limit,
      });
      totalEncrypted += report.encrypted;
      totalErrors += report.errors.length;
      process.stdout.write(
        `round ${round}: already protected ${report.alreadyProtectedCount}, ` +
          `plaintext backlog ${report.plaintextBacklogCount}, encrypted this round ${report.encrypted}, ` +
          `errors ${report.errors.length}\n`,
      );
      for (const error of report.errors) {
        process.stderr.write(`  error on fact_version ${error.factVersionId}: ${error.message}\n`);
      }
      if (report.plaintextFound.length < limit) break;
    }
    process.stdout.write(
      `backfill complete: ${totalEncrypted} fact version(s) encrypted across ${round} round(s), ${totalErrors} error(s)\n`,
    );
    if (totalErrors > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`protected-field backfill failed: ${(error as Error).message}\n`);
  process.exit(1);
});
