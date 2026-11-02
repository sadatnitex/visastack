// UMPE locked product sources must stay byte-identical to their recorded
// SHA-256 fingerprints, and the readable working views must match them
// exactly (only the long dash typography normalised). Runs in CI through
// `pnpm run test:node`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const umpe = join(repo, 'docs', 'umpe');
const MASTER = 'UMPE_LOCKED_Master_Product_Experience_v1.0_2026-11-02.md';

function run(root) {
  return spawnSync(process.execPath, [join(root, 'operations', 'verify-locked-sources.mjs')], {
    encoding: 'utf8',
  });
}

test('the committed UMPE sources match their locked fingerprints', () => {
  const result = run(umpe);
  assert.equal(result.status, 0, result.stderr);
  assert.equal((result.stdout.match(/^PASS /gm) ?? []).length, 3);
});

test('a one-character edit to a working view is caught', () => {
  const copy = mkdtempSync(join(tmpdir(), 'umpe-sources-'));
  try {
    for (const dir of ['operations', 'originals', 'source']) {
      cpSync(join(umpe, dir), join(copy, dir), { recursive: true });
    }
    const view = join(copy, 'source', MASTER);
    writeFileSync(view, `${readFileSync(view, 'utf8')} `);
    const result = run(copy);
    assert.equal(result.status, 1);
    assert.match(result.stdout, new RegExp(`^FAIL ${MASTER.replaceAll('.', '\\.')}`, 'm'));
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});
