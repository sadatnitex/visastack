#!/usr/bin/env node
/**
 * Second stage: adds route and role attribution (import graph), de-duplicated semantic groups,
 * priority tiers and rendered confirmation to the raw census, then writes the CSV files.
 *
 * Inputs : apps/web/.preview/l10n/work/census.json (census.mjs), apps/web/.preview/l10n/work/rendered-results.json (rendered-check.mjs)
 * Outputs: VISASTACK_UI_SOURCE_CENSUS.csv, apps/web/.preview/l10n/work/stats.json
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WORK = path.join(ROOT, 'apps/web/.preview/l10n/work');
const LOC = path.join(ROOT, 'docs/localization');
fs.mkdirSync(path.join(LOC, 'data'), { recursive: true });
const census = JSON.parse(fs.readFileSync(path.join(WORK, 'census.json'), 'utf8'));
const rendered = fs.existsSync(path.join(WORK, 'rendered-results.json'))
  ? JSON.parse(fs.readFileSync(path.join(WORK, 'rendered-results.json'), 'utf8'))
  : null;
const manifest = fs.existsSync(path.join(ROOT, 'apps/web/.preview/l10n/manifest.json'))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/web/.preview/l10n/manifest.json'), 'utf8'))
  : [];
const hash = (s, n = 8) => createHash('sha1').update(s).digest('hex').slice(0, n);

// ------------------------------------------------------------------ import graph
const scanned = new Set(Object.keys(census.fileStats));
const fileSet = new Set(scanned);
const imports = new Map(); // file -> { rel: [files], pkgSyms: [[pkg, name]] }
const exportsOf = new Map(); // name -> Set(files)  (package files only)
const EXT = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
function resolveRel(from, spec) {
  const base = spec.startsWith('@/')
    ? path.posix.join('apps/web/src', spec.slice(2))
    : path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  for (const e of EXT) if (fileSet.has(base + e)) return base + e;
  return null;
}
for (const f of scanned) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const sf = ts.createSourceFile(
    f,
    code,
    ts.ScriptTarget.Latest,
    true,
    f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const rel = [];
  const pkgSyms = [];
  const isPkg = f.startsWith('packages/');
  const add = (spec, names, typeOnly) => {
    if (!spec) return;
    if (spec.startsWith('.') || spec.startsWith('@/')) {
      const r = resolveRel(f, spec);
      if (r) rel.push(r);
    } else if (spec.startsWith('@visastack/')) {
      if (typeOnly) return;
      const [, pkg, ...sub] = spec.split('/');
      if (sub.length) {
        const r = resolveRel(`packages/${pkg}/src/x.ts`, `./${sub.join('/')}`);
        if (r) rel.push(r);
      }
      for (const n of names) pkgSyms.push([pkg, n]);
    }
  };
  sf.forEachChild((n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const typeOnly = !!c?.isTypeOnly;
      const names = [];
      if (c?.namedBindings && ts.isNamedImports(c.namedBindings))
        for (const e of c.namedBindings.elements)
          if (!e.isTypeOnly) names.push((e.propertyName ?? e.name).text);
      add(n.moduleSpecifier.text, names, typeOnly);
    } else if (
      ts.isExportDeclaration(n) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier)
    ) {
      add(n.moduleSpecifier.text, [], false);
    }
    if (isPkg) {
      const named = (nm) => {
        if (!exportsOf.has(nm)) exportsOf.set(nm, new Set());
        exportsOf.get(nm).add(f);
      };
      const hasExport =
        ts.canHaveModifiers(n) &&
        ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (hasExport) {
        if (ts.isVariableStatement(n))
          for (const d of n.declarationList.declarations)
            if (ts.isIdentifier(d.name)) named(d.name.text);
        if (
          (ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isEnumDeclaration(n)) &&
          n.name
        )
          named(n.name.text);
      }
    }
  });
  // dynamic import('...')
  (function dyn(n) {
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0])
    )
      add(n.arguments[0].text, [], false);
    ts.forEachChild(n, dyn);
  })(sf);
  imports.set(f, { rel, pkgSyms });
}
function closure(entries) {
  const seen = new Map(); // file -> depth in package hops
  const queue = [...entries.map((e) => [e, 0])];
  while (queue.length) {
    const [f, hops] = queue.shift();
    if (seen.has(f) && seen.get(f) <= hops) continue;
    seen.set(f, hops);
    const im = imports.get(f);
    if (!im) continue;
    const inPkg = f.startsWith('packages/');
    for (const r of im.rel) {
      if (inPkg && hops >= 2) continue;
      queue.push([r, inPkg ? hops + 1 : hops]);
    }
    for (const [, name] of im.pkgSyms) {
      if (hops >= 2) continue;
      for (const def of exportsOf.get(name) ?? []) queue.push([def, hops + 1]);
    }
  }
  return seen;
}

// ------------------------------------------------------------------ routes
const stripGroups = (p) =>
  p
    .split('/')
    .filter((s) => s && !/^\(.*\)$/.test(s))
    .join('/');
const routeFiles = [...scanned].filter(
  (f) =>
    /^apps\/web\/src\/app\/.*\/(page\.tsx|route\.ts)$/.test(f) ||
    /^apps\/web\/src\/app\/(page\.tsx|route\.ts)$/.test(f),
);
const SPECIAL = [...scanned].filter(
  (f) =>
    /^apps\/web\/src\/(middleware|instrumentation)\.ts$/.test(f) ||
    /^apps\/web\/src\/app\/(manifest|sitemap|robots)\.ts$/.test(f),
);
function chainFor(routeFile) {
  const dir = path.posix.dirname(routeFile).replace(/^apps\/web\/src\/app\/?/, '');
  const parts = dir ? dir.split('/') : [];
  const entries = [routeFile];
  for (let i = 0; i <= parts.length; i++) {
    const d = ['apps/web/src/app', ...parts.slice(0, i)].join('/');
    for (const n of [
      'layout.tsx',
      'template.tsx',
      'error.tsx',
      'global-error.tsx',
      'not-found.tsx',
      'loading.tsx',
    ])
      if (fileSet.has(`${d}/${n}`)) entries.push(`${d}/${n}`);
  }
  return entries;
}
function roleOfRoute(route) {
  if (/^\/api\/(jobs|health|csp|staging|webhooks|channels|blob|branding|calendar-feed)/.test(route))
    return ['system_output'];
  if (route.startsWith('/api/')) return ['traveller', 'agency', 'guest'];
  if (route.startsWith('/app/admin') || route.startsWith('/app/staff-code'))
    return ['platform_staff'];
  if (route.startsWith('/app/agency')) return ['agency'];
  if (
    /^\/app\/(client-invitations|contributor-requests|invitations|sharing-invitations|trip-invitations)/.test(
      route,
    )
  )
    return ['invitee'];
  if (route.startsWith('/collect')) return ['guest'];
  if (/^\/(oauth|mcp|\.well-known)/.test(route)) return ['connected_app'];
  if (route.startsWith('/app')) return ['traveller', 'family_guardian', 'contributor'];
  return ['visitor'];
}
const fileRoutes = new Map(); // file -> Set(route)
const routeList = [];
for (const rf of routeFiles) {
  const route = `/${stripGroups(path.posix.dirname(rf).replace(/^apps\/web\/src\/app\/?/, ''))}`;
  routeList.push({
    route,
    file: rf,
    roles: roleOfRoute(route),
    kind: rf.endsWith('route.ts') ? 'handler' : 'page',
  });
  const cl = closure(chainFor(rf));
  for (const f of cl.keys()) {
    if (!fileRoutes.has(f)) fileRoutes.set(f, new Set());
    fileRoutes.get(f).add(route);
  }
}
for (const sp of SPECIAL) {
  fileRoutes.set(sp, new Set(['(app-wide)']));
}
const roleByRoute = new Map(routeList.map((r) => [r.route, r.roles]));

// ------------------------------------------------------------------ rendered join
const renderedByRoute = new Map(); // route(no leading slash, groups kept? stripped) -> Set(slug)
for (const m of manifest) {
  if (!String(m.outcome).startsWith('ok')) continue;
  const r = `/${stripGroups(m.route)}`;
  if (!renderedByRoute.has(r)) renderedByRoute.set(r, new Set());
  renderedByRoute.get(r).add(m.slug);
}
const slugRoute = new Map(manifest.map((m) => [m.slug, `/${stripGroups(m.route)}`]));
const renderedIds = new Map(); // source id -> Set(route)
if (rendered)
  for (const r of rendered.results)
    if (r.source_ids && ['exact', 'exact_case_changed', 'template'].includes(r.class))
      for (const id of r.source_ids.split(' ')) {
        if (!renderedIds.has(id)) renderedIds.set(id, new Set());
        renderedIds.get(id).add(slugRoute.get(r.slug) ?? '');
      }
// A string is confirmed for a row when the same text was drawn on a screen that reaches the row's file.
const textRendered = new Map(); // normalised english -> Set(route)
if (rendered)
  for (const r of rendered.results)
    if (['exact', 'exact_case_changed', 'template'].includes(r.class)) {
      const k = r.text.toLowerCase();
      if (!textRendered.has(k)) textRendered.set(k, new Set());
      textRendered.get(k).add(slugRoute.get(r.slug) ?? '');
    }

// ------------------------------------------------------------------ enrich rows
const normPh = (s) => s.replace(/\{\w+\}/g, '{}');
const keyedMaps = new Map(); // key text -> rows (for dynamic resolution)
const mapNames = new Set();
for (const r of census.rows) {
  if (
    r.kind === 'label_map_value' ||
    r.kind === 'named_const_text' ||
    r.kind === 'list_item_text' ||
    r.kind.startsWith('catalogue_')
  ) {
    const root = String(r.prop_or_attr).split('.')[0];
    if (root) mapNames.add(root);
    if (r.key) {
      if (!keyedMaps.has(r.key)) keyedMaps.set(r.key, []);
      keyedMaps.get(r.key).push(r);
    }
  }
}
const _GUARD_PRIORITY_DOMAINS = new Set([
  'consent',
  'auth_account',
  'sharing_grants',
  'documents_vault',
  'privacy_lifecycle',
  'agency_collection',
  'case_readiness',
  'profile_record',
]);
const PERSON_ROLES = new Set([
  'visitor',
  'traveller',
  'guest',
  'invitee',
  'agency',
  'family_guardian',
  'contributor',
]);
const textGroups = new Map(); // tg -> { english, domains:Set, ids:[] }
const semGroups = new Map();
const outRows = [];
for (const r of census.rows) {
  const routes = fileRoutes.get(r.file) ?? new Set();
  const own = r.route_own ? `/${stripGroups(r.route_own)}` : '';
  const routeArr = [...routes].sort();
  const roles = new Set();
  for (const rt of routeArr) for (const ro of roleByRoute.get(rt) ?? ['app_wide']) roles.add(ro);
  if (/^packages\/i18n/.test(r.file)) roles.add('all_when_locale_enabled');
  let attribution = 'UNATTRIBUTED_NO_ROUTE_REACHES_FILE';
  let screenPrimary = '';
  if (routeArr.length) {
    attribution = routeArr.length === 1 ? 'SINGLE_ROUTE' : 'SHARED_BY_IMPORT_GRAPH';
    screenPrimary =
      own && routes.has(own) && /(page|route|error|not-found|loading)\.(tsx|ts)$/.test(r.file)
        ? own
        : routeArr.length === 1
          ? routeArr[0]
          : `SHARED(${routeArr.length})`;
  }
  const personFacing = [...roles].some(
    (x) => PERSON_ROLES.has(x) || x === 'all_when_locale_enabled',
  );
  const tg = `TG-${hash(normPh(r.english))}`;
  const sg = `SG-${hash(`${normPh(r.english).toLowerCase()}|${r.domain}|${r.guard_tags ? 'g' : ''}`)}`;
  const isFragment = r.kind === 'jsx_text' && r.composed_in;
  if (!textGroups.has(tg))
    textGroups.set(tg, { english: normPh(r.english), domains: new Set(), n: 0 });
  const g = textGroups.get(tg);
  g.domains.add(r.domain);
  g.n++;
  if (!semGroups.has(sg))
    semGroups.set(sg, {
      english: normPh(r.english),
      domain: r.domain,
      n: 0,
      guard: r.guard_tags,
      roles: new Set(),
      priority: 'P3_REVIEW_FIRST',
      evidence: new Set(),
      textGroup: tg,
      kinds: new Set(),
      first: r.id,
      ids: [],
    });
  const sgg = semGroups.get(sg);
  sgg.n++;
  for (const ro of roles) sgg.roles.add(ro);
  sgg.evidence.add(r.evidence);
  sgg.kinds.add(r.kind);
  if (sgg.ids.length < 3) sgg.ids.push(r.id);
  // rendered confirmation: same text drawn on a screen that reaches this file
  const rr = textRendered.get(r.english.toLowerCase());
  let renderedState = 'NOT_RENDERED';
  if (rr) {
    const hit = [...rr].some((x) => routes.has(x) || x === own);
    renderedState = hit ? 'CONFIRMED_RENDERED' : 'RENDERED_ELSEWHERE_ONLY';
  }
  if (r.evidence.startsWith('EXCLUDED')) renderedState = 'EXCLUDED';
  let priority;
  // Catalogue rows and emails/PDFs reach people through stored data and jobs the import graph cannot follow.
  const reachesPeopleOutOfBand = r.surface === 'core_catalogue' || r.output_kind !== '';
  const staffOnly =
    !reachesPeopleOutOfBand &&
    roles.size > 0 &&
    [...roles].every((x) => ['platform_staff', 'system_output', 'connected_app'].includes(x));
  const critical =
    /G[1-8]_/.test(r.guard_tags) || r.domain === 'consent' || r.domain === 'auth_account';
  if (r.audience !== 'person' || r.evidence.startsWith('EXCLUDED'))
    priority = 'NOT_FOR_TRANSLATION';
  else if (r.evidence === 'CANDIDATE_ONLY' && renderedState !== 'CONFIRMED_RENDERED')
    priority = 'P3_REVIEW_FIRST';
  else if (staffOnly) priority = 'P2_STAFF_OR_SYSTEM';
  else if (
    r.surface === 'core_catalogue' &&
    /starter-checklists|country-packs|purpose-packs/.test(r.file)
  )
    priority = 'P2_RULE_CONTENT_QUALIFIED_REVIEW';
  else if (critical && (personFacing || reachesPeopleOutOfBand)) priority = 'P0_SEMANTIC_CRITICAL';
  else if (personFacing || /^packages\/(core|services|adapters)/.test(r.file))
    priority = 'P1_CORE_UI';
  else priority = 'P2_STAFF_OR_SYSTEM';
  const reviewClass =
    /\/(privacy|terms)\//.test(r.file) || r.domain === 'consent'
      ? 'LEGAL_POLICY_TEXT'
      : /starter-checklists|country-packs|purpose-packs|\/trust\/|source-monitor|official/.test(
            r.file,
          )
        ? 'OFFICIAL_RULE_CONTENT'
        : /billing|payment|invoice|receipt|refund|plan/.test(r.file)
          ? 'PAYMENT_BILLING'
          : 'STANDARD_UI';
  const coverageFlag = r.evidence.startsWith('EXCLUDED')
    ? r.evidence
    : r.evidence === 'CANDIDATE_ONLY'
      ? 'CANDIDATE_NEEDS_REVIEW'
      : renderedState === 'CONFIRMED_RENDERED'
        ? 'CONFIRMED_RENDERED'
        : routeArr.length === 0
          ? 'SOURCE_ONLY_NO_ROUTE'
          : 'SOURCE_ONLY_NOT_RENDERED';
  outRows.push({
    ...r,
    routes_count: routeArr.length,
    routes_sample: routeArr.slice(0, 4).join(' '),
    roles: [...roles].sort().join('|'),
    attribution,
    screen_primary: screenPrimary,
    text_group: tg,
    semantic_group: sg,
    translation_unit: isFragment ? `N_FRAGMENT_OF_${r.composed_in}` : 'Y',
    rendered: renderedState,
    priority,
    review_class: reviewClass,
    coverage_flag: coverageFlag,
  });
}
// recompute group priority properly (best across members)
const best = new Map();
for (const r of outRows) {
  const order = [
    'P0_SEMANTIC_CRITICAL',
    'P1_CORE_UI',
    'P2_RULE_CONTENT_QUALIFIED_REVIEW',
    'P2_STAFF_OR_SYSTEM',
    'P3_REVIEW_FIRST',
    'NOT_FOR_TRANSLATION',
  ];
  const cur = best.get(r.semantic_group);
  if (cur === undefined || order.indexOf(r.priority) < order.indexOf(cur))
    best.set(r.semantic_group, r.priority);
}
for (const [sg, g] of semGroups) g.priority = best.get(sg);
for (const r of outRows) {
  const tgd = textGroups.get(r.text_group);
  r.dup_count = tgd.n;
  r.homograph = tgd.domains.size > 1 ? `MULTI_DOMAIN(${[...tgd.domains].sort().join('/')})` : '';
}

// ------------------------------------------------------------------ dynamic rows
const dynRows = census.dynamic.map((d) => {
  const routes = fileRoutes.get(d.file) ?? new Set();
  const roles = new Set();
  for (const rt of routes) for (const ro of roleByRoute.get(rt) ?? ['app_wide']) roles.add(ro);
  const root = d.expr.match(/^[A-Za-z_$][\w$]*/)?.[0] ?? '';
  const quoted = [...d.expr.matchAll(/['"]([\w.:-]{3,60})['"]/g)].map((m) => m[1]);
  let resolved = '';
  if (quoted.some((q) => keyedMaps.has(q)))
    resolved = `RESOLVED_VIA_KEY:${quoted.find((q) => keyedMaps.has(q))}`;
  else if (mapNames.has(root)) resolved = `RESOLVED_VIA_MAP:${root}`;
  else if (
    /^(children|props|className|key|id|index|i|n|count|total|value|name|date|time|year)$/.test(
      d.name,
    )
  )
    resolved = 'LIKELY_DATA_OR_NUMBER';
  return {
    id: d.id,
    file: d.file,
    line_start: d.line_start,
    line_end: d.line_end,
    surface: d.surface,
    component: d.component,
    jsx_path: d.jsx_path,
    kind: d.kind,
    prop_or_attr: d.prop_or_attr,
    evidence: 'DYNAMIC',
    confidence: '',
    english: `{${d.expr}}`,
    placeholders: '',
    icu_flags: '',
    branch: d.branch,
    key: '',
    route_own: d.route_own,
    output_kind: '',
    state_hint: '',
    guard_tags: '',
    composed_in: '',
    audience: d.audience,
    domain: d.domain,
    routes_count: routes.size,
    routes_sample: [...routes].sort().slice(0, 4).join(' '),
    roles: [...roles].sort().join('|'),
    attribution: routes.size ? 'SHARED_BY_IMPORT_GRAPH' : 'UNATTRIBUTED_NO_ROUTE_REACHES_FILE',
    screen_primary: '',
    text_group: '',
    semantic_group: '',
    translation_unit: 'N_DYNAMIC',
    rendered: 'NOT_APPLICABLE',
    priority: 'NEEDS_RENDERED_CHECK',
    review_class: '',
    coverage_flag: resolved ? `DYNAMIC_${resolved}` : 'DYNAMIC_REQUIRES_RENDERED_CHECK',
    dup_count: '',
    homograph: '',
  };
});

// ------------------------------------------------------------------ CSV
const COLS = [
  'id',
  'file',
  'line_start',
  'line_end',
  'surface',
  'component',
  'jsx_path',
  'kind',
  'prop_or_attr',
  'evidence',
  'confidence',
  'english',
  'placeholders',
  'icu_flags',
  'branch',
  'key',
  'output_kind',
  'state_hint',
  'guard_tags',
  'composed_in',
  'audience',
  'domain',
  'routes_count',
  'routes_sample',
  'roles',
  'attribution',
  'screen_primary',
  'text_group',
  'semantic_group',
  'dup_count',
  'homograph',
  'translation_unit',
  'rendered',
  'priority',
  'review_class',
  'coverage_flag',
];
const q = (v) => {
  const s = String(v ?? '').replace(/\u2014/g, '[U+2014]');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const sorted = [...outRows, ...dynRows].sort(
  (a, b) => a.file.localeCompare(b.file) || a.line_start - b.line_start || a.id.localeCompare(b.id),
);
const csv = `${[COLS.join(','), ...sorted.map((r) => COLS.map((c) => q(r[c])).join(','))].join('\n')}\n`;
fs.writeFileSync(path.join(LOC, 'VISASTACK_UI_SOURCE_CENSUS.csv'), csv);

// semantic groups
const sgOut = [...semGroups.entries()].map(([id, g]) => ({
  id,
  english: g.english,
  domain: g.domain,
  occurrences: g.n,
  guard_tags: g.guard,
  roles: [...g.roles].sort().join('|'),
  priority: g.priority,
  evidence: [...g.evidence].sort().join('|'),
  kinds: [...g.kinds].sort().join('|'),
  text_group: g.textGroup,
  example_ids: g.ids.join(' '),
}));
fs.writeFileSync(path.join(WORK, 'semantic-groups.json'), JSON.stringify(sgOut));

// stats for the coverage report
const count = (arr, f) =>
  arr.reduce((m, x) => {
    const k = f(x);
    m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {});
const stats = {
  mainSha: census.mainSha,
  filesScanned: census.filesScanned,
  testFilesSkipped: census.testFilesSkipped,
  notScanned: census.notScanned,
  excludedInternal: census.excluded,
  rows: outRows.length,
  dynamicRows: dynRows.length,
  byEvidence: count(outRows, (r) => r.evidence),
  bySurface: count(outRows, (r) => r.surface),
  byPriority: count(outRows, (r) => r.priority),
  byCoverage: count(outRows, (r) => r.coverage_flag),
  dynamicByFlag: count(dynRows, (r) => r.coverage_flag.split(':')[0]),
  byAttribution: count(outRows, (r) => r.attribution),
  textGroups: textGroups.size,
  semanticGroups: semGroups.size,
  semanticGroupsByPriority: count(sgOut, (g) => g.priority),
  homographGroups: [...textGroups.values()].filter((g) => g.domains.size > 1).length,
  fragments: outRows.filter((r) => r.translation_unit !== 'Y').length,
  composedUnits: outRows.filter((r) => r.kind === 'jsx_composed').length,
  icuFlagCounts: count(
    outRows.flatMap((r) => (r.icu_flags ? r.icu_flags.split('|') : [])).map((x) => ({ x })),
    (o) => o.x,
  ),
  guardTagCounts: count(
    outRows.flatMap((r) => (r.guard_tags ? r.guard_tags.split('|') : [])).map((x) => ({ x })),
    (o) => o.x,
  ),
  outputKinds: count(
    outRows.filter((r) => r.output_kind),
    (r) => r.output_kind,
  ),
  routes: routeList.length,
  routesByRole: count(
    routeList.flatMap((r) => r.roles.map((x) => ({ x }))),
    (o) => o.x,
  ),
  stateHints: count(
    outRows.flatMap((r) => (r.state_hint ? r.state_hint.split('|') : [])).map((x) => ({ x })),
    (o) => o.x,
  ),
};
fs.writeFileSync(path.join(WORK, 'rows.json'), JSON.stringify(outRows));
fs.writeFileSync(path.join(WORK, 'stats.json'), JSON.stringify(stats, null, 1));
fs.writeFileSync(
  path.join(WORK, 'routes.json'),
  JSON.stringify(
    routeList.map((r) => ({
      ...r,
      renderedScenarios: [...(renderedByRoute.get(r.route) ?? [])],
      ownRows: outRows.filter(
        (x) => x.route_own && `/${stripGroups(x.route_own)}` === r.route && x.file === r.file,
      ).length,
    })),
    null,
    1,
  ),
);
process.stdout.write(
  `${JSON.stringify({ csvBytes: csv.length, rows: stats.rows, dynamicRows: stats.dynamicRows, textGroups: stats.textGroups, semanticGroups: stats.semanticGroups, byPriority: stats.byPriority, byCoverage: stats.byCoverage, semanticGroupsByPriority: stats.semanticGroupsByPriority }, null, 1)}\n`,
);
