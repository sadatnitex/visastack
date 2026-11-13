#!/usr/bin/env node
/**
 * i18n extraction codemod: moves user-visible English in apps/web/src into a typed per-surface
 * catalogue, leaving the English output unchanged.
 *
 *   node scripts/i18n/codemod.mjs --surface documents --files apps/web/src/app/(app)/documents/page.tsx ...
 *   node scripts/i18n/codemod.mjs --surface documents --dry-run --files ...
 *   node scripts/i18n/codemod.mjs --all --dry-run          # counts per default surface (reports only)
 *   node scripts/i18n/codemod.mjs --refill-bn [--groups-from <classification.json>] [--dry-run]  # refill Bengali in every catalogue
 *
 * Writes the edited files, apps/web/src/i18n/<surface>.ts, apps/web/src/i18n/<surface>.sources.json
 * and a report of everything not converted and why (default
 * apps/web/.preview/l10n/codemod/<surface>.report.json, git-ignored). A dry run writes only the
 * reports. A second run changes nothing. A real run needs the i18n runtime (defineCatalog, useT,
 * getServerT, primeLocale) to be present and stops before touching anything if it is not.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { buildBoundary, directiveOf } from './boundary.mjs';
import {
  catalogIdent,
  catalogRel,
  readCatalog,
  readIfExists,
  readSources,
  renderCatalog,
  renderSources,
  sourcesRel,
} from './catalog.mjs';
import { KeyAllocator } from './keys.mjs';
import { refillBengali } from './refill.mjs';
import { Register } from './register.mjs';
import { SPECIAL_ROUTE_RE, TEST_RE, audienceOfFile, camel } from './rules.mjs';
import { analyzeFile, planFile, rewriteFile } from './transform.mjs';

const say = (line) => process.stdout.write(`${line}\n`);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Default surface for the --all dry count: first route segment, or the components/lib folder. */
export function defaultSurface(rel) {
  const inner = rel.replace(/^apps\/web\/src\//, '');
  const segs = inner.split('/').filter((s) => !/^\(.*\)$/.test(s));
  if (segs[0] === 'app') {
    const route = segs[1] === 'app' ? segs.slice(2) : segs.slice(1);
    const name = segs[1] === 'app' ? 'app-' : '';
    return route.length > 1 ? `${name}${route[0].replace(/^\[|\]$/g, '')}` : `${name}home`;
  }
  if (segs[0] === 'components' && segs.length > 2) return `components-${segs[1]}`;
  return segs[0];
}

function listTsx(root) {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.tsx'))
        out.push(path.relative(root, p).split(path.sep).join('/'));
    }
  };
  walk(path.join(root, 'apps/web/src'));
  return out.sort();
}

function fileLevelReason(root, rel, boundary) {
  if (!/^apps\/web\/src\//.test(rel)) return { reason: 'outside_apps_web_src', analyse: false };
  if (TEST_RE.test(rel)) return { reason: 'excluded_test_file', analyse: false };
  const audience = audienceOfFile(rel);
  if (audience) return { reason: `excluded_${audience}`, analyse: false };
  if (/^apps\/web\/src\/i18n\//.test(rel)) return { reason: 'i18n_catalogue_file', analyse: false };
  if (!rel.endsWith('.tsx')) return { reason: 'not_tsx', analyse: false };
  if (SPECIAL_ROUTE_RE.test(rel)) return { reason: 'special_route_file', analyse: true };
  const code = fs.readFileSync(path.join(root, rel), 'utf8');
  if (directiveOf(code) === 'server_action') return { reason: 'use_server_file', analyse: true };
  const mode = boundary.get(rel) ?? 'unknown';
  if (mode === 'shared') return { reason: 'shared_client_server_module', analyse: true };
  if (mode === 'unknown') return { reason: 'boundary_unknown', analyse: true };
  return { reason: null, analyse: true, mode };
}

function createProgram(root, absFiles) {
  const cfgPath = path.join(root, 'apps/web/tsconfig.json');
  let options = { jsx: ts.JsxEmit.Preserve, strict: true, target: ts.ScriptTarget.ES2022 };
  if (fs.existsSync(cfgPath)) {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      cfgPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => {},
      },
    );
    if (parsed) options = { ...parsed.options, noEmit: true };
  }
  return ts.createProgram({ rootNames: absFiles, options });
}

