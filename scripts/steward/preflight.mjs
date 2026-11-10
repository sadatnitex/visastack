#!/usr/bin/env node
// Steward preflight: one read-only look at the whole repository before any session plans work.
//
//   node scripts/steward/preflight.mjs --brief                 session-start brief (a hook runs this)
//   node scripts/steward/preflight.mjs --plan "a/**,b.ts"      will my planned paths collide with a live lane?
//   node scripts/steward/preflight.mjs --topic "words"         has this already been done or started?
//   add --migration to reserve the next migration number, --json for machine output
//
// It never writes anything. Exit code is 0 unless --strict is given and a blocking problem exists.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  createGh,
  daysBetween,
  describeBranch,
  formatClaim,
  isProtectedBranch,
  listBranches,
  loadConfig,
  localMigrationFiles,
  mapLimit,
  matchesGlob,
  migrationNumber,
  padMigration,
  parseClaim,
  patternsOverlap,
  say,
  topicMatches,
} from './lib.mjs';

const execFileAsync = promisify(execFile);

// ---------- pure analysis (unit tested) ----------

export function ciState(checkRuns, requiredChecks) {
  // A name can appear several times (skipped duplicates, re-runs). Skipped runs say nothing.
  let green = 0;
  let waiting = false;
  for (const name of requiredChecks) {
    const runs = checkRuns.filter(
      (r) =>
        r.name === name &&
        !(r.status === 'completed' && ['skipped', 'neutral'].includes(r.conclusion)),
    );
    if (runs.some((r) => r.status === 'completed' && r.conclusion !== 'success')) return 'red';
    if (runs.some((r) => r.status !== 'completed')) waiting = true;
    else if (runs.length) green += 1;
  }
  if (green === requiredChecks.length) return 'green';
  return waiting || checkRuns.length ? 'pending' : 'unknown';
}

export function hotRulesFor(paths, config) {
  const rules = new Map();
  for (const path of paths) {
    for (const hot of config.hotFiles) {
      if (patternsOverlap(hot.glob, path)) rules.set(hot.glob, hot);
    }
  }
  return [...rules.values()];
}

const isHot = (path, config) => config.hotFiles.some((hot) => matchesGlob(hot.glob, path));

function buildLane(branch, pr, config, currentBranch, now) {
  const idle = branch.lastCommitDate
    ? daysBetween(branch.lastCommitDate, now)
    : Number.POSITIVE_INFINITY;
  const claim = (pr ? parseClaim(pr.body) : null) ?? branch.claim ?? null;
  const paths = branch.files.map((f) => f.path);
  const migrations = paths.map((p) => migrationNumber(p, config)).filter((n) => n !== null);
  if (claim?.migration) migrations.push(Number(claim.migration));
  const isLaneName = config.laneBranchPrefixes.some((prefix) => branch.name.startsWith(prefix));
  const live = Boolean(pr) || (isLaneName && idle < config.retention.laneStaleDays);
  return {
    name: branch.name,
    pr: pr ? { number: pr.number, draft: pr.draft, title: pr.title } : null,
    ahead: branch.ahead,
    behind: branch.behind,
    files: paths,
    truncated: branch.truncated,
    claimPaths: claim?.paths ?? [],
    claimArea: claim?.area ?? '',
    migrations,
    idleDays: Math.round(idle * 10) / 10,
    live,
    mine: branch.name === currentBranch,
  };
}

export function findOverlaps(lanes, config) {
  const live = lanes.filter((lane) => lane.live);
  const overlaps = [];
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const a = live[i];
      const b = live[j];
      const shared = a.files.filter((file) => b.files.includes(file));
      const real = shared.filter((file) => !isHot(file, config));
      const hot = shared.filter((file) => isHot(file, config));
      const soft = [];
      for (const [x, y] of [
        [a, b],
        [b, a],
      ]) {
        for (const pattern of x.claimPaths) {
          const hit = [...y.files, ...y.claimPaths].find((other) =>
            patternsOverlap(pattern, other),
          );
          if (hit && !shared.includes(hit) && !soft.includes(hit)) soft.push(hit);
        }
      }
      if (real.length || hot.length || soft.length) {
        overlaps.push({ a: a.name, b: b.name, real, hot, soft });
      }
    }
  }
  return overlaps;
}

export function migrationState({ mainPaths, lanes, config }) {
  if (!config.migrations) return null;
  const onMain = mainPaths.map((p) => migrationNumber(p, config)).filter((n) => n !== null);
  const reserved = {};
  for (const lane of lanes) {
    if (lane.live && lane.migrations.length)
      reserved[lane.name] = lane.migrations.map(padMigration);
  }
  const all = [...onMain, ...Object.values(reserved).flat().map(Number)];
  return {
    latestOnMain: padMigration(Math.max(0, ...onMain)),
    reserved,
    next: padMigration(Math.max(0, ...all) + 1),
  };
}

