import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyBranch, sweepArtifacts, sweepBranches, sweepCaches } from './hygiene.mjs';

const config = {
  repo: 'o/r',
  defaultBranch: 'main',
  protectedBranches: ['keep/me'],
  parkedPrefixes: ['wip/'],
  retention: {
    graceHours: 48,
    laneStaleDays: 7,
    parkedReviewDays: 45,
    artifactDays: 3,
    cacheDays: 7,
  },
};
const now = new Date('2026-11-10T12:00:00Z');
const daysAgo = (n) => new Date(now.getTime() - n * 86_400_000).toISOString();
const SHA = 'b'.repeat(40);
const info = (extra = {}) => ({
  name: 'claude/x',
  sha: SHA,
  ahead: 2,
  behind: 0,
  files: [{ path: 'a.ts', status: 'modified', sha: 'blob1' }],
  truncated: false,
  lastCommitDate: daysAgo(10),
  ...extra,
});
const mainBlobs = (entries = []) => ({ map: new Map(entries), truncated: false });
const decide = (i, prs = [], blobs = mainBlobs(), currentBranch = '') =>
  classifyBranch({ config, info: i, prs, mainBlobs: blobs, currentBranch, now });

test('never touches the current, protected or open-PR branches', () => {
  assert.equal(decide(info(), [], mainBlobs(), 'claude/x').action, 'KEEP');
  assert.equal(decide(info({ name: 'keep/me', ahead: 0 })).action, 'KEEP');
  assert.equal(decide(info({ ahead: 0 }), [{ state: 'open', number: 3 }]).action, 'KEEP');
});

test('a brand new branch is kept even when it has nothing yet', () => {
  assert.equal(decide(info({ ahead: 0, lastCommitDate: daysAgo(0.1) })).action, 'KEEP');
});

