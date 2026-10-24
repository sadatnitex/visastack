#!/usr/bin/env node
// Programme drift guard.
// Usage: node scripts/programme/check-allowed-paths.mjs <allowlist-file> [--base origin/main] [--no-emdash]
// Exits 1 when the branch changes a file that the package allowlist does not cover,
// or (with --no-emdash) when an added line contains a long dash.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Square brackets are literal, because Next.js route folders look like [id]. */
export function globToRegExp(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

export function parseAllowlist(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

export function findViolations(changedPaths, patterns) {
  const matchers = patterns.map(globToRegExp);
  return changedPaths.filter((path) => !matchers.some((matcher) => matcher.test(path)));
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function changedFiles(base) {
  const committed = git(['diff', '--name-only', `${base}...HEAD`]);
  const working = git(['diff', '--name-only', 'HEAD']);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  return [
    ...new Set(
      `${committed}\n${working}\n${untracked}`
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function longDashCount(base) {
  const diff = git(['diff', '--text', `${base}...HEAD`]);
  const dash = String.fromCharCode(0x2014);
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++') && line.includes(dash)).length;
}

function main(argv) {
  const args = argv.slice(2);
  const allowlistPath = args.find((arg) => !arg.startsWith('--'));
  const baseIndex = args.indexOf('--base');
  const base = baseIndex >= 0 ? args[baseIndex + 1] : 'origin/main';
  if (!allowlistPath) {
    console.error('Usage: check-allowed-paths.mjs <allowlist-file> [--base origin/main] [--no-emdash]');
    return 2;
  }
  const patterns = parseAllowlist(readFileSync(allowlistPath, 'utf8'));
  if (patterns.length === 0) {
    console.error(`Allowlist ${allowlistPath} is empty. Refusing to pass.`);
    return 2;
  }
  const changed = changedFiles(base);
  const violations = findViolations(changed, patterns);
  let failed = false;
  if (violations.length > 0) {
    failed = true;
    console.error(`${violations.length} changed file(s) are outside ${allowlistPath}:`);
    for (const path of violations) console.error(`  ${path}`);
    console.error('Stop. Ask the owner to approve an allowlist change before editing these files.');
  } else {
    console.log(`OK: ${changed.length} changed file(s), all inside ${allowlistPath}.`);
  }
  if (args.includes('--no-emdash')) {
    const count = longDashCount(base);
    if (count > 0) {
      failed = true;
      console.error(`${count} added line(s) contain a long dash. Replace each with a hyphen.`);
    } else console.log('OK: no long dashes in added lines.');
  }
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
