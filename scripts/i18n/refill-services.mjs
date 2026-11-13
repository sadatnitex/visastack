/**
 * Refills Bengali in the services message catalogues (packages/services/src/i18n/<area>.ts) from
 * the translation register, as `codemod.mjs --refill-bn` does for the web catalogues.
 *
 * A services catalogue has no sources map, so each key's register row is found from its English:
 *   1. every register row with exactly the key's English;
 *   2. narrowed, when those rows disagree, to the census rows of the files that use the key.
 * The key's own rows are its census rows when it has any (same file, same English), else the rows
 * of step 1. Bengali is taken only when no own row is held, unreleased, failing or differently
 * placeheld, and exactly one Bengali wording passes the register checks (released queue, not held,
 * automated checks PASS, same placeholders, ICU plural shape kept). Entities are decoded.
 *
 * Bengali already in a catalogue is never changed, keys in ENGLISH_ONLY are never filled, and a
 * second run changes nothing. English values are never touched.
 *
 *   node scripts/i18n/refill-services.mjs [--dry-run] [--report]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { quote, readIfExists } from './catalog.mjs';
import { decodeEntities } from './jsx-text.mjs';
import { CENSUS_REL, Register, parseCsv, registerForm } from './register.mjs';

export const SERVICES_I18N_REL = 'packages/services/src/i18n';
const SERVICES_SRC_REL = 'packages/services/src';

/**
 * Keys that stay English whatever the register says, each with the reason. Remove a key only on
 * the owner's decision.
 */
export const ENGLISH_ONLY = new Map([
  [
    'sharing.inviteUnavailable',
    'One answer for a missing and a forbidden invitation (hidden-record rule): kept as one English answer until a deliberate change translates it (owner, 2026-11-13).',
  ],
]);

/** Catalogue files in the services i18n folder (not the registry, not tests). */
export function listServiceCatalogues(root) {
  return fs
    .readdirSync(path.join(root, SERVICES_I18N_REL))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .filter((f) => f !== 'index.ts' && f !== 'messages.ts')
    .sort();
}

const isText = (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);

/**
 * The `export const <name>En = {...} as const` and `<name>Bn` objects of one catalogue file, with
 * the Bengali object's position so it can be rewritten in place. Throws on anything but literal
 * key/value pairs (a comment inside the Bengali object would be lost by a rewrite, so it throws too).
 */
export function parseServiceCatalogue(code, file = 'catalogue.ts') {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sides = {};
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      const name = ts.isIdentifier(d.name) ? d.name.text : '';
      const side = /En$/.test(name) ? 'en' : /Bn$/.test(name) ? 'bn' : null;
      if (!side || !d.initializer) continue;
      let obj = d.initializer;
      if (ts.isAsExpression(obj)) obj = obj.expression;
      if (!ts.isObjectLiteralExpression(obj)) throw new Error(`${file}: ${name} is not an object`);
      if (sides[side]) throw new Error(`${file}: more than one ${side} object`);
      const values = {};
      for (const p of obj.properties) {
        if (!ts.isPropertyAssignment(p) || !isText(p.initializer))
          throw new Error(`${file}: only literal messages are supported (${p.getText(sf)})`);
        const key = ts.isStringLiteral(p.name) || ts.isIdentifier(p.name) ? p.name.text : null;
        if (key === null) throw new Error(`${file}: unexpected key ${p.name.getText(sf)}`);
        values[key] = p.initializer.text;
      }
      sides[side] = { name, values, start: obj.getStart(sf), end: obj.getEnd() };
    }
  }
  if (!sides.en || !sides.bn) throw new Error(`${file}: needs one ...En and one ...Bn object`);
  // A comment anywhere inside the Bengali object (own line or trailing) would be lost by a rewrite.
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard);
  scanner.setText(code, sides.bn.start, sides.bn.end - sides.bn.start);
  for (let k = scanner.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = scanner.scan())
    if (k === ts.SyntaxKind.SingleLineCommentTrivia || k === ts.SyntaxKind.MultiLineCommentTrivia)
      throw new Error(`${file}: ${sides.bn.name} holds a comment; refill would drop it`);
  return sides;
}