/** Decides what a planned set of paths means for the other live lanes. */
export function checkPlan({ planPaths, lanes, config, wantsMigration, migration }) {
  const others = lanes.filter((lane) => lane.live && !lane.mine);
  const conflicts = [];
  for (const lane of others) {
    // Shared "hot" files get rules, not a collision; a broad plan still collides on everything else.
    const theirs = [...lane.files, ...lane.claimPaths].filter((other) => !isHot(other, config));
    const real = planPaths.filter((pattern) =>
      theirs.some((other) => patternsOverlap(pattern, other)),
    );
    if (real.length)
      conflicts.push({ lane: lane.name, pr: lane.pr?.number ?? null, paths: real.slice(0, 5) });
  }
  const rules = hotRulesFor(planPaths, config);
  const touchesMigrations =
    wantsMigration ||
    (config.migrations && planPaths.some((p) => patternsOverlap(`${config.migrations.dir}/**`, p)));
  let verdict = 'PROCEED';
  if (rules.length || touchesMigrations) verdict = 'PROCEED_WITH_RULES';
  if (conflicts.length) verdict = 'SERIALIZE';
  return {
    verdict,
    conflicts,
    rules,
    migration: touchesMigrations ? (migration?.next ?? null) : null,
    claim: formatClaim({
      paths: planPaths,
      migration: touchesMigrations ? (migration?.next ?? null) : null,
    }),
  };
}

export function analyse({
  config,
  mainSha,
  mainCi,
  branches,
  openPrs,
  mainPaths,
  currentBranch,
  now,
}) {
  const prByBranch = new Map(openPrs.map((pr) => [pr.head.ref, pr]));
  const lanes = branches
    .filter((b) => !isProtectedBranch(b.name, config) || prByBranch.has(b.name))
    .filter((b) => b.ahead > 0 || prByBranch.has(b.name))
    .map((b) => buildLane(b, prByBranch.get(b.name), config, currentBranch, now));
  const liveNames = new Set(lanes.filter((lane) => lane.live).map((lane) => lane.name));
  return {
    mainSha,
    mainCi,
    openPrs: openPrs.length,
    lanes,
    overlaps: findOverlaps(lanes, config),
    migration: migrationState({ mainPaths, lanes, config }),
    branchesOutsideLiveWork: branches.filter(
      (b) =>
        !isProtectedBranch(b.name, config) && b.name !== currentBranch && !liveNames.has(b.name),
    ).length,
  };
}

// ---------- rendering ----------

const short = (sha) => sha.slice(0, 7);

function summarisePaths(files) {
  const dirs = new Map();
  for (const file of files) {
    const dir = file.split('/').slice(0, 4).join('/');
    dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
  }
  const top = [...dirs.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2);
  const text = top.map(([dir, n]) => `${dir} (${n})`).join(', ');
  return dirs.size > 2 ? `${text}, +${dirs.size - 2} more` : text;
}

export function render(report, { plan = null, topic = null } = {}) {
  const out = [];
  const liveLanes = report.lanes.filter((lane) => lane.live);
  out.push(
    `STEWARD main ${short(report.mainSha)} | CI ${report.mainCi} | ${report.openPrs} open PR | ${liveLanes.length} live lane${liveLanes.length === 1 ? '' : 's'}${report.migration ? ` | next migration ${report.migration.next}` : ''}`,
  );
  if (report.mainCi === 'red') out.push('! main is red: fixing it comes before any new work.');
  for (const lane of liveLanes) {
    const tag = lane.pr ? `#${lane.pr.number}${lane.pr.draft ? ' draft' : ''}` : 'no PR';
    const idle = lane.idleDays >= 1 ? `, idle ${Math.round(lane.idleDays)}d` : '';
    const claim = lane.claimArea ? `, claim: ${lane.claimArea}` : '';
    const mig = lane.migrations.length
      ? `, migration ${lane.migrations.map(padMigration).join('/')}`
      : '';
    out.push(
      `  ${lane.mine ? '*' : ' '} ${lane.name} ${tag}, ahead ${lane.ahead}${idle}${mig}${claim}${lane.files.length ? ` - ${summarisePaths(lane.files)}` : ''}`,
    );
  }
  if (report.overlaps.length === 0) {
    out.push('overlaps: none');
  } else {
    for (const o of report.overlaps) {
      const bits = [];
      if (o.real.length)
        bits.push(
          `${o.real.length} shared file${o.real.length === 1 ? '' : 's'} (${o.real.slice(0, 2).join(', ')})`,
        );
      if (o.hot.length)
        bits.push(`${o.hot.length} shared append-only/hot file${o.hot.length === 1 ? '' : 's'}`);
      if (o.soft.length) bits.push(`claimed area overlap (${o.soft.slice(0, 2).join(', ')})`);
      out.push(`! overlap ${o.a} <> ${o.b}: ${bits.join('; ')}`);
    }
  }
  const stray = report.branchesOutsideLiveWork;
  if (stray > 0) {
    out.push(
      `hygiene: ${stray} branch${stray === 1 ? '' : 'es'} outside live work - run: node scripts/steward/hygiene.mjs`,
    );
  }
  if (topic?.hits.length) {
    out.push('possible earlier work on this topic:');
    for (const hit of topic.hits) out.push(`  ${hit.where}: ${hit.subject}`);
  } else if (topic) {
    out.push('topic: nothing similar on main, in open PRs or on other branches');
  }
  if (plan) {
    out.push(`PLAN ${plan.verdict}`);
    for (const c of plan.conflicts) {
      out.push(
        `  collides with ${c.lane}${c.pr ? ` (#${c.pr})` : ''} on ${c.paths.join(', ')}: finish after it merges, or send the change to that session instead of editing here`,
      );
    }
    for (const rule of plan.rules)
      out.push(`  ${rule.glob}: ${rule.rule}${rule.how ? ` (${rule.how})` : ''}`);
    if (plan.migration) out.push(`  reserve migration ${plan.migration} in the claim below`);
    out.push('  paste into the draft PR description:');
    for (const line of plan.claim.split('\n')) out.push(`  ${line}`);
  }
  return out.join('\n');
}

// ---------- collection ----------

async function currentBranchName() {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    return stdout.trim();
  } catch {
    return '';
  }
}

