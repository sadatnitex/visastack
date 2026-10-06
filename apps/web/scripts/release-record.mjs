#!/usr/bin/env node
/**
 * Writes the release record for one deployment (Commercial V1 directive Part 9 section 13:
 * "Release should record: code SHA, deployment/build ID, migration version").
 *
 * Run by the Deploy Smoke workflow on every deployment_status event, after the smoke check, so the
 * record carries the smoke result. It reads only what GitHub and the repository already hold at
 * the deployed commit, needs no secret, and prints one JSON document:
 *
 *   node scripts/release-record.mjs <event.json> <smoke-outcome> > release-record.json
 *
 * Part 10's release gate collects these records (and adds what only a person or a later step can:
 * test reports, scan timestamps, independent review, the recovery drill).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The newest migration in a drizzle journal, as { tag, when }. */
export function newestMigration(journal) {
  const last = journal.entries.at(-1);
  return last
    ? { tag: last.tag, when: new Date(last.when).toISOString(), count: journal.entries.length }
    : { tag: null, when: null, count: 0 };
}

/**
 * The record for a deployment_status event. `event` is GitHub's payload; `journal` is the migration
 * journal at that commit; `smokeOutcome` is the smoke step's outcome (success, failure, skipped).
 */
export function buildReleaseRecord({ event, journal, smokeOutcome, now }) {
  const { deployment, deployment_status: status, repository } = event;
  return {
    recordedAt: now.toISOString(),
    repository: repository?.full_name ?? null,
    codeSha: deployment?.sha ?? null,
    ref: deployment?.ref ?? null,
    environment: deployment?.environment ?? null,
    githubDeploymentId: deployment?.id ?? null,
    deploymentState: status?.state ?? null,
    deploymentUrl: status?.environment_url || status?.target_url || null,
    deploymentCreatedAt: deployment?.created_at ?? null,
    migration: newestMigration(journal),
    smokeCheck: smokeOutcome,
    note: 'Migration version is the newest migration in the repository at this commit. Whether it is applied to the database is shown by the readiness check on the deployment, not by this record.',
  };
}

function main() {
  const [eventPath, smokeOutcome = 'unknown'] = process.argv.slice(2);
  if (!eventPath) {
    process.stderr.write('usage: release-record.mjs <event.json> <smoke-outcome>\n');
    process.exit(2);
  }
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const journal = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../packages/db/migrations/meta/_journal.json', import.meta.url)),
      'utf8',
    ),
  );
  process.stdout.write(
    `${JSON.stringify(buildReleaseRecord({ event, journal, smokeOutcome, now: new Date() }), null, 2)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
