import { createPooledDb } from '@visastack/db';
import { reconcileRestoredBranch } from '@visastack/services';

/**
 * Backup resurrection reconciliation drill (Commercial V1 Part 7 §15), run
 * deliberately against two real branch connections after a disaster restore,
 * following docs/operations/backup-resurrection-reconciliation.md's
 * procedure -- same operating model as `packages/db/src/migrate.ts` and
 * `backfill-protected-fields.ts`:
 *
 *   RECONCILE_OLD_DATABASE_URL=... RECONCILE_NEW_DATABASE_URL=... \
 *     pnpm --filter @visastack/adapters reconcile:restored-branch \
 *     --restore-point=2026-01-01T00:00:00.000Z
 *
 * OLD is the pre-incident branch (read-only here -- this script never writes
 * to it), NEW is the freshly-restored branch being promoted to production.
 * Distinct env var names (not the shared `DATABASE_URL` candidates
 * `resolveDatabaseUrl` reads) because both connection strings are required
 * simultaneously, to two different branches, never interchangeable.
 *
 * Covers all 10 rules `reconcileRestoredBranch` implements (see its own doc
 * comment) -- consent/grant/membership/legal-hold/platform-role/
 * organization-status forcing, account deletion and case-retention purge
 * replay, and document/storage-object erasure replay.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required to run the reconciliation drill`);
  }
  return value;
}

function parseRestorePoint(): Date {
  const flag = process.argv.find((arg) => arg.startsWith('--restore-point='));
  if (!flag) {
    throw new Error(
      '--restore-point=<ISO 8601 timestamp> is required (the point Neon restored to)',
    );
  }
  const raw = flag.slice('--restore-point='.length);
  const restorePoint = new Date(raw);
  if (Number.isNaN(restorePoint.getTime())) {
    throw new Error(`--restore-point value is not a valid date: ${raw}`);
  }
  return restorePoint;
}

async function main(): Promise<void> {
  const restorePoint = parseRestorePoint();
  const oldConnectionString = requireEnv('RECONCILE_OLD_DATABASE_URL');
  const newConnectionString = requireEnv('RECONCILE_NEW_DATABASE_URL');

  const old = createPooledDb(oldConnectionString);
  const next = createPooledDb(newConnectionString);
  try {
    process.stdout.write(`reconciling against restore point ${restorePoint.toISOString()}...\n`);
    const report = await reconcileRestoredBranch(old.db, next.db, restorePoint);
    process.stdout.write(`checked ${report.checked} reconciliation-relevant event(s)\n`);
    for (const [rule, count] of Object.entries(report.counts)) {
      if (count > 0) process.stdout.write(`  ${rule}: ${count}\n`);
    }
    // Owner decision (1 Nov 2026): every plan the restore ended, so the right one can be given
    // back. A plan started after the restore point cannot come back with a restore.
    if (report.plansToCheck.length > 0) {
      process.stdout.write(
        `${report.plansToCheck.length} plan(s) ended to match the pre-incident branch; check each:\n`,
      );
      for (const plan of report.plansToCheck) {
        const who = plan.organizationId
          ? `agency ${plan.organizationId}`
          : `traveller account ${plan.payerAccountId ?? 'unknown'}`;
        const now = plan.hasCurrentPlan ? 'still has a current plan' : 'now has NO plan';
        process.stdout.write(
          `  ${who}: ${plan.planKey ?? 'unknown plan'} ended ${plan.endedAt.toISOString()}; ${now}\n`,
        );
      }
    }
    if (report.errors.length > 0) {
      process.stdout.write(`${report.errors.length} error(s):\n`);
      for (const error of report.errors) {
        process.stderr.write(
          `  ${error.eventType} (${error.resourceId ?? 'unknown'}): ${error.message}\n`,
        );
      }
      process.exitCode = 1;
      return;
    }
    process.stdout.write('reconciliation complete, no errors\n');
  } finally {
    await old.pool.end();
    await next.pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`reconciliation drill failed: ${(error as Error).message}\n`);
  process.exit(1);
});