/** The Bengali object in the English key order; Biome formats it afterwards. */
export function renderBengaliObject(enValues, bnValues) {
  const order = [
    ...Object.keys(enValues),
    ...Object.keys(bnValues).filter((k) => !(k in enValues)),
  ];
  const lines = order
    .filter((k) => k in bnValues)
    .map((k) => `  ${quote(k)}: ${quote(bnValues[k])},`);
  return lines.length ? `{\n${lines.join('\n')}\n}` : '{}';
}

/** Every services source file that names each catalogue key (tests and the catalogues left out). */
export function keyCallSites(root, keys) {
  const wanted = new Set(keys);
  const sites = new Map();
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (child !== SERVICES_I18N_REL && e.name !== 'node_modules') walk(child);
      } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
        const code = fs.readFileSync(path.join(root, child), 'utf8');
        for (const m of code.matchAll(/['"`]([\w-]+\.[\w-]+)['"`]/g)) {
          if (!wanted.has(m[1])) continue;
          const set = sites.get(m[1]) ?? new Set();
          set.add(child);
          sites.set(m[1], set);
        }
      }
    }
  };
  walk(SERVICES_SRC_REL);
  return sites;
}

/** Census semantic groups by `file|register form of the English`. */
export function censusIndex(censusCsv) {
  const index = new Map();
  for (const c of censusCsv ? parseCsv(censusCsv) : []) {
    if (!c.semantic_group) continue;
    const id = `${c.file}|${registerForm(c.english)}`;
    const set = index.get(id) ?? new Set();
    set.add(c.semantic_group);
    index.set(id, set);
  }
  return index;
}

const pass = (r) => r.bn !== null;
// An undrafted row in a released queue (no Bengali, so no checks ran) says nothing about the
// wording; any other refusal on the key's own rows (held, unreleased queue, a failing or
// differently placeheld draft) keeps the key English.
// Only an ordinary-screen row may lend its wording: an undrafted payment or legal row keeps its
// key English rather than borrow Bengali written for another context.
const blocking = (row, r) =>
  !pass(r) &&
  !(
    row.review_queue === 'ORDINARY_UI' &&
    !(row.bn_BD_draft ?? '').trim() &&
    (r.reason === 'no_bn_draft' || r.reason.startsWith('checks_not_pass'))
  );

/**
 * Bengali for one key, or the reason it stays English.
 * @returns {{ bn: string|null, reason: string|null, groups: string[] }}
 */
export function resolveServiceKey({ register, census, english, files }) {
  const form = registerForm(english);
  const byEnglish = register.byEnglish.get(form) ?? [];
  const censusGroups = new Set();
  for (const f of files ?? [])
    for (const g of census.get(`${f}|${form}`) ?? []) censusGroups.add(g);
  const own = [...censusGroups].filter((g) => register.byGroup.has(g));
  const ownRows = own.length ? own.map((g) => register.byGroup.get(g)) : byEnglish;
  const groups = ownRows.map((r) => r.semantic_group).sort();
  if (!ownRows.length) {
    // A row whose English differs only in placeholder names: the catalogue's English is never
    // renamed to fit, so the key waits for a draft with the catalogue's names.
    const shape = (s) => registerForm(s).replace(/\{\w+\}/g, '{}');
    const want = shape(english);
    const loose = new Set();
    if (want !== form) {
      for (const [id, set] of census)
        if (
          [...(files ?? [])].some((f) => id.startsWith(`${f}|`)) &&
          shape(id.slice(id.indexOf('|') + 1)) === want
        )
          for (const g of set) loose.add(g);
      if (!loose.size)
        for (const [g, r] of register.byGroup) if (shape(r.english) === want) loose.add(g);
    }
    return loose.size
      ? { bn: null, reason: 'placeholder_names_differ', groups: [...loose].sort() }
      : { bn: null, reason: 'no_register_match', groups };
  }
  const opts = { plural: true };
  const ownResults = ownRows.map((r) => register.resolveRow(r, english, opts));
  const blocked = ownResults.find((r, i) => blocking(ownRows[i], r));
  if (blocked) return { bn: null, reason: blocked.reason, groups };
  let results = own.length
    ? [...ownResults, ...byEnglish.map((r) => register.resolveRow(r, english, opts))]
    : ownResults;
  let wordings = [...new Set(results.filter(pass).map((r) => r.bn))];
  if (wordings.length > 1 && own.length) {
    results = ownResults;
    wordings = [...new Set(results.filter(pass).map((r) => r.bn))];
  }
  if (wordings.length > 1) return { bn: null, reason: 'register_ambiguous', groups };
  if (!wordings.length) return { bn: null, reason: 'no_bn_draft', groups };
  const decoded = decodeEntities(wordings[0]);
  if (decoded.error) return { bn: null, reason: decoded.error, groups };
  // An entity can spell an em dash the register check could not see.
  if (/\u2014/.test(decoded.text)) return { bn: null, reason: 'bn_has_marker_or_em_dash', groups };
  return { bn: decoded.text, reason: null, groups };
}

