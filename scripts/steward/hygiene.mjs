#!/usr/bin/env node
// Steward hygiene: finds what is obsolete and removes only what can be PROVEN obsolete.
//
//   node scripts/steward/hygiene.mjs                  dry run (default): report only
//   node scripts/steward/hygiene.mjs --apply          delete proven branches, old artifacts, stale caches
//   --scope branches,artifacts,caches                 limit the sweep (default: all three)
//   --verbose                                         also list what is kept and why
//
// Three outcomes per branch. DELETE means a proof was found (see classifyBranch). REVIEW means a
// person decides: the tool never deletes it. KEEP means in use or too recent to judge.
// Deleted branches are recoverable: the sha is printed with the exact restore command.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  GhError,
  createGh,
  daysBetween,
  describeBranch,
  encodeRef,
  isProtectedBranch,
  listBranches,
  loadConfig,
  mainBlobMap,
  mapLimit,
  say,
} from './lib.mjs';

// ---------- branches ----------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function containedInMain(info, mainBlobs) {
  if (info.truncated || mainBlobs.truncated) return false;
  return info.files.every((file) => {
    if (file.status === 'removed') return !mainBlobs.map.has(file.path);
    // A rename also removes the old path: main must have dropped it too.
    if (file.previous && mainBlobs.map.has(file.previous)) return false;
    return mainBlobs.map.get(file.path) === file.sha;
  });
}

/** Pure decision for one branch. `prs` is every pull request ever opened from this branch. */
export function classifyBranch({
  config,
  info,
  prs,
  mainBlobs,
  currentBranch = '',
  now = new Date(),
}) {
  const idle = info.lastCommitDate
    ? daysBetween(info.lastCommitDate, now)
    : Number.POSITIVE_INFINITY;
  const base = { name: info.name, sha: info.sha, ahead: info.ahead, idleDays: Math.round(idle) };
  const keep = (reason) => ({ ...base, action: 'KEEP', reason });
  const review = (reason) => ({ ...base, action: 'REVIEW', reason });
  const remove = (reason) => ({ ...base, action: 'DELETE', reason });

  if (info.name === currentBranch) return keep('this session works on it');
  if (isProtectedBranch(info.name, config)) return keep('protected by the config');
  const open = prs.find((pr) => pr.state === 'open');
  if (open) return keep(`open PR #${open.number}`);
  if (!info.lastCommitDate) return keep('last activity unknown');
  if (idle * 24 < config.retention.graceHours) {
    return keep(`touched ${Math.max(1, Math.round(idle * 24))} hours ago`);
  }
  if (info.ahead === 0) {
    // A session branch starts level with main and carries main's (possibly old) tip date, so a
    // level branch with no pull request is only judged obsolete after the longer stale window.
    if (prs.length === 0 && idle <= config.retention.laneStaleDays) {
      return keep('new branch with no work yet');
    }
    return remove('nothing on it that main lacks');
  }
  const merged = prs.find((pr) => pr.merged_at && pr.head.sha === info.sha);
  if (merged)
    return remove(`PR #${merged.number} merged and the branch tip equals the merged head`);
  if (containedInMain(info, mainBlobs)) {
    return remove(
      info.files.length
        ? `every one of its ${info.files.length} changed files is identical on main`
        : 'it changes no files',
    );
  }
  const parked = config.parkedPrefixes.some((prefix) => info.name.startsWith(prefix));
  if (parked) {
    return idle > config.retention.parkedReviewDays
      ? review(
          `parked and untouched ${Math.round(idle)} days, ${plural(info.ahead, 'commit')} not on main`,
        )
      : keep(`parked work, ${Math.round(idle)} days old`);
  }
  const closed = prs.find((pr) => pr.state === 'closed' && !pr.merged_at);
  if (closed)
    return review(
      `PR #${closed.number} was closed without merging; ${plural(info.ahead, 'commit')} not on main`,
    );
  const earlier = prs.find((pr) => pr.merged_at);
  if (earlier) {
    return review(
      `PR #${earlier.number} merged earlier but newer work is not on main (${plural(info.ahead, 'commit')})`,
    );
  }
  if (idle > config.retention.laneStaleDays) {
    return review(
      `no PR, ${plural(info.ahead, 'commit')} not on main, idle ${Math.round(idle)} days`,
    );
  }
  return keep(`recent work, idle ${Math.round(idle)} days`);
}

