import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  excludePathspecs,
  findViolations,
  globToRegExp,
  parseAllowlist,
  parseArgs,
} from './check-allowed-paths.mjs';

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

test('parseArgs keeps flag values apart from the allowlist path', () => {
  const parsed = parseArgs([
    '--exclude',
    'docs/design/harbor-v2/',
    'list.txt',
    '--no-emdash',
    '--base',
    'origin/x',
  ]);
  assert.deepEqual(parsed, {
    allowlistPath: 'list.txt',
    base: 'origin/x',
    excludes: ['docs/design/harbor-v2'],
    noEmdash: true,
  });
});

test('parseArgs accepts several excludes and defaults the base', () => {
  const parsed = parseArgs(['list.txt', '--exclude', 'a', '--exclude', 'b']);
  assert.deepEqual(parsed.excludes, ['a', 'b']);
  assert.equal(parsed.base, 'origin/main');
  assert.equal(parsed.noEmdash, false);
});

test('parseArgs refuses a flag with no value', () => {
  assert.ok(parseArgs(['list.txt', '--exclude']).error);
  assert.ok(parseArgs(['list.txt', '--exclude', '--no-emdash']).error);
});

test('excludePathspecs builds git exclude pathspecs', () => {
  assert.deepEqual(excludePathspecs(['docs/design/harbor-v2']), [
    ':(exclude)docs/design/harbor-v2',
  ]);
});
