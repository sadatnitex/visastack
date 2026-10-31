/**
 * Guards the three required pull request checks (31 Oct 2026). Branch protection matches them by
 * name, and GitHub counts a skipped required check as passed, so each one must keep its name and
 * must report a real result on every pull request.
 *
 * Since 31 Oct 2026 one machine builds the app once for both browser checks: the smoke check runs
 * in the "No-secret Playwright checks" job, and the "No-secret smoke check" job reports its result.
 *
 * Fails when:
 * - a required check loses its exact name;
 * - the CI summary job or the smoke check job can be skipped (it loses `if: always()`);
 * - the smoke check job stops depending on the browser job, or passes on anything other than a
 *   real smoke success;
 * - the browser job stops running the smoke script itself, or stops handing its result on.
 *
 * Run with: node --test scripts/pr-checks.test.mjs (part of `pnpm run test:node`).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = (name) => readFileSync(join(root, '.github/workflows', name), 'utf8');

/** The text of job `id` (from its `  id:` line to the next job at the same indent). */
function jobOf(text, id) {
  const lines = text.split('\n');
  const at = lines.indexOf(`  ${id}:`);
  assert.notEqual(at, -1, `no job "${id}"`);
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((line) => /^ {2}[\w-]+:\s*$/.test(line) || /^\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

test('the three required checks keep their exact names', () => {
  assert.match(jobOf(workflow('ci.yml'), 'verify'), /^ {4}name: Lint · Build · Typecheck · Test$/m);
  const browser = workflow('pr-browser-checks.yml');
  assert.match(jobOf(browser, 'playwright'), /^ {4}name: No-secret Playwright checks$/m);
  assert.match(jobOf(browser, 'smoke'), /^ {4}name: No-secret smoke check$/m);
});

test('the summary jobs are never skipped', () => {
  assert.match(jobOf(workflow('ci.yml'), 'verify'), /^ {4}if: always\(\)$/m);
  assert.match(jobOf(workflow('pr-browser-checks.yml'), 'smoke'), /^ {4}if: always\(\)$/m);
});

test('the smoke check passes only when the smoke script really passed', () => {
  const browser = workflow('pr-browser-checks.yml');
  const smoke = jobOf(browser, 'smoke');
  assert.match(smoke, /^ {4}needs: \[playwright\]$/m);
  assert.match(smoke, /SMOKE: \$\{\{ needs\.playwright\.outputs\.smoke \}\}/);
  assert.match(smoke, /^\s+test "\$SMOKE" = success$/m);

  const playwright = jobOf(browser, 'playwright');
  assert.match(playwright, /^ {6}smoke: \$\{\{ steps\.smoke\.outcome \}\}$/m);
  const step = playwright.slice(playwright.indexOf('id: smoke'));
  assert.ok(playwright.includes('id: smoke'), 'the browser job has no step with id smoke');
  assert.match(
    step.slice(0, step.indexOf('- name:')),
    /run: SMOKE_BASE_URL=http:\/\/localhost:3100 node scripts\/smoke\.mjs$/m,
    'the smoke step must run the smoke script against the app on this machine',
  );
});