export async function sweepBranches({ gh, config, apply, currentBranch = '', now = new Date() }) {
  const owner = config.repo.split('/')[0];
  const [branches, mainBlobs] = await Promise.all([
    listBranches(gh, config),
    mainBlobMap(gh, config),
  ]);
  const judged = await mapLimit(branches, 6, async (branch) => {
    try {
      const info = await describeBranch(gh, config, branch);
      const prs = await gh.get(
        `repos/${config.repo}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch.name}`)}`,
      );
      return classifyBranch({ config, info, prs, mainBlobs, currentBranch, now });
    } catch (error) {
      if (error instanceof GhError && error.denied) throw error;
      return null; // the branch vanished mid-run (another session or the workflow removed it)
    }
  });
  const decisions = judged.filter(Boolean);
  const deleted = [];
  const failed = [];
  if (apply) {
    for (const decision of decisions.filter((d) => d.action === 'DELETE')) {
      try {
        await gh.del(`repos/${config.repo}/git/refs/heads/${encodeRef(decision.name)}`);
        deleted.push(decision);
      } catch (error) {
        failed.push({ ...decision, error: error.message });
      }
    }
  }
  return { decisions, deleted, failed };
}

// ---------- artifacts and caches (safe: both are rebuilt on demand) ----------

const mb = (bytes) => `${(bytes / 1_048_576).toFixed(1)} MB`;

export async function sweepArtifacts({ gh, config, apply, now = new Date() }) {
  const all = await gh.list(`repos/${config.repo}/actions/artifacts`, 'artifacts');
  const old = all.filter(
    (a) => a.expired || daysBetween(a.created_at, now) > config.retention.artifactDays,
  );
  let removed = 0;
  if (apply) {
    await mapLimit(old, 6, async (artifact) => {
      try {
        await gh.del(`repos/${config.repo}/actions/artifacts/${artifact.id}`);
        removed += 1;
      } catch {
        // already gone (expired) or raced with another delete: nothing to do
      }
    });
  }
  return {
    found: all.length,
    old: old.length,
    bytes: old.reduce((sum, a) => sum + (a.size_in_bytes ?? 0), 0),
    removed,
  };
}

export async function sweepCaches({ gh, config, apply, now = new Date() }) {
  const caches = await gh.list(`repos/${config.repo}/actions/caches`, 'actions_caches');
  const defaultRef = `refs/heads/${config.defaultBranch}`;
  const prState = new Map();
  async function pullIsClosed(ref) {
    const number = (ref.match(/^refs\/pull\/(\d+)\//) ?? [])[1];
    if (!number) return false;
    if (!prState.has(number)) {
      const pr = await gh.get(`repos/${config.repo}/pulls/${number}`).catch(() => null);
      prState.set(number, pr ? pr.state === 'closed' : false);
    }
    return prState.get(number);
  }
  const doomed = [];
  for (const cache of caches) {
    if (cache.ref === defaultRef) continue; // main's caches make every build faster: keep
    const closedPull = await pullIsClosed(cache.ref);
    if (closedPull || daysBetween(cache.last_accessed_at, now) > config.retention.cacheDays) {
      doomed.push(cache);
    }
  }
  let removed = 0;
  if (apply) {
    await mapLimit(doomed, 6, async (cache) => {
      try {
        await gh.del(`repos/${config.repo}/actions/caches/${cache.id}`);
        removed += 1;
      } catch {
        // already evicted
      }
    });
  }
  return {
    found: caches.length,
    old: doomed.length,
    bytes: doomed.reduce((sum, c) => sum + (c.size_in_bytes ?? 0), 0),
    removed,
  };
}

// ---------- CLI ----------

export function renderBranches(result, config, { apply, verbose }) {
  const out = [];
  const count = (action) => result.decisions.filter((d) => d.action === action).length;
  out.push(
    `branches: ${result.decisions.length} checked | ${count('DELETE')} proven obsolete | ` +
      `${count('REVIEW')} need a person | ${count('KEEP')} kept`,
  );
  const order = { DELETE: 0, REVIEW: 1, KEEP: 2 };
  for (const d of [...result.decisions].sort((a, b) => order[a.action] - order[b.action])) {
    if (d.action === 'KEEP' && !verbose) continue;
    out.push(`  ${d.action.padEnd(6)} ${d.name} - ${d.reason}`);
  }
  if (apply && result.deleted.length) {
    out.push(`deleted ${result.deleted.length}. To restore one:`);
    for (const d of result.deleted) {
      out.push(
        `  gh api -X POST repos/${config.repo}/git/refs -f ref=refs/heads/${d.name} -f sha=${d.sha}`,
      );
    }
  }
  for (const f of result.failed) out.push(`  could not delete ${f.name}: ${f.error}`);
  return out;
}

function parseScope(argv) {
  const at = argv.indexOf('--scope');
  const raw = at >= 0 ? (argv[at + 1] ?? '') : 'branches,artifacts,caches';
  return new Set(raw.split(',').map((part) => part.trim()));
}

async function guarded(label, fn, out) {
  try {
    return await fn();
  } catch (error) {
    out.push(
      error instanceof GhError && error.denied
        ? `${label}: not permitted from here (the scheduled workflow handles it)`
        : `${label}: failed - ${error.message}`,
    );
    return null;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const verbose = argv.includes('--verbose');
  const scope = parseScope(argv);
  const config = loadConfig(process.cwd());
  const gh = createGh();
  const now = new Date();
  const out = [`HYGIENE ${apply ? 'applied' : 'dry run (nothing deleted)'} - ${config.repo}`];
  if (scope.has('branches')) {
    const currentBranch = await new Promise((resolve) => {
      execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], (error, stdout) =>
        resolve(error ? '' : stdout.trim()),
      );
    });
    const result = await guarded(
      'branches',
      () => sweepBranches({ gh, config, apply, currentBranch, now }),
      out,
    );
    if (result) out.push(...renderBranches(result, config, { apply, verbose }));
  }
  for (const [label, sweep] of [
    ['artifacts', sweepArtifacts],
    ['caches', sweepCaches],
  ]) {
    if (!scope.has(label)) continue;
    const result = await guarded(label, () => sweep({ gh, config, apply, now }), out);
    if (result) {
      out.push(
        `${label}: ${result.found} found | ${result.old} past retention (${mb(result.bytes)})${apply ? ` | ${result.removed} removed` : ''}`,
      );
    }
  }
  say(out.join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
