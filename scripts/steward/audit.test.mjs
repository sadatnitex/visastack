import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderAudit, runGate } from './audit.mjs';

test('a passing and a failing gate are reported with the failure tail', async () => {
  const pass = await runGate({ name: 'ok', cmd: ['node', '-e', 'process.exit(0)'] }, process.cwd());
  const fail = await runGate(
    { name: 'bad', cmd: ['node', '-e', 'console.error("boom"); process.exit(3)'] },
    process.cwd(),
  );
  assert.equal(pass.ok, true);
  assert.equal(fail.ok, false);
  assert.equal(fail.code, 3);
  const text = renderAudit([pass, fail]);
  assert.match(text, /pass {2}ok/);
  assert.match(text, /FAIL {2}bad/);
  assert.match(text, /boom/);
  assert.match(text, /1 gate failed/);
});

test('a gate that cannot start fails instead of crashing the run', async () => {
  const result = await runGate(
    { name: 'missing', cmd: ['definitely-not-a-command-xyz'] },
    process.cwd(),
  );
  assert.equal(result.ok, false);
  assert.match(result.note, /could not start/);
});