/**
 * @param {{ root: string, register?: Register, censusCsv?: string, files?: string[], englishOnly?: ReadonlyMap<string, string>, dryRun?: boolean, format?: (root: string, rels: string[]) => void }} o
 * @returns {{ file: string, keys: number, filled: string[], kept: string[], skipped: { key: string, reason: string, groups: string[] }[] }[]}
 */
export function refillServiceBengali({
  root,
  register,
  censusCsv,
  files,
  englishOnly = ENGLISH_ONLY,
  dryRun = false,
  format,
}) {
  const reg = register ?? Register.load(root);
  const census = censusIndex(censusCsv ?? readIfExists(path.join(root, CENSUS_REL)) ?? '');
  const parsed = (files ?? listServiceCatalogues(root)).map((file) => {
    const abs = path.join(root, SERVICES_I18N_REL, file);
    const code = fs.readFileSync(abs, 'utf8');
    return { file, abs, code, sides: parseServiceCatalogue(code, file) };
  });
  const sites = keyCallSites(
    root,
    parsed.flatMap((p) => Object.keys(p.sides.en.values)),
  );
  const out = [];
  const written = [];
  for (const { file, abs, code, sides } of parsed) {
    const en = sides.en.values;
    const bn = { ...sides.bn.values };
    const filled = [];
    const kept = [];
    const skipped = [];
    for (const [key, english] of Object.entries(en)) {
      if (bn[key] !== undefined) {
        kept.push(key);
        continue;
      }
      if (englishOnly.has(key)) {
        skipped.push({ key, reason: 'english_only', groups: [] });
        continue;
      }
      const r = resolveServiceKey({ register: reg, census, english, files: sites.get(key) });
      if (r.bn === null) {
        skipped.push({ key, reason: r.reason ?? 'unknown', groups: r.groups });
        continue;
      }
      bn[key] = r.bn;
      filled.push(key);
    }
    out.push({ file, keys: Object.keys(en).length, filled, kept, skipped });
    if (!filled.length || dryRun) continue;
    const next =
      code.slice(0, sides.bn.start) + renderBengaliObject(en, bn) + code.slice(sides.bn.end);
    fs.writeFileSync(abs, next);
    written.push(`${SERVICES_I18N_REL}/${file}`);
  }
  if (format && written.length) format(root, written);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const { biomeFormat } = await import('./codemod.mjs');
  const done = refillServiceBengali({
    root,
    dryRun: args.has('--dry-run'),
    format: biomeFormat,
  });
  for (const r of done) {
    const reasons = {};
    for (const s of r.skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
    const lines = [
      `${r.file}: ${r.keys} keys, ${r.kept.length} already Bengali, ${r.filled.length} filled, ${r.skipped.length} English ${JSON.stringify(reasons)}`,
    ];
    if (args.has('--report'))
      for (const s of r.skipped) lines.push(`  ${s.key}\t${s.reason}\t${s.groups.join(' ')}`);
    process.stdout.write(`${lines.join('\n')}\n`);
  }
}
