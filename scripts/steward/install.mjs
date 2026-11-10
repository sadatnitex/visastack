#!/usr/bin/env node
// Installs the Steward kit into another repository so one coordinator serves every project.
//
//   node scripts/steward/install.mjs <path-to-target-repo> [--repo owner/name] [--force] [--with-workflow]
//
// Copies the scripts, the agent and the slash command, writes a starter config (never over an
// existing one unless --force) and adds the session-start hook to .claude/settings.json without
// touching hooks that are already there. Review the generated config before relying on it.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { say } from './lib.mjs';

const KIT_FILES = [
  'scripts/steward/lib.mjs',
  'scripts/steward/preflight.mjs',
  'scripts/steward/hygiene.mjs',
  'scripts/steward/audit.mjs',
  'scripts/steward/install.mjs',
  '.claude/agents/steward.md',
  '.claude/commands/steward.md',
];

// Deletes branches, artifacts and caches on a schedule, so it is never installed unasked.
const WORKFLOW_FILE = '.github/workflows/steward-hygiene.yml';

export const HOOK_COMMAND =
  'node "$CLAUDE_PROJECT_DIR/scripts/steward/preflight.mjs" --brief --soft';

export function starterConfig(repo) {
  return {
    repo,
    defaultBranch: 'main',
    requiredChecks: [],
    laneBranchPrefixes: ['claude/'],
    protectedBranches: [],
    parkedPrefixes: ['wip/'],
    hotFiles: [
      { glob: 'pnpm-lock.yaml', rule: 'generated', how: 'never merge by hand; regenerate' },
    ],
    retention: {
      graceHours: 48,
      laneStaleDays: 7,
      parkedReviewDays: 45,
      artifactDays: 3,
      cacheDays: 7,
    },
    audit: [],
  };
}

export function mergeSettings(existing) {
  const settings = existing ? structuredClone(existing) : {};
  settings.hooks ??= {};
  settings.hooks.SessionStart ??= [];
  const already = settings.hooks.SessionStart.some((group) =>
    (group.hooks ?? []).some((hook) => hook.command === HOOK_COMMAND),
  );
  if (!already) {
    settings.hooks.SessionStart.push({
      hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 40 }],
    });
  }
  return settings;
}

function detectRepo(target) {
  try {
    const url = execFileSync('git', ['-C', target, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
    }).trim();
    const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function install({ source, target, repo, force = false, withWorkflow = false }) {
  const log = [];
  const files = withWorkflow ? [...KIT_FILES, WORKFLOW_FILE] : KIT_FILES;
  for (const file of files) {
    const from = join(source, file);
    if (!existsSync(from)) {
      log.push(`skipped ${file} (not in the source)`);
      continue;
    }
    const to = join(target, file);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    log.push(`copied ${file}`);
  }
  const configPath = join(target, 'scripts/steward/steward.config.json');
  try {
    // 'wx' fails if the file exists, so an existing config is never overwritten (and there is no
    // check-then-write gap).
    writeFileSync(configPath, `${JSON.stringify(starterConfig(repo), null, 2)}\n`, {
      flag: force ? 'w' : 'wx',
    });
    log.push(
      'wrote scripts/steward/steward.config.json (review the checks, hot files and audit gates)',
    );
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    log.push('kept the existing scripts/steward/steward.config.json');
  }
  const settingsPath = join(target, '.claude/settings.json');
  let current = null;
  try {
    current = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(mergeSettings(current), null, 2)}\n`);
  log.push('added the session-start hook to .claude/settings.json');
  return log;
}

function main() {
  const argv = process.argv.slice(2);
  const targetArg = argv.find((arg) => !arg.startsWith('--'));
  if (!targetArg) {
    console.error(
      'usage: node scripts/steward/install.mjs <path-to-target-repo> [--repo owner/name] [--force] [--with-workflow]',
    );
    process.exitCode = 1;
    return;
  }
  const target = resolve(targetArg);
  const at = argv.indexOf('--repo');
  const repo = (at >= 0 ? argv[at + 1] : null) ?? detectRepo(target);
  if (!repo) {
    console.error('Could not tell the GitHub repository; pass --repo owner/name');
    process.exitCode = 1;
    return;
  }
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  for (const line of install({
    source,
    target,
    repo,
    force: argv.includes('--force'),
    withWorkflow: argv.includes('--with-workflow'),
  })) {
    say(line);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