/** The files a converted surface imports. A real run refuses to start without them. */
export const RUNTIME_FILES = [
  ['packages/i18n/src/index.ts', [/\bdefineCatalog\b/]],
  ['apps/web/src/components/i18n-provider.tsx', [/export function useT\b/]],
  [
    'apps/web/src/lib/i18n-server.ts',
    [/export function getServerT\b/, /export async function primeLocale\b/],
  ],
];
export function assertRuntime(root) {
  const missing = RUNTIME_FILES.filter(([rel, needs]) => {
    const code = readIfExists(path.join(root, rel));
    return code === null || !needs.every((re) => re.test(code));
  }).map(([rel]) => rel);
  if (missing.length)
    throw new Error(
      `the i18n runtime is not on this branch (${missing.join(', ')}): only --dry-run works until it is`,
    );
}

/**
 * Format files in place with the repository's Biome (format, import order, safe fixes). File mode
 * on purpose: Biome 1.9.4 drops combining marks (Bengali vowel signs) when it reads from stdin.
 */
export function biomeFormat(root, rels) {
  if (!rels.length) return;
  const bin = path.join(REPO_ROOT, 'node_modules/.bin/biome');
  const r = spawnSync(bin, ['check', '--write', '--no-errors-on-unmatched', ...rels], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  if (r.status !== 0)
    throw new Error(`biome could not format: ${r.stdout}${r.stderr}`.slice(0, 4000));
}

/**
 * Analyse and (unless dryRun) rewrite. groups: [{ surface, files }].
 * Returns one report per surface.
 */
export function runCodemod({
  root = REPO_ROOT,
  groups,
  dryRun = false,
  format = true,
  formatter = biomeFormat,
  register,
  reportDir,
  writeReport = true,
}) {
  for (const g of groups)
    if (!/^[a-z][a-z0-9-]*$/.test(g.surface))
      throw new Error(`surface must be lower case letters, digits and hyphens: ${g.surface}`);
  if (!dryRun) assertRuntime(root);
  const reg = register ?? Register.load(root);
  const boundary = buildBoundary(root);
  const prepared = groups.map((g) => {
    const files = [
      ...new Set(
        g.files.map((f) =>
          path.posix.normalize(
            (path.isAbsolute(f) ? path.relative(root, f) : f).split(path.sep).join('/'),
          ),
        ),
      ),
    ].sort();
    for (const f of files)
      if (!fs.existsSync(path.join(root, f))) throw new Error(`no such file: ${f}`);
    return {
      ...g,
      files,
      levels: new Map(files.map((f) => [f, fileLevelReason(root, f, boundary)])),
    };
  });
  const absAll = prepared.flatMap((g) =>
    g.files.filter((f) => g.levels.get(f).analyse).map((f) => path.join(root, f)),
  );
  const program = createProgram(root, absAll);
  const checker = program.getTypeChecker();

  const reports = [];
  for (const g of prepared) {
    const ident = catalogIdent(g.surface);
    const catAbs = path.join(root, catalogRel(g.surface));
    const srcAbs = path.join(root, sourcesRel(g.surface));
    const catalog = readCatalog(catAbs);
    const sources = readSources(srcAbs);
    const report = {
      surface: g.surface,
      catalog: catalogRel(g.surface),
      files: g.files,
      summary: {},
      converted: [],
      notConverted: [],
      fileSkips: [],
      bengaliMissing: [],
    };
    const accepted = [];
    const analysed = [];
    const perFile = [];
    for (const rel of g.files) {
      const level = g.levels.get(rel);
      if (!level.analyse) {
        report.fileSkips.push({ file: rel, reason: level.reason });
        continue;
      }
      const sf = program.getSourceFile(path.join(root, rel));
      const { units, skips } = analyzeFile({ rel, sf, checker });
      analysed.push(...units);
      report.notConverted.push(...skips);
      const asSkip = (u, reason) => ({
        file: u.file,
        line: u.line,
        kind: u.kind,
        text: u.censusText,
        reason,
      });
      if (level.reason) {
        if (units.length) report.fileSkips.push({ file: rel, reason: level.reason });
        report.notConverted.push(...units.map((u) => asSkip(u, level.reason)));
        continue;
      }
      const plan = planFile({ rel, sf, mode: level.mode, units, catalogIdent: ident });
      if (plan.fileSkip) {
        report.fileSkips.push({ file: rel, reason: plan.fileSkip });
        report.notConverted.push(...units.map((u) => asSkip(u, plan.fileSkip)));
        continue;
      }
      for (const s of plan.unitSkips ?? []) report.notConverted.push(asSkip(s.unit, s.reason));
      const ok = [...plan.hosts.values()].flatMap((h) => h.units).sort((a, b) => a.start - b.start);
      accepted.push(...ok);
      if (ok.length) perFile.push({ rel, sf, mode: level.mode, plan });
    }

    // keys, in file then position order
    // Register rows first: English with two meanings (a homograph the census keeps apart) gets
    // one key per meaning, so each keeps its own Bengali.
    const claimed = reg.claimedBy(analysed);
    const lookups = new Map(
      accepted.map((u) => [
        u,
        reg.lookup(
          { file: u.file, line: u.line, censusText: u.censusText, english: u.english },
          claimed,
        ),
      ]),
    );
    const meanings = new Map();
    for (const [u, r] of lookups)
      if (r.group && !r.group.includes('|'))
        meanings.set(u.english, new Set([...(meanings.get(u.english) ?? []), r.group]));
    const homograph = (english) => (meanings.get(english)?.size ?? 0) > 1;
    const alloc = new KeyAllocator(camel(g.surface), catalog.en, (k, english) =>
      homograph(english) && typeof sources[k] === 'string' ? sources[k] : '',
    );
    const keyOfUnit = new Map();
    for (const u of accepted) {
      const r = lookups.get(u);
      const variant = homograph(u.english) ? (r.group ?? '') : '';
      keyOfUnit.set(u, alloc.keyFor(u.file, u.english, u.slugSource, variant));
    }
    const en = { ...catalog.en };
    const bn = { ...catalog.bn };
    const src = { ...sources };
    const seen = new Set();
    for (const u of accepted) {
      const key = keyOfUnit.get(u);
      en[key] = u.english;
      report.converted.push({
        key,
        file: u.file,
        line: u.line,
        kind: u.kind,
        english: u.english,
        ...(homograph(u.english) ? { homograph: true } : {}),
      });
      if (seen.has(key)) continue;
      seen.add(key);
      const r = lookups.get(u);
      if (!(key in src) || src[key] === null) src[key] = r.group;
      if (bn[key] === undefined) {
        if (r.bn) bn[key] = r.bn;
        else report.bengaliMissing.push({ key, english: u.english, reason: r.reason });
      }
    }

    const writes = [];
    if (!dryRun && accepted.length) {
      for (const f of perFile)
        writes.push([
          f.rel,
          rewriteFile({
            rel: f.rel,
            sf: f.sf,
            mode: f.mode,
            plan: f.plan,
            catalogIdent: ident,
            surface: g.surface,
            keyOf: (u) => keyOfUnit.get(u),
          }),
        ]);
      writes.push(
        [catalogRel(g.surface), renderCatalog(g.surface, en, bn)],
        [sourcesRel(g.surface), renderSources(src)],
      );
    }
    // Write, format in place, then compare with what was there: unchanged files keep their bytes.
    const before = new Map();
    for (const [rel, text] of writes) {
      const abs = path.join(root, rel);
      before.set(rel, readIfExists(abs));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text);
    }
    if (format) {
      try {
        formatter(
          root,
          writes.map(([rel]) => rel),
        );
      } catch (error) {
        // Put every file back as it was, so a failed run leaves nothing half-converted.
        for (const [rel, text] of before) {
          if (text === null) fs.rmSync(path.join(root, rel), { force: true });
          else fs.writeFileSync(path.join(root, rel), text);
        }
        throw error;
      }
    }
    const changed = [];
    for (const [rel] of writes) {
      const abs = path.join(root, rel);
      const now = fs.readFileSync(abs, 'utf8');
      if (now === before.get(rel)) continue;
      changed.push(rel);
    }

    const byReason = {};
    for (const s of report.notConverted) byReason[s.reason] = (byReason[s.reason] ?? 0) + 1;
    report.summary = {
      filesAnalysed: g.files.filter((f) => g.levels.get(f).analyse).length,
      filesConverted: perFile.length,
      stringsConverted: report.converted.length,
      keys: seen.size,
      notConverted: report.notConverted.length,
      notConvertedByReason: Object.fromEntries(
        Object.entries(byReason).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
      ),
      bengaliFilled: seen.size - report.bengaliMissing.length,
      bengaliMissing: report.bengaliMissing.length,
      dryRun,
      changedFiles: changed,
    };
    if (writeReport) {
      const dir = reportDir ?? path.join(root, 'apps/web/.preview/l10n/codemod');
      fs.mkdirSync(dir, { recursive: true });
      const { changedFiles: _c, ...stable } = report.summary;
      fs.writeFileSync(
        path.join(dir, `${g.surface}.report.json`),
        `${JSON.stringify({ ...report, summary: stable }, null, 2)}\n`,
      );
    }
    reports.push(report);
  }
  return reports;
}

