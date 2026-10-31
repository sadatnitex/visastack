#!/usr/bin/env node
// Refreshes packages/services/shard-weights.json, the per-file timings the service test shards
// are balanced by (packages/services/vitest-shards.ts).
//
// usage (a full, unfiltered run of the service tests):
//   cd packages/services && ./node_modules/.bin/vitest run --maxWorkers=2 --reporter=json \
//     --outputFile=/tmp/services-durations.json
//   node scripts/agent/shard-weights.mjs /tmp/services-durations.json
//
// Only relative timings matter, so a run on any machine will do. The new timings are merged into
// the existing list: only files that passed are updated (a failed or skipped file reports a time
// that says nothing about its real length), and files that no longer exist are dropped. A stale
// list never drops or repeats a test; it only makes the shards less even.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const services = join(root, 'packages/services');
const listPath = join(services, 'shard-weights.json');
const input = process.argv[2];
if (!input) {
  console.error('usage: node scripts/agent/shard-weights.mjs <vitest json report>');
  process.exit(2);
}
const report = JSON.parse(readFileSync(input, 'utf8'));
function readList() {
  try {
    return JSON.parse(readFileSync(listPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}
const weights = readList();
let updated = 0;
let ignored = 0;
for (const file of report.testResults ?? []) {
  const ms = Math.round((file.endTime - file.startTime) / 10) * 10;
  if (file.status !== 'passed' || !Number.isFinite(ms) || ms <= 0) {
    ignored += 1;
    continue;
  }
  weights[relative(services, file.name).split(sep).join('/')] = ms;
  updated += 1;
}
const kept = Object.entries(weights)
  .filter(([path]) => existsSync(join(services, path)))
  .sort(([a], [b]) => (a < b ? -1 : 1));
writeFileSync(listPath, `${JSON.stringify(Object.fromEntries(kept), null, 2)}\n`);
console.info(
  `${updated} files updated, ${ignored} left as they were (not passed), ${kept.length} files in the list`,
);