test('proofs that allow deleting', () => {
  assert.equal(decide(info({ ahead: 0 })).action, 'DELETE');
  const merged = decide(info(), [
    { state: 'closed', number: 7, merged_at: 'x', head: { sha: SHA } },
  ]);
  assert.equal(merged.action, 'DELETE');
  assert.match(merged.reason, /#7/);
  const squashed = decide(info(), [], mainBlobs([['a.ts', 'blob1']]));
  assert.equal(squashed.action, 'DELETE');
  const removedFile = decide(info({ files: [{ path: 'gone.ts', status: 'removed', sha: 'x' }] }));
  assert.equal(removedFile.action, 'DELETE');
});

test('no proof means a person decides, and nothing is deleted', () => {
  const differs = decide(info(), [], mainBlobs([['a.ts', 'other']]));
  assert.equal(differs.action, 'REVIEW');
  const earlierMerge = decide(info(), [
    { state: 'closed', number: 7, merged_at: 'x', head: { sha: 'old' } },
  ]);
  assert.equal(earlierMerge.action, 'REVIEW');
  const closed = decide(info(), [
    { state: 'closed', number: 8, merged_at: null, head: { sha: SHA } },
  ]);
  assert.equal(closed.action, 'REVIEW');
  const tooBig = decide(info({ truncated: true }), [], mainBlobs([['a.ts', 'blob1']]));
  assert.equal(tooBig.action, 'REVIEW');
  const noTree = classifyBranch({
    config,
    info: info(),
    prs: [],
    mainBlobs: { map: new Map([['a.ts', 'blob1']]), truncated: true },
    now,
  });
  assert.equal(noTree.action, 'REVIEW');
});

test('parked and recent work is kept; old parked work is flagged, not deleted', () => {
  assert.equal(
    decide(info({ name: 'wip/a', lastCommitDate: daysAgo(20) }), [], mainBlobs([['a.ts', 'z']]))
      .action,
    'KEEP',
  );
  assert.equal(
    decide(info({ name: 'wip/a', lastCommitDate: daysAgo(60) }), [], mainBlobs([['a.ts', 'z']]))
      .action,
    'REVIEW',
  );
  assert.equal(
    decide(info({ lastCommitDate: daysAgo(3) }), [], mainBlobs([['a.ts', 'z']])).action,
    'KEEP',
  );
});

function fakeGh({ branches, prsByHead = {}, artifacts = [], caches = [], pulls = {} }) {
  const deleted = [];
  return {
    deleted,
    async get(path) {
      if (path.includes('/git/trees/'))
        return { tree: [{ type: 'blob', path: 'a.ts', sha: 'blob1' }] };
      if (path.includes('/compare/')) {
        const name = decodeURIComponent(path.split('...')[1].split('?')[0]);
        return branches[name].compare;
      }
      if (path.includes('/pulls?state=all&head=')) {
        const name = decodeURIComponent(path.split('head=')[1]).split(':')[1];
        return prsByHead[name] ?? [];
      }
      const pull = path.match(/pulls\/(\d+)$/);
      if (pull) return pulls[pull[1]];
      throw new Error(`unexpected ${path}`);
    },
    async list(path) {
      if (path.endsWith('/branches')) {
        return [
          { name: 'main', commit: { sha: 'm' } },
          ...Object.entries(branches).map(([name, b]) => ({ name, commit: { sha: b.sha } })),
        ];
      }
      if (path.includes('/artifacts')) return artifacts;
      if (path.includes('/caches')) return caches;
      return [];
    },
    async del(path) {
      deleted.push(path);
    },
  };
}

const compare = (ahead, files, date) => ({
  status: ahead ? 'ahead' : 'behind',
  ahead_by: ahead,
  behind_by: 0,
  files,
  commits: ahead ? [{ sha: SHA, commit: { message: 'm', committer: { date } } }] : [],
});

test('apply deletes only the proven branches; a dry run deletes nothing', async () => {
  const branches = {
    'claude/merged': {
      sha: SHA,
      compare: compare(1, [{ filename: 'a.ts', status: 'modified', sha: 'zz' }], daysAgo(9)),
    },
    'claude/work': {
      sha: 'c'.repeat(40),
      compare: compare(1, [{ filename: 'b.ts', status: 'added', sha: 'q' }], daysAgo(9)),
    },
  };
  const prsByHead = {
    'claude/merged': [{ state: 'closed', number: 4, merged_at: 'x', head: { sha: SHA } }],
  };

  const dry = fakeGh({ branches, prsByHead });
  const dryResult = await sweepBranches({ gh: dry, config, apply: false, now });
  assert.equal(dry.deleted.length, 0);
  assert.deepEqual(dryResult.decisions.map((d) => d.action).sort(), ['DELETE', 'REVIEW']);

  const live = fakeGh({ branches, prsByHead });
  const result = await sweepBranches({ gh: live, config, apply: true, now });
  assert.deepEqual(live.deleted, ['repos/o/r/git/refs/heads/claude/merged']);
  assert.equal(result.deleted[0].sha, SHA);
});

test('artifacts: old and expired go, recent stay', async () => {
  const artifacts = [
    { id: 1, created_at: daysAgo(10), size_in_bytes: 100 },
    { id: 2, created_at: daysAgo(1), size_in_bytes: 100 },
    { id: 3, created_at: daysAgo(1), expired: true, size_in_bytes: 5 },
  ];
  const gh = fakeGh({ branches: {}, artifacts });
  const result = await sweepArtifacts({ gh, config, apply: true, now });
  assert.deepEqual(gh.deleted.sort(), [
    'repos/o/r/actions/artifacts/1',
    'repos/o/r/actions/artifacts/3',
  ]);
  assert.equal(result.found, 3);
});

test('caches: main is always kept, closed pull request caches and idle caches go', async () => {
  const caches = [
    { id: 1, ref: 'refs/heads/main', last_accessed_at: daysAgo(30), size_in_bytes: 1 },
    { id: 2, ref: 'refs/pull/9/merge', last_accessed_at: daysAgo(0), size_in_bytes: 1 },
    { id: 3, ref: 'refs/pull/10/merge', last_accessed_at: daysAgo(0), size_in_bytes: 1 },
    { id: 4, ref: 'refs/heads/claude/x', last_accessed_at: daysAgo(20), size_in_bytes: 1 },
  ];
  const gh = fakeGh({
    branches: {},
    caches,
    pulls: { 9: { state: 'closed' }, 10: { state: 'open' } },
  });
  await sweepCaches({ gh, config, apply: true, now });
  assert.deepEqual(gh.deleted.sort(), ['repos/o/r/actions/caches/2', 'repos/o/r/actions/caches/4']);
});

test('a level branch is judged by the long window, a renamed file needs the old path gone', () => {
  assert.equal(decide(info({ ahead: 0, lastCommitDate: daysAgo(3) })).action, 'KEEP');
  assert.equal(
    decide(info({ ahead: 0, lastCommitDate: daysAgo(3) }), [
      { state: 'closed', number: 2, merged_at: 'x', head: { sha: SHA } },
    ]).action,
    'DELETE',
  );
  assert.equal(decide(info({ ahead: 0, lastCommitDate: null })).action, 'KEEP');
  const renamed = info({
    files: [{ path: 'b.ts', previous: 'a.ts', status: 'renamed', sha: 'blob1' }],
  });
  assert.equal(decide(renamed, [], mainBlobs([['b.ts', 'blob1']])).action, 'DELETE');
  assert.equal(
    decide(
      renamed,
      [],
      mainBlobs([
        ['b.ts', 'blob1'],
        ['a.ts', 'old'],
      ]),
    ).action,
    'REVIEW',
  );
});

test('a branch that disappears mid-run is skipped, not fatal', async () => {
  const branches = { 'claude/gone': { sha: SHA, compare: null } };
  const gh = fakeGh({ branches });
  const original = gh.get.bind(gh);
  gh.get = async (path) => {
    if (path.includes('/compare/')) throw new Error('HTTP 404');
    return original(path);
  };
  const result = await sweepBranches({ gh, config, apply: true, now });
  assert.equal(result.decisions.length, 0);
  assert.equal(gh.deleted.length, 0);
});