/** The groups a release classification file (docs/localization/data/RELEASE_CLASSIFICATION_*.json) released. */
function releasedGroupsOf(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new Set(parsed.groups.filter((g) => g.state === 'RELEASED').map((g) => g.group));
}

function parseArgs(argv) {
  const a = { files: [], dryRun: false, format: true, all: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--surface') a.surface = argv[++i];
    else if (x === '--dry-run') a.dryRun = true;
    else if (x === '--no-format') a.format = false;
    else if (x === '--all') a.all = true;
    else if (x === '--refill-bn') a.refill = true;
    else if (x === '--groups-from') a.groupsFrom = path.resolve(argv[++i]);
    else if (x === '--report-dir') a.reportDir = path.resolve(argv[++i]);
    else if (x === '--files') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) a.files.push(argv[++i]);
    } else if (!x.startsWith('--')) a.files.push(x);
    else throw new Error(`unknown option ${x}`);
  }
  if (a.groupsFrom && !a.refill) throw new Error('--groups-from only works with --refill-bn');
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.refill) {
    const done = refillBengali({
      root: REPO_ROOT,
      dryRun: a.dryRun,
      ...(a.groupsFrom ? { groups: releasedGroupsOf(a.groupsFrom) } : {}),
      format: a.format ? biomeFormat : undefined,
    });
    say('surface\tbn_filled');
    for (const r of done) if (r.filled.length) say(`${r.surface}\t${r.filled.length}`);
    say(`TOTAL\t${done.reduce((n, r) => n + r.filled.length, 0)}`);
    return;
  }
  let groups;
  if (a.all) {
    if (!a.dryRun) throw new Error('--all is a count only: add --dry-run');
    const by = new Map();
    for (const f of listTsx(REPO_ROOT)) {
      const s = defaultSurface(f);
      by.set(s, [...(by.get(s) ?? []), f]);
    }
    groups = [...by].map(([surface, files]) => ({ surface, files }));
  } else {
    if (!a.surface || !a.files.length)
      throw new Error('usage: codemod.mjs --surface <name> [--dry-run] --files <file>...');
    groups = [{ surface: a.surface, files: a.files }];
  }
  const reports = runCodemod({
    groups,
    dryRun: a.dryRun,
    format: a.format,
    reportDir: a.reportDir,
  });
  const rows = reports.map((r) => [
    r.surface,
    r.summary.filesAnalysed,
    r.summary.stringsConverted,
    r.summary.notConverted,
    r.summary.bengaliFilled,
  ]);
  const total = rows.reduce(
    (s, r) => [s[0], s[1] + r[1], s[2] + r[2], s[3] + r[3], s[4] + r[4]],
    ['TOTAL', 0, 0, 0, 0],
  );
  say('surface\tfiles\tconverted\tnot_converted\tbn_filled');
  for (const r of [...rows, total]) say(r.join('\t'));
  if (reports.length > 1) {
    const reasons = {};
    for (const r of reports)
      for (const [k, v] of Object.entries(r.summary.notConvertedByReason))
        reasons[k] = (reasons[k] ?? 0) + v;
    say('\nnot converted, by reason:');
    for (const [k, v] of Object.entries(reasons).sort((x, y) => y[1] - x[1])) say(`${v}\t${k}`);
  } else {
    const s = reports[0].summary;
    say(JSON.stringify(s.notConvertedByReason));
    if (s.changedFiles.length) say(`changed:\n${s.changedFiles.join('\n')}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
