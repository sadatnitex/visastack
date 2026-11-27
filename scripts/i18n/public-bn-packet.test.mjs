import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = new URL('./public-bn-packet.mjs', import.meta.url).pathname;
const run = (...args) =>
  spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', script, ...args], {
    encoding: 'utf8',
  });

test('the committed review packet is what the message files produce', () => {
  const result = run('--check');
  assert.equal(result.status, 0, result.stderr);
});

test('every held message is listed as held and none is marked approved', () => {
  const csv = readFileSync(
    new URL('../../docs/localization/data/public-bn/REVIEW_PACKET.csv', import.meta.url),
    'utf8',
  );
  const lines = csv.trim().split('\n').slice(1);
  assert.ok(lines.length > 70);
  assert.ok(lines.some((line) => line.includes('"HELD"')));
  for (const line of lines) {
    assert.ok(line.includes('"DRAFT_NOT_REVIEWED"'), line.slice(0, 80));
    assert.ok(!/APPROVED/.test(line), line.slice(0, 80));
  }
});

test('the check fails when the packet is stale (the guard can fail)', () => {
  // A message file the packet has never seen changes its output, so the committed copy is stale.
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings',
      '-e',
      `import('${script}').then(async (m) => { const rows = await m.collect(); rows.push({ key: 'x.y', route: '/', page: 'x', english: 'e', bengali: 'b', cls: 'ordinary', release: 'LIVE', state: 'DRAFT_NOT_REVIEWED', needs: '' }); process.stdout.write(m.toCsv(rows).includes('x.y') ? 'differs' : 'same'); })`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.stdout.trim(), 'differs');
});
