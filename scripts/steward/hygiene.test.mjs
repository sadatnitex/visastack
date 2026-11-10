import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyBranch,
  dropFailures,
  parseDrop,
  renderBranches,
  sweepArtifacts,
  sweepBranches,
  sweepCaches,
} from './hygiene.mjs';

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

function fakeGh({
  branches,
  prsByHead = {},
  artifacts = [],
  caches = [],
  pulls = {},
  openPrs = [],
  refTips = {},
  failDelete = [],
}) {
  const deleted = [];
  const listed = [];
  return {
    deleted,
    listed,
    async get(path) {
      const ref = path.match(/\/git\/ref\/heads\/(.+)$/);
      if (ref) {
        const name = decodeURIComponent(ref[1]);
        return { object: { sha: refTips[name] ?? branches[name].sha } };
      }
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
      listed.push(path);
      if (path.endsWith('/pulls?state=open')) return openPrs;
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
      if (failDelete.some((name) => path.endsWith(name))) throw new Error('HTTP 502');
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

test('a branch that cannot be checked is kept, not skipped and not deleted', async () => {
  const branches = { 'claude/gone': { sha: SHA, compare: null } };
  const gh = fakeGh({ branches });
  const original = gh.get.bind(gh);
  gh.get = async (path) => {
    if (path.includes('/compare/')) throw new Error('HTTP 404');
    return original(path);
  };
  const result = await sweepBranches({ gh, config, apply: true, now });
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].action, 'KEEP');
  assert.match(result.decisions[0].reason, /could not be checked/);
  assert.equal(gh.deleted.length, 0);
});

const T1 = 'a'.repeat(40);
const T2 = 'b'.repeat(40);
const T3 = 'c'.repeat(40);
const T4 = 'd'.repeat(40);
const T5 = 'e'.repeat(40);
const ownWork = (date) =>
  compare(1, [{ filename: 'only-here.ts', status: 'added', sha: 'zz' }], date);

function ownerDropFixture(extra = {}) {
  return fakeGh({
    branches: {
      'umpe/old': { sha: T1, compare: ownWork(daysAgo(10)) },
      'keep/me': { sha: T2, compare: ownWork(daysAgo(10)) },
      'claude/busy': { sha: T3, compare: ownWork(daysAgo(10)) },
      'claude/base': { sha: T4, compare: ownWork(daysAgo(10)) },
      'claude/fresh': { sha: T5, compare: ownWork(daysAgo(0.2)) },
    },
    openPrs: [
      { number: 9, head: { ref: 'claude/busy' }, base: { ref: 'main' } },
      { number: 10, head: { ref: 'claude/child' }, base: { ref: 'claude/base' } },
    ],
    ...extra,
  });
}
const everyone = parseDrop(
  'umpe/old,keep/me,claude/busy,claude/base,claude/fresh,no/such,main,umpe/old',
);

test('an owner drop is a dry run first and still refuses every hard keep', async () => {
  const gh = ownerDropFixture();
  const result = await sweepBranches({ gh, config, apply: false, now, drop: everyone });
  assert.equal(gh.deleted.length, 0);
  const by = Object.fromEntries(result.decisions.map((d) => [d.name, d]));
  assert.equal(by['umpe/old'].action, 'DELETE');
  assert.match(by['umpe/old'].reason, /the owner chose to drop it \(no PR, 1 commit not on main/);
  assert.match(by['keep/me'].reason, /protected/);
  assert.match(by['claude/busy'].reason, /open PR #9/);
  assert.match(by['claude/base'].reason, /base of open PR #10/);
  assert.match(by['claude/fresh'].reason, /hours ago/);
  assert.equal(by['no/such'].reason, 'no such branch');
  assert.equal(by.main.reason, 'the default branch is never deleted');
  assert.equal(result.decisions.length, 7, 'a name listed twice is judged once');
  for (const name of ['keep/me', 'claude/busy', 'claude/base', 'claude/fresh', 'no/such', 'main']) {
    assert.equal(by[name].action, 'KEEP', name);
    assert.equal(by[name].hard, true, name);
  }
  assert.ok(gh.listed.some((path) => path.endsWith('/pulls?state=open')));
});

test('applying an owner drop deletes only the clear one and reports the rest as failures', async () => {
  const gh = ownerDropFixture();
  const result = await sweepBranches({ gh, config, apply: true, now, drop: everyone });
  assert.deepEqual(gh.deleted, ['repos/o/r/git/refs/heads/umpe/old']);
  assert.deepEqual(dropFailures(result, everyone).sort(), [
    'claude/base',
    'claude/busy',
    'claude/fresh',
    'keep/me',
    'main',
    'no/such',
  ]);
  const text = renderBranches(result, config, { apply: true, verbose: false, named: true }).join(
    '\n',
  );
  assert.match(text, /1 to delete/);
  assert.match(text, new RegExp(`-f sha=${T1}`));
  assert.deepEqual(dropFailures(result, parseDrop('umpe/old')), []);
});

test('an owner drop pinned to the reviewed tip keeps a branch whose tip has moved', async () => {
  const drop = parseDrop('umpe/old@aaaaaaa,claude/base@1234567');
  assert.deepEqual(
    [...drop.entries()],
    [
      ['umpe/old', { pin: 'aaaaaaa' }],
      ['claude/base', { pin: '1234567' }],
    ],
  );
  assert.deepEqual(parseDrop('feature@x').get('feature@x'), { pin: null });
  const gh = ownerDropFixture();
  const result = await sweepBranches({ gh, config, apply: true, now, drop });
  const by = Object.fromEntries(result.decisions.map((d) => [d.name, d]));
  assert.equal(by['umpe/old'].action, 'DELETE');
  assert.match(by['claude/base'].reason, /base of open PR/);
  const moved = await sweepBranches({
    gh: ownerDropFixture(),
    config,
    apply: true,
    now,
    drop: parseDrop('umpe/old@bbbbbbb'),
  });
  assert.match(moved.decisions[0].reason, /tip moved since it was reviewed/);
  assert.equal(moved.decisions[0].action, 'KEEP');
});

test('a push between the check and the delete keeps the branch, and a failed delete shows its tip', async () => {
  const raced = ownerDropFixture({ refTips: { 'umpe/old': T3 } });
  const first = await sweepBranches({
    gh: raced,
    config,
    apply: true,
    now,
    drop: parseDrop('umpe/old'),
  });
  assert.equal(raced.deleted.length, 0);
  assert.match(first.failed[0].error, new RegExp(`was ${T1}, now ${T3}`));

  const broken = ownerDropFixture({ failDelete: ['umpe/old'] });
  const second = await sweepBranches({
    gh: broken,
    config,
    apply: true,
    now,
    drop: parseDrop('umpe/old'),
  });
  assert.equal(second.deleted.length, 0);
  assert.match(second.failed[0].error, new RegExp(`HTTP 502 \\(tip was ${T1}\\)`));
});
