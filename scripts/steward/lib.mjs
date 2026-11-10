// Shared helpers for the Steward kit. No dependencies, so the kit can be copied to any repository.
// Everything talks to GitHub through the `gh` CLI (REST only) so it works from a shallow clone,
// from a cloud session and from a scheduled workflow alike.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const CLAIM_MARKER = 'Steward-claim:';
export const CONFIG_PATH = 'scripts/steward/steward.config.json';

export class GhError extends Error {
  constructor(message, { status = 0, denied = false } = {}) {
    super(message);
    this.name = 'GhError';
    this.status = status;
    this.denied = denied;
  }
}

export function loadConfig(cwd = process.cwd(), file = CONFIG_PATH) {
  const path = join(cwd, file);
  if (!existsSync(path)) throw new Error(`Missing ${file}. Run the installer or copy the config.`);
  const config = JSON.parse(readFileSync(path, 'utf8'));
  for (const key of ['repo', 'defaultBranch', 'requiredChecks']) {
    if (!config[key]) throw new Error(`${file}: "${key}" is required`);
  }
  return {
    protectedBranches: [],
    parkedPrefixes: [],
    laneBranchPrefixes: [],
    hotFiles: [],
    audit: [],
    migrations: null,
    ...config,
    retention: {
      graceHours: 48,
      laneStaleDays: 7,
      parkedReviewDays: 45,
      artifactDays: 3,
      cacheDays: 7,
      ...(config.retention ?? {}),
    },
  };
}

/** Thin async wrapper over `gh api`. Tests pass a fake with the same four methods. */
export function createGh(exec = execFileAsync) {
  async function run(args) {
    try {
      const { stdout } = await exec('gh', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
      return stdout;
    } catch (error) {
      const text = `${error.stderr ?? ''}${error.message ?? ''}`.trim();
      const status = Number((text.match(/HTTP (\d{3})/) ?? [])[1] ?? 0);
      throw new GhError(text.split('\n')[0] ?? 'gh failed', {
        status,
        denied: status === 403 || /not permitted/i.test(text),
      });
    }
  }
  return {
    async get(path) {
      const out = await run(['api', path]);
      return out.trim() ? JSON.parse(out) : null;
    },
    /** Follows page numbers until a short page. `key` names the array inside an object reply. */
    async list(path, key, { maxPages = 30 } = {}) {
      const items = [];
      for (let page = 1; page <= maxPages; page += 1) {
        const joiner = path.includes('?') ? '&' : '?';
        const data = await this.get(`${path}${joiner}per_page=100&page=${page}`);
        const chunk = (key ? data?.[key] : data) ?? [];
        items.push(...chunk);
        if (chunk.length < 100) break;
      }
      return items;
    },
    async del(path) {
      await run(['api', '-X', 'DELETE', path]);
    },
  };
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping the input order. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Plain stdout line; the kit prints reports, not debug output. */
export const say = (text) => process.stdout.write(`${text}\n`);

export const encodeRef = (name) => name.split('/').map(encodeURIComponent).join('/');

export function daysBetween(fromIso, now = new Date()) {
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - from) / 86_400_000;
}

// ---------- path patterns ----------

export function globToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (c === '?') {
      source += '[^/]';
    } else {
      source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

export const matchesGlob = (glob, path) => globToRegExp(glob).test(path);
const hasWildcard = (pattern) => /[*?]/.test(pattern);
const staticPrefix = (pattern) => pattern.split(/[*?]/)[0] ?? '';

/** Two path patterns overlap if one matches the other or they share a directory under a wildcard. */
export function patternsOverlap(a, b) {
  if (a === b || matchesGlob(a, b) || matchesGlob(b, a)) return true;
  if (!hasWildcard(a) && !hasWildcard(b)) return false;
  const pa = staticPrefix(a);
  const pb = staticPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

// ---------- claims (a plain block in a draft PR description) ----------

export function formatClaim({ paths = [], migration = null, area = '' } = {}) {
  const lines = [CLAIM_MARKER, `- paths: ${paths.join(', ')}`];
  if (migration) lines.push(`- migration: ${migration}`);
  if (area) lines.push(`- area: ${area}`);
  return lines.join('\n');
}

export function parseClaim(body = '') {
  const lines = (body ?? '').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === CLAIM_MARKER);
  if (start < 0) return null;
  const claim = { paths: [], migration: null, area: '' };
  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^-\s*(paths|migration|area):\s*(.*)$/);
    if (!match) break;
    const [, key, value] = match;
    if (key === 'paths') {
      claim.paths = value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    } else if (key === 'migration') {
      claim.migration = value.trim() || null;
    } else {
      claim.area = value.trim();
    }
  }
  return claim;
}

