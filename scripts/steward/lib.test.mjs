import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GhError,
  createGh,
  flagValue,
  formatClaim,
  globToRegExp,
  mapLimit,
  matchesGlob,
  migrationNumber,
  padMigration,
  parseClaim,
  patternsOverlap,
  splitList,
  topicMatches,
  topicWords,
} from './lib.mjs';

test('globs: single star stays in a folder, double star crosses folders', () => {
  assert.ok(matchesGlob('apps/web/src/**', 'apps/web/src/app/page.tsx'));
  assert.ok(matchesGlob('apps/**/page.tsx', 'apps/web/src/app/page.tsx'));
  assert.ok(matchesGlob('docs/*.md', 'docs/a.md'));
  assert.ok(!matchesGlob('docs/*.md', 'docs/sub/a.md'));
  assert.ok(!matchesGlob('docs/a.md', 'docs/a-md'));
  assert.ok(globToRegExp('a.b').test('a.b'));
  assert.ok(!globToRegExp('a.b').test('axb'));
});

test('patternsOverlap: literals only collide when equal, wildcards collide on shared folders', () => {
  assert.ok(patternsOverlap('a/b.ts', 'a/b.ts'));
  assert.ok(!patternsOverlap('a/b.ts', 'a/c.ts'));
  assert.ok(patternsOverlap('a/**', 'a/b/c.ts'));
  assert.ok(patternsOverlap('a/b/**', 'a/**'));
  assert.ok(!patternsOverlap('a/**', 'z/y.ts'));
  assert.ok(patternsOverlap('**', 'anything/at/all.ts'));
});

test('claims survive a round trip and ignore PRs without one', () => {
  const claim = {
    paths: ['apps/web/**', 'packages/db/x.ts'],
    migration: '0134',
    area: 'case page',
  };
  const body = `## Summary\nText\n\n${formatClaim(claim)}\n\nMore text`;
  assert.deepEqual(parseClaim(body), claim);
  assert.equal(parseClaim('## Summary\nnothing here'), null);
  assert.equal(parseClaim(null), null);
  assert.deepEqual(parseClaim('Steward-claim:\n- paths: a/b c/d.ts, e/**').paths, [
    'a/b',
    'c/d.ts',
    'e/**',
  ]);
  assert.deepEqual(parseClaim(formatClaim({ paths: ['a'] })), {
    paths: ['a'],
    migration: null,
    area: '',
  });
});

test('migration numbers read only from the configured folder', () => {
  const config = { migrations: { dir: 'packages/db/migrations', pattern: '^(\\d{4})_' } };
  assert.equal(migrationNumber('packages/db/migrations/0133_x.sql', config), 133);
  assert.equal(migrationNumber('packages/db/migrations/meta/_journal.json', config), null);
  assert.equal(migrationNumber('elsewhere/0133_x.sql', config), null);
  assert.equal(migrationNumber('x', { migrations: null }), null);
  assert.equal(padMigration(7), '0007');
});

test('topic matching needs real word overlap and skips filler words', () => {
  assert.deepEqual(topicWords('Fix the Checklist wording page'), ['checklist', 'wording']);
  const subjects = [
    { where: 'main abc', subject: 'Edit wording on a checklist item' },
    { where: 'main def', subject: 'Payments refund ledger export' },
  ];
  const hits = topicMatches('checklist wording edits', subjects);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].where, 'main abc');
  assert.deepEqual(topicMatches('', subjects), []);
});

test('mapLimit keeps order and never exceeds the limit', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12]);
  assert.ok(peak <= 2);
});

test('gh wrapper pages until a short page and flags a proxy refusal', async () => {
  const pages = [Array(100).fill(1), [1, 2]];
  const gh = createGh(async (_cmd, args) => ({
    stdout: JSON.stringify(pages[Number(args[1].match(/&page=(\d+)/)[1]) - 1]),
  }));
  assert.equal((await gh.list('repos/x/y/things')).length, 102);

  const denied = createGh(async () => {
    const error = new Error('x');
    error.stderr = 'gh: Access to this path is not permitted through this proxy. (HTTP 403)';
    throw error;
  });
  await assert.rejects(
    denied.get('repos/x/y/actions/caches'),
    (e) => e instanceof GhError && e.denied,
  );
});

test('splitList and flagValue read plain command line lists', () => {
  assert.deepEqual(splitList(' a, b ,,c '), ['a', 'b', 'c']);
  assert.deepEqual(splitList(undefined), []);
  assert.equal(flagValue(['--x', 'one', '--y'], '--x'), 'one');
  assert.equal(flagValue(['--y'], '--x'), null);
  assert.equal(flagValue(['--x'], '--x'), '');
});
