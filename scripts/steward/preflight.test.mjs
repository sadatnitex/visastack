import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyse, checkPlan, ciState, findOverlaps, migrationState, render } from './preflight.mjs';

const config = {
  repo: 'o/r',
  defaultBranch: 'main',
  requiredChecks: ['A', 'B'],
  laneBranchPrefixes: ['claude/'],
  protectedBranches: [],
  parkedPrefixes: ['wip/'],
  migrations: { dir: 'db/migrations', pattern: '^(\\d{4})_' },
  hotFiles: [
    { glob: 'docs/known-issues.md', rule: 'append-only', how: 'use merge-append' },
    { glob: 'db/migrations/meta/**', rule: 'generated', how: 'drizzle-kit' },
  ],
  retention: {
    graceHours: 48,
    laneStaleDays: 7,
    parkedReviewDays: 45,
    artifactDays: 3,
    cacheDays: 7,
  },
};
const now = new Date('2026-11-10T12:00:00Z');
const day = (n) => new Date(now.getTime() - n * 86_400_000).toISOString();
const branch = (name, files, extra = {}) => ({
  name,
  sha: 'a'.repeat(40),
  ahead: 1,
  behind: 0,
  files: files.map((path) => ({ path, status: 'modified', sha: 's' })),
  truncated: false,
  lastCommitDate: day(1),
  lastSubject: 'work',
  ...extra,
});
const pr = (number, ref, body = '') => ({
  number,
  title: `PR ${number}`,
  draft: true,
  body,
  head: { ref },
});

test('ciState ignores skipped duplicates and goes red on a failed required check', () => {
  const run = (name, status, conclusion) => ({ name, status, conclusion });
  assert.equal(
    ciState(
      [
        run('A', 'completed', 'skipped'),
        run('A', 'completed', 'success'),
        run('B', 'completed', 'success'),
      ],
      ['A', 'B'],
    ),
    'green',
  );
  assert.equal(
    ciState([run('A', 'completed', 'failure'), run('B', 'completed', 'success')], ['A', 'B']),
    'red',
  );
  assert.equal(
    ciState([run('A', 'completed', 'success'), run('B', 'in_progress', null)], ['A', 'B']),
    'pending',
  );
  assert.equal(ciState([], ['A', 'B']), 'unknown');
});

test('overlaps: real shared files, hot files and claimed areas are told apart', () => {
  const report = analyse({
    config,
    mainSha: 'm'.repeat(40),
    mainCi: 'green',
    openPrs: [
      pr(1, 'claude/one', 'Steward-claim:\n- paths: apps/web/cases/**'),
      pr(2, 'claude/two', 'Steward-claim:\n- paths: apps/web/cases/list.tsx'),
      pr(3, 'claude/three'),
    ],
    branches: [
      branch('claude/one', ['apps/web/a.ts', 'docs/known-issues.md']),
      branch('claude/two', ['apps/web/a.ts', 'docs/known-issues.md']),
      branch('claude/three', ['elsewhere/z.ts']),
    ],
    mainPaths: [],
    currentBranch: 'claude/three',
    now,
  });
  assert.equal(report.overlaps.length, 1);
  const [o] = report.overlaps;
  assert.deepEqual(o.real, ['apps/web/a.ts']);
  assert.deepEqual(o.hot, ['docs/known-issues.md']);
  assert.ok(o.soft.length >= 1);
  assert.equal(report.lanes.find((l) => l.name === 'claude/three').mine, true);
});

test('stale lanes without a PR are not live and cannot block anyone', () => {
  const lanes = analyse({
    config,
    mainSha: 'm'.repeat(40),
    mainCi: 'green',
    openPrs: [],
    branches: [
      branch('claude/old', ['x.ts'], { lastCommitDate: day(20) }),
      branch('claude/new', ['x.ts']),
    ],
    mainPaths: [],
    currentBranch: '',
    now,
  }).lanes;
  assert.equal(lanes.find((l) => l.name === 'claude/old').live, false);
  assert.deepEqual(findOverlaps(lanes, config), []);
});

