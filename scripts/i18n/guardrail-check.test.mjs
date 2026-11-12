import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOOL = path.join(ROOT, 'docs/localization/tools/guardrail-check.mjs');

// The Bengali guards must catch the wrong wording recorded in the catalogue review, and accept
// the corrected wording. A guard that stops catching its sample makes this test fail.
test('Bengali guardrail self-test passes', () => {
  const run = spawnSync(process.execPath, [TOOL, '--self-test'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /self-test: PASS \(guard misses: 0, proposed fixes still flagged: 0\)/);
});
