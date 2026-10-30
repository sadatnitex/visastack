/**
 * Guards the light post-deployment checks (30 Oct 2026). Vercel paused production for exceeding
 * the Hobby plan's CPU fair-use limit, and most of that CPU came from our own workflows running
 * about 300 browser tests against the live site after every merge. Production now gets only the
 * small `@live` set; pull requests still run everything on the CI machine.
 *
 * Fails when:
 * - playwright-smoke.yml stops limiting its production run with `--grep @live`;
 * - more than 12 tests (or none) carry the `@live` tag;
 * - the pull request browser check loses its full run (it must not use `--grep`);
 * - a post-deployment workflow loses its cancel-older-runs concurrency, or its check name;
 * - the live signed-in check gains a timed schedule.
 *
 * Run with: node --test scripts/live-checks.test.mjs (part of `pnpm run test:node`).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = (name) => readFileSync(join(root, '.github/workflows', name), 'utf8');
const MAX_LIVE_TESTS = 12;
const SPECS = [
  'no-secret-auth.spec.ts',
  'ux-public.spec.ts',
  'browser-security.spec.ts',
  'pwa.spec.ts',
];

/** The `run:` command of the step whose name contains `stepName`. */
function runOf(text, stepName) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => line.includes('- name:') && line.includes(stepName));
  assert.notEqual(at, -1, `no step named like "${stepName}"`);
  for (const line of lines.slice(at + 1)) {
    if (line.includes('- name:')) break;
    const run = line.match(/^\s*run:\s*(.+)$/);
    if (run?.[1]) return run[1].trim();
  }
  assert.fail(`step "${stepName}" has no one-line run command`);
}

/** The test titles Playwright would run for `args`, read from its own listing (no browser). */
function listTests(args) {
  const web = join(root, 'apps/web');
  const bin = join(web, 'node_modules/.bin/playwright');
  assert.ok(existsSync(bin), 'Playwright is not installed: run pnpm install first');
  const listed = spawnSync(bin, ['test', ...args, '--list', '--reporter=list'], {
    cwd: web,
    encoding: 'utf8',
    env: { ...process.env, PLAYWRIGHT_BASE_URL: 'http://localhost:3100' },
  });
  assert.equal(listed.status, 0, `playwright --list failed: ${listed.stderr || listed.stdout}`);
  return listed.stdout.split('\n').filter((line) => line.includes(' › '));
}

test('production runs only the @live browser tests, and pull requests still run all of them', () => {
  const production = runOf(workflow('playwright-smoke.yml'), 'against the deployed URL');
  assert.match(production, /--grep @live(\s|$)/, 'playwright-smoke.yml must keep --grep @live');
  for (const spec of SPECS) assert.ok(production.includes(spec), `${spec} left out`);

  const pullRequest = runOf(workflow('pr-browser-checks.yml'), 'Run the no-secret Playwright');
  assert.doesNotMatch(pullRequest, /--grep/, 'pull requests must run every browser test');
  for (const spec of SPECS) assert.ok(pullRequest.includes(spec), `${spec} left out`);
});

test(`between 1 and ${MAX_LIVE_TESTS} tests carry the @live tag`, () => {
  const live = listTests([...SPECS, '--grep', '@live']);
  assert.ok(live.length > 0, 'no test carries @live, so production would not be checked');
  assert.ok(
    live.length <= MAX_LIVE_TESTS,
    `${live.length} tests carry @live; keep it to ${MAX_LIVE_TESTS} or fewer, each one costs the live site:\n${live.join('\n')}`,
  );
});

test('post-deployment checks keep their names and cancel runs for older deployments', () => {
  for (const [file, name] of [
    ['deploy-smoke.yml', 'No-secret smoke check'],
    ['playwright-smoke.yml', 'No-secret Playwright checks'],
    ['live-signed-in-check.yml', 'Live signed-in check'],
  ]) {
    const text = workflow(file);
    assert.match(text, new RegExp(`^\\s+name: ${name}$`, 'm'), `${file} lost its check name`);
    assert.match(
      text,
      /^ {4}concurrency:\n {6}group: [^\n]+\n {6}cancel-in-progress: true$/m,
      `${file} needs job-level concurrency that cancels older runs`,
    );
  }
});

test('the live signed-in check has no timed schedule', () => {
  const text = workflow('live-signed-in-check.yml');
  assert.doesNotMatch(text, /^\s*schedule\s*:/m);
  assert.match(text, /^\s*deployment_status\s*:/m);
});
