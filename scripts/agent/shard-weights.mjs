#!/usr/bin/env node
// Refreshes packages/services/shard-weights.json, the per-file timings the service test shards
// are balanced by (packages/services/vitest-shards.ts).
//
// usage:
//   cd packages/services && ./node_modules/.bin/vitest run --maxWorkers=2 --reporter=json \
//     --outputFile=/tmp/services-durations.json
//   node scripts/agent/shard-weights.mjs /tmp/services-durations.json
//
// Only relative timings matter, so a run on any machine will do. A stale list never drops or
// repeats a test; it only makes the shards less even.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const services = join(root, 'packages/services');
const input = process.argv[2];
if (!input) {
  console.error('usage: node scripts/agent/shard-weights.mjs <vitest json report>');
  process.exit(2);
}
const report = JSON.parse(readFileSync(input, 'utf8'));
const weights = {};
for (const file of report.testResults ?? []) {
  const ms = Math.max(1, Math.round((file.endTime - file.startTime) / 10) * 10);
  if (!Number.isFinite(ms)) continue;
  weights[relative(services, file.name).split(sep).join('/')] = ms;
}
const sorted = Object.fromEntries(Object.entries(weights).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(join(services, 'shard-weights.json'), `${JSON.stringify(sorted, null, 2)}\n`);
console.info(`${Object.keys(sorted).length} files written to packages/services/shard-weights.json`);