/** Only the migration folder is needed from main, so list that folder instead of the whole tree. */
async function mainMigrationFiles(gh, config, cwd) {
  if (!config.migrations) return [];
  try {
    const dir = config.migrations.dir;
    const entries = await gh.get(
      `repos/${config.repo}/contents/${dir}?ref=${encodeURIComponent(config.defaultBranch)}`,
    );
    return entries.map((entry) => `${dir}/${entry.name}`);
  } catch {
    return localMigrationFiles(cwd, config);
  }
}

export async function collect({ gh, config, cwd, now = new Date(), withTopicSubjects = false }) {
  const base = config.defaultBranch;
  const [head, openPrs, branches, migrationFiles] = await Promise.all([
    gh.get(`repos/${config.repo}/commits/${base}`),
    gh.list(`repos/${config.repo}/pulls?state=open`),
    listBranches(gh, config),
    mainMigrationFiles(gh, config, cwd),
  ]);
  const checks = await gh
    .get(`repos/${config.repo}/commits/${head.sha}/check-runs?per_page=100`)
    .then((reply) => reply.check_runs ?? [])
    .catch(() => []);
  // A branch can vanish mid-run (hygiene or another session deleted it): skip it, do not fail.
  const described = (
    await mapLimit(branches, 6, (b) => describeBranch(gh, config, b).catch(() => null))
  ).filter(Boolean);
  const mainPaths = migrationFiles;
  let subjects = [];
  if (withTopicSubjects) {
    const since = new Date(now.getTime() - 90 * 86_400_000).toISOString();
    const commits = await gh.list(`repos/${config.repo}/commits?sha=${base}&since=${since}`, null, {
      maxPages: 3,
    });
    subjects = commits.map((c) => ({
      where: `main ${short(c.sha)}`,
      subject: (c.commit.message ?? '').split('\n')[0],
    }));
    for (const pr of openPrs) subjects.push({ where: `open PR #${pr.number}`, subject: pr.title });
    for (const b of described) {
      if (b.lastSubject) subjects.push({ where: `branch ${b.name}`, subject: b.lastSubject });
    }
  }
  return {
    mainSha: head.sha,
    mainCi: ciState(checks, config.requiredChecks),
    branches: described,
    openPrs: openPrs.filter((pr) => pr.head.repo?.full_name === config.repo),
    mainPaths,
    subjects,
  };
}

// ---------- CLI ----------

function parseArgs(argv) {
  const args = { flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    if (['plan', 'topic'].includes(name)) {
      args.values[name] = argv[i + 1] ?? '';
      i += 1;
    } else {
      args.flags.add(name);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const soft = args.flags.has('soft');
  try {
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    const gh = createGh();
    const now = new Date();
    const topicText = args.values.topic ?? '';
    const data = await collect({ gh, config, cwd, now, withTopicSubjects: Boolean(topicText) });
    const currentBranch = await currentBranchName();
    const report = analyse({ ...data, config, currentBranch, now });
    const planPaths = (args.values.plan ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const plan = planPaths.length
      ? checkPlan({
          planPaths,
          lanes: report.lanes,
          config,
          wantsMigration: args.flags.has('migration'),
          migration: report.migration,
        })
      : null;
    const topic = topicText ? { hits: topicMatches(topicText, data.subjects) } : null;
    if (args.flags.has('json')) {
      say(JSON.stringify({ report, plan, topic }, null, 2));
    } else {
      say(render(report, { plan, topic }));
    }
    if (args.flags.has('strict') && (report.mainCi === 'red' || plan?.verdict === 'SERIALIZE')) {
      process.exitCode = 2;
    }
  } catch (error) {
    say(`STEWARD unavailable: ${error.message}`);
    if (!soft) process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
