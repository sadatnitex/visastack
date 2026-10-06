import { createPooledDb } from '@visastack/db';
import { runAuditChainVerification } from './audit-chain-report';

/**
 * Verifies the audit trail's hash chain over a whole database, run deliberately as part of a
 * restore (docs/operations/recovery.md) or an incident (docs/operations/incidents/README.md),
 * same operating model as `reconcile-restored-branch.ts`:
 *
 *   VERIFY_DATABASE_URL=... pnpm --filter @visastack/adapters verify:audit-chain
 *
 * The admin page's "Audit log integrity" signal checks only the newest 500 events; this checks
 * every event (or the newest N with `--limit=N`). It only reads. Exit code 0 means every link
 * and hash is intact; 1 means a broken link (an event removed, inserted or reordered) or hash
 * mismatches (an edit, or a value that does not survive storage the way it was hashed).
 * A distinct variable name (not the shared `DATABASE_URL` candidates) so it cannot be pointed at
 * production by accident.
 */

function parseLimit(): number {
  const flag = process.argv.find((arg) => arg.startsWith('--limit='));
  if (!flag) return Number.MAX_SAFE_INTEGER;
  const value = Number(flag.slice('--limit='.length));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('--limit must be a whole number of at least 1');
  }
  return value;
}

async function main(): Promise<void> {
  const { VERIFY_DATABASE_URL: connectionString } = process.env;
  if (!connectionString) {
    throw new Error('VERIFY_DATABASE_URL is required to verify the audit chain');
  }
  const limit = parseLimit();
  const { db, pool } = createPooledDb(connectionString);
  try {
    process.exitCode = await runAuditChainVerification(db, limit, (line) =>
      process.stdout.write(`${line}\n`),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
