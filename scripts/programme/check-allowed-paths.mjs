#!/usr/bin/env node
// Programme drift guard.
// Usage: node scripts/programme/check-allowed-paths.mjs <allowlist-file> [--base origin/main] [--no-emdash]
//        [--exclude <folder>]...
// Exits 1 when the branch changes a file that the package allowlist does not cover,
// or (with --no-emdash) when an added line contains a long dash. --exclude leaves a folder out
// of the long-dash count only (owner decision CR13: docs/design/harbor-v2 is an immutable
// external reference). Excluded files must still be inside the allowlist.
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

const USAGE =
  'Usage: check-allowed-paths.mjs <allowlist-file> [--base origin/main] [--no-emdash] [--exclude <folder>]...';

/** Flags that take a value, so their value is never mistaken for the allowlist path. */
export function parseArgs(args) {
  const excludes = [];
  let base = 'origin/main';
  let allowlistPath;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--base' || arg === '--exclude') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` };
      if (arg === '--base') base = value;
      else excludes.push(value.replace(/\/+$/, ''));
      i += 1;
    } else if (!arg.startsWith('--') && allowlistPath === undefined) allowlistPath = arg;
  }
  return { allowlistPath, base, excludes, noEmdash: args.includes('--no-emdash') };
}

export function excludePathspecs(excludes) {
  return excludes.map((folder) => `:(exclude)${folder}`);
}

function longDashCount(base, excludes) {
  const diff = git(['diff', '--text', `${base}...HEAD`, '--', '.', ...excludePathspecs(excludes)]);
  const dash = String.fromCharCode(0x2014);
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++') && line.includes(dash))
    .length;
}

function main(argv) {
  const parsed = parseArgs(argv.slice(2));
  if (parsed.error || !parsed.allowlistPath) {
    console.error(parsed.error ?? USAGE);
    return 2;
  }
  const { allowlistPath, base, excludes, noEmdash } = parsed;
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
    process.stdout.write(`OK: ${changed.length} changed file(s), all inside ${allowlistPath}.\n`);
  }
  if (noEmdash) {
    const count = longDashCount(base, excludes);
    const scope = excludes.length > 0 ? ` (excluding ${excludes.join(', ')})` : '';
    if (count > 0) {
      failed = true;
      console.error(
        `${count} added line(s)${scope} contain a long dash. Replace each with a hyphen.`,
      );
    } else process.stdout.write(`OK: no long dashes in added lines${scope}.\n`);
  }
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv));
