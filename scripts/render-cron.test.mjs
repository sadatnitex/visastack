/**
 * Guards the Render fallback's scheduled jobs (.github/workflows/render-cron.yml). While the site
 * runs on Render, that workflow stands in for Vercel's scheduler, so it must call every job in
 * apps/web/vercel.json on the same schedule, and nothing else, and it must stay off until the
 * owner switches it on (repository variable CRON_HOST=render).
 *
 * Run with: node --test scripts/render-cron.test.mjs (part of `pnpm run test:node`).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vercel = JSON.parse(readFileSync(join(root, 'apps/web/vercel.json'), 'utf8'));
const cron = readFileSync(join(root, '.github/workflows/render-cron.yml'), 'utf8');

const key = (schedule, path) => `${schedule.trim().split(/\s+/).join(' ')} ${path}`;
const sorted = (values) => [...values].sort();

/** `schedule path` pairs from the CRON_TABLE block of the workflow. */
function cronTable(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^\s+CRON_TABLE: \|\s*$/.test(line));
  assert.notEqual(start, -1, 'render-cron.yml has no CRON_TABLE block');
  const pairs = [];
  for (const line of lines.slice(start + 1)) {
    const row = line.match(/^\s+((?:\S+\s+){5})(\/\S+)\s*$/);
    if (!row?.[1] || !row[2]) break;
    pairs.push(key(row[1], row[2]));
  }
  return pairs;
}

/** The schedules GitHub starts the workflow on. */
function triggers(text) {
  return [...text.matchAll(/^\s+- cron: '([^']+)'\s*$/gm)].map((match) => key(match[1] ?? '', ''));
}

test('every Vercel job runs on Render with the same path and schedule, and nothing else', () => {
  const expected = vercel.crons.map((job) => key(job.schedule, job.path));
  assert.ok(expected.length > 0);
  assert.deepEqual(sorted(cronTable(cron)), sorted(expected));
});

test('the workflow starts on exactly the schedules the jobs need', () => {
  const needed = new Set(vercel.crons.map((job) => key(job.schedule, '')));
  const started = triggers(cron);
  assert.equal(new Set(started).size, started.length, 'a schedule is listed twice');
  assert.deepEqual(sorted(started), sorted(needed));
});

test('it stays off until CRON_HOST=render and signs every call with the cron secret', () => {
  assert.match(cron, /^\s+if: github\.ref == 'refs\/heads\/main' && vars\.CRON_HOST == 'render'$/m);
  assert.doesNotMatch(cron, /^\s+if:(?!.*vars\.CRON_HOST == 'render')/m, 'every job must be gated');
  assert.match(cron, /CRON_SECRET: \$\{\{ secrets\.CRON_SECRET \}\}/);
  assert.match(cron, /CRON_BASE_URL: \$\{\{ vars\.CRON_BASE_URL \}\}/);
  assert.match(cron, /'Authorization: Bearer %s\\n' "\$CRON_SECRET"/);
});
