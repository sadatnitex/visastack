import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findViolations, globToRegExp, parseAllowlist } from './check-allowed-paths.mjs';

test('parseAllowlist ignores blanks and comments', () => {
  assert.deepEqual(parseAllowlist('# note\n\n  apps/web/src/a.ts  \n'), ['apps/web/src/a.ts']);
});

test('a single star stays inside one folder', () => {
  const re = globToRegExp('apps/web/src/*.ts');
  assert.ok(re.test('apps/web/src/a.ts'));
  assert.ok(!re.test('apps/web/src/lib/a.ts'));
});

test('a double star spans folders', () => {
  const re = globToRegExp('docs/upgrades/**');
  assert.ok(re.test('docs/upgrades/programme/STATUS.md'));
  assert.ok(re.test('docs/upgrades/x.md'));
  assert.ok(!re.test('docs/other/x.md'));
});

test('square brackets in Next.js route folders are literal', () => {
  const re = globToRegExp('apps/web/src/app/app/mission/[id]/page.tsx');
  assert.ok(re.test('apps/web/src/app/app/mission/[id]/page.tsx'));
  assert.ok(!re.test('apps/web/src/app/app/mission/i/page.tsx'));
});

test('dots are literal', () => {
  const re = globToRegExp('a.ts');
  assert.ok(!re.test('abts'));
});

test('findViolations lists only files outside the allowlist', () => {
  const patterns = ['apps/web/src/app/page.tsx', 'docs/upgrades/**'];
  const changed = [
    'apps/web/src/app/page.tsx',
    'docs/upgrades/programme/STATUS.md',
    'packages/services/src/agency.ts',
  ];
  assert.deepEqual(findViolations(changed, patterns), ['packages/services/src/agency.ts']);
});

test('an empty change set has no violations', () => {
  assert.deepEqual(findViolations([], ['a']), []);
});
