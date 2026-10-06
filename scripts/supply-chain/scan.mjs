#!/usr/bin/env node
// Runs the supply-chain checks and reports executed / passed / failed / skipped.
//
// Usage: node scripts/supply-chain/scan.mjs [--only id,id] [--json file] [--no-skips] [--no-history]
//   --no-skips   treat a skipped check as a failure (used in CI, where nothing may be skipped)
//   --json file  also write the full result as JSON
// Exit code: 0 all executed checks passed (and none skipped with --no-skips), 1 otherwise.
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkBrowserBundle,
  checkFixtures,
  checkLicences,
  checkPreviewCredentials,
  checkPrompts,
  checkSecrets,
  checkStaticAnalysis,
  summarise,
  toMarkdown,
  trackedFiles,
} from './checks.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const files = trackedFiles(root);
const only = value('--only')?.split(',');

const all = [
  ['secret-scan', () => checkSecrets(root, files, { history: !flag('--no-history') })],
  ['licence-scan', () => checkLicences(root)],
  ['static-analysis', () => checkStaticAnalysis(root, files)],
  ['browser-bundle', () => checkBrowserBundle(root)],
  ['prompt-check', () => checkPrompts(root, files)],
  ['fixture-check', () => checkFixtures(root, files)],
  ['preview-credentials', () => checkPreviewCredentials(root, files)],
];

const results = [];
for (const [id, run] of all) {
  if (only && !only.includes(id)) continue;
  try {
    results.push(run());
  } catch (err) {
    results.push({
      id,
      title: id,
      status: 'failed',
      detail: `The check itself crashed: ${String(err.message).slice(0, 200)}`,
      findings: [],
    });
  }
}

const md = toMarkdown(results);
process.stdout.write(md);
const jsonPath = value('--json');
if (jsonPath)
  writeFileSync(jsonPath, `${JSON.stringify({ summary: summarise(results), results }, null, 2)}\n`);
const { GITHUB_STEP_SUMMARY: summaryPath } = process.env;
if (summaryPath) appendFileSync(summaryPath, md);

const counts = summarise(results);
const bad = counts.failed > 0 || (flag('--no-skips') && counts.skipped > 0);
process.exit(bad ? 1 : 0);