// ---------- migrations ----------

export function migrationNumber(path, config) {
  if (!config.migrations) return null;
  const dir = config.migrations.dir.replace(/\/?$/, '/');
  if (!path.startsWith(dir)) return null;
  const match = path.slice(dir.length).match(new RegExp(config.migrations.pattern));
  return match ? Number(match[1]) : null;
}

export const padMigration = (n) => String(n).padStart(4, '0');

// ---------- topic matching (has this already been done?) ----------

const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'that',
  'this',
  'page',
  'make',
  'add',
  'fix',
  'new',
  'use',
  'when',
  'have',
  'than',
]);

export function topicWords(text) {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 4 && !STOP.has(word)),
    ),
  ];
}

export function topicMatches(topic, subjects, { min = 2, top = 3 } = {}) {
  const words = topicWords(topic);
  if (words.length === 0) return [];
  const needed = Math.min(min, words.length);
  return subjects
    .map((item) => {
      const hay = item.subject.toLowerCase();
      return { ...item, score: words.filter((word) => hay.includes(word)).length };
    })
    .filter((item) => item.score >= needed)
    .sort((x, y) => y.score - x.score)
    .slice(0, top);
}

// ---------- repository snapshot shared by preflight and hygiene ----------

export function localMigrationFiles(cwd, config) {
  if (!config.migrations) return [];
  const dir = join(cwd, config.migrations.dir);
  return existsSync(dir) ? readdirSync(dir).map((name) => `${config.migrations.dir}/${name}`) : [];
}

export function isProtectedBranch(name, config, extra = []) {
  return (
    name === config.defaultBranch ||
    config.protectedBranches.some((glob) => matchesGlob(glob, name)) ||
    extra.includes(name)
  );
}

/** One compare per branch: how far ahead, which files, when last touched. */
export async function describeBranch(gh, config, { name, sha }) {
  const base = encodeRef(config.defaultBranch);
  const url = `repos/${config.repo}/compare/${base}...${encodeRef(name)}?per_page=100`;
  const cmp = await gh.get(url);
  let files = cmp.files ?? [];
  // The compare reply carries at most 300 files; past that the file list cannot be trusted.
  if (files.length >= 100) {
    for (let page = 2; page <= 3; page += 1) {
      const more = await gh.get(`${url}&page=${page}`);
      files = files.concat(more.files ?? []);
      if ((more.files ?? []).length < 100) break;
    }
  }
  const commits = cmp.commits ?? [];
  const ahead = cmp.ahead_by ?? 0;
  const truncated = files.length >= 300 || ahead > commits.length;
  // Commits come oldest first and are paged, so a long branch needs its tip fetched for the date.
  let last = commits[commits.length - 1];
  if (!last || ahead > commits.length) last = await gh.get(`repos/${config.repo}/commits/${sha}`);
  // A claim can ride on a plain pushed branch (an empty commit whose message carries the block),
  // which costs nothing because CI only runs for pull requests and main. The newest block wins.
  const claim = commits.reduce((found, c) => parseClaim(c.commit?.message ?? '') ?? found, null);
  return {
    name,
    sha,
    claim,
    status: cmp.status,
    ahead,
    behind: cmp.behind_by ?? 0,
    files: files.map((f) => ({
      path: f.filename,
      status: f.status,
      sha: f.sha,
      previous: f.previous_filename ?? null,
    })),
    truncated,
    lastCommitDate: last?.commit?.committer?.date ?? last?.commit?.author?.date ?? null,
    lastSubject: (last?.commit?.message ?? '').split('\n')[0],
  };
}

export async function listBranches(gh, config) {
  const branches = await gh.list(`repos/${config.repo}/branches`);
  return branches
    .filter((b) => b.name !== config.defaultBranch)
    .map((b) => ({ name: b.name, sha: b.commit.sha }));
}

export async function mainBlobMap(gh, config) {
  const tree = await gh.get(
    `repos/${config.repo}/git/trees/${encodeRef(config.defaultBranch)}?recursive=1`,
  );
  const map = new Map();
  for (const entry of tree?.tree ?? []) if (entry.type === 'blob') map.set(entry.path, entry.sha);
  return { map, truncated: Boolean(tree?.truncated) };
}