test('next migration counts main, live lanes and claims, but not stale lanes', () => {
  const lanes = [
    { name: 'a', live: true, migrations: [134] },
    { name: 'b', live: true, migrations: [136] },
    { name: 'c', live: false, migrations: [140] },
  ];
  const state = migrationState({
    mainPaths: ['db/migrations/0133_x.sql', 'db/migrations/meta/_journal.json'],
    lanes,
    config,
  });
  assert.equal(state.latestOnMain, '0133');
  assert.equal(state.next, '0137');
  assert.deepEqual(state.reserved, { a: ['0134'], b: ['0136'] });
});

test('checkPlan: serialize on a real collision, rules for hot files, proceed when clear', () => {
  const lanes = [
    {
      name: 'claude/other',
      pr: { number: 9 },
      live: true,
      mine: false,
      files: ['apps/web/cases/page.tsx'],
      claimPaths: [],
    },
  ];
  const migration = { next: '0134' };
  const clash = checkPlan({ planPaths: ['apps/web/cases/**'], lanes, config, migration });
  assert.equal(clash.verdict, 'SERIALIZE');
  assert.equal(clash.conflicts[0].lane, 'claude/other');

  const hot = checkPlan({ planPaths: ['docs/known-issues.md'], lanes, config, migration });
  assert.equal(hot.verdict, 'PROCEED_WITH_RULES');
  assert.equal(hot.rules[0].rule, 'append-only');

  const clear = checkPlan({ planPaths: ['packages/x/y.ts'], lanes, config, migration });
  assert.equal(clear.verdict, 'PROCEED');
  assert.ok(clear.claim.startsWith('Steward-claim:'));

  const mig = checkPlan({
    planPaths: ['packages/x/y.ts'],
    lanes,
    config,
    migration,
    wantsMigration: true,
  });
  assert.equal(mig.verdict, 'PROCEED_WITH_RULES');
  assert.equal(mig.migration, '0134');
  assert.ok(mig.claim.includes('migration: 0134'));
});

test('the brief is short and says when main is red', () => {
  const report = analyse({
    config,
    mainSha: 'abcdef1234567'.padEnd(40, '0'),
    mainCi: 'red',
    openPrs: [pr(5, 'claude/x')],
    branches: [branch('claude/x', ['a.ts'])],
    mainPaths: ['db/migrations/0133_x.sql'],
    currentBranch: 'claude/x',
    now,
  });
  const text = render(report);
  assert.match(text, /main abcdef1 \| CI red/);
  assert.match(text, /fixing it comes before any new work/);
  assert.match(text, /next migration 0134/);
  assert.ok(text.split('\n').length <= 8);
});

test('a claim pushed on a plain branch (no PR) counts and reserves its migration', () => {
  const report = analyse({
    config,
    mainSha: 'm'.repeat(40),
    mainCi: 'green',
    openPrs: [],
    branches: [
      branch('claude/early', [], {
        claim: { paths: ['apps/web/cases/**'], migration: '0134', area: 'case page' },
      }),
    ],
    mainPaths: ['db/migrations/0133_x.sql'],
    currentBranch: 'claude/me',
    now,
  });
  const lane = report.lanes[0];
  assert.equal(lane.live, true);
  assert.deepEqual(lane.claimPaths, ['apps/web/cases/**']);
  assert.equal(report.migration.next, '0135');
  const plan = checkPlan({ planPaths: ['apps/web/cases/page.tsx'], lanes: report.lanes, config });
  assert.equal(plan.verdict, 'SERIALIZE');
});

test('a broad plan still collides with a live lane even though it also covers a hot file', () => {
  const lanes = [
    {
      name: 'claude/other',
      pr: { number: 9 },
      live: true,
      mine: false,
      files: ['apps/web/src/a.ts'],
      claimPaths: [],
    },
  ];
  const wide = {
    ...config,
    hotFiles: [
      ...config.hotFiles,
      { glob: 'apps/web/src/app/globals.css', rule: 'shared', how: 'x' },
    ],
  };
  const plan = checkPlan({
    planPaths: ['apps/web/src/**'],
    lanes,
    config: wide,
    migration: { next: '0134' },
  });
  assert.equal(plan.verdict, 'SERIALIZE');
  assert.equal(plan.rules.length, 1);
});
