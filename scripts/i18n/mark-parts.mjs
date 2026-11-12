#!/usr/bin/env node
/**
 * Marking pass for the language of parts (WCAG 3.1.2). A surface that already reads its text from
 * a catalogue still renders it with a plain `t('key')`, so a message that falls back to another
 * language than the page sits unmarked. This pass moves the places that can carry a language
 * onto the language-aware translator (`t.node`, `t.lang`; see docs/localization/I18N_RUNTIME.md):
 *
 *   - JSX text children `{t('k', params)}` become `{t.node('k', params)}` (also through a
 *     conditional, `&&`, `||` and `??`). Under the page language nothing changes in the markup.
 *   - A host element attribute `aria-label | title | placeholder | alt = {t('k')}` gets
 *     `{...t.lang('k')}` on the same element, unless the element also holds text from another
 *     key (the `lang` would then be wrong for that text): that one is skipped and reported as
 *     attribute_lang_mixed.
 *   - An `<option>`, `<textarea>` or `<title>` cannot hold a span: when the message is its only
 *     child the element gets `{...t.lang('k')}` instead.
 *   - A component prop named with --node-props Component.prop (the author has widened its type to
 *     ReactNode, and it only renders the prop as a child) becomes `prop={t.node('k')}`.
 *   - Template literals, props of components, and values that flow somewhere else stay a plain
 *     `t()`; they are counted per reason so nothing is hidden.
 *
 *   node scripts/i18n/mark-parts.mjs --surface auth,home [--exclude <path-prefix>...] [--dry-run]
 *   node scripts/i18n/mark-parts.mjs --all --dry-run
 *   node scripts/i18n/mark-parts.mjs --files apps/web/src/app/page.tsx
 *
 * A surface is the catalogue in apps/web/src/i18n/<surface>.ts; its files are the ones that import
 * it. A second run changes nothing. Files are formatted with the repository's Biome afterwards.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { biomeFormat } from './codemod.mjs';

const say = (line) => process.stdout.write(`${line}\n`);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const FACTORIES = new Set(['getServerT', 'useT', 'getT']);
/** Attributes whose text a person or a screen reader gets. */
export const LANG_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt']);
/** Host elements that only accept a string child, so a span cannot go inside them. */
const STRING_ONLY = new Set(['option', 'textarea', 'title', 'script', 'style']);

const isTestFile = (rel) => /\.(test|spec)\.tsx?$/.test(rel) || /\/e2e\//.test(rel);

function unwrap(expr) {
  let e = expr;
  while (
    e &&
    (ts.isAwaitExpression(e) ||
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isNonNullExpression(e))
  )
    e = e.expression;
  return e;
}

function isTranslatorInit(init) {
  const e = unwrap(init);
  return (
    !!e &&
    ts.isCallExpression(e) &&
    ts.isIdentifier(e.expression) &&
    FACTORIES.has(e.expression.text)
  );
}

const FUNCTION_LIKE = (n) =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n);

/** Is the identifier at `use` bound to a language-aware translator? Walks the real scopes. */
function isTranslatorUse(use) {
  const name = use.text;
  for (let cur = use.parent; cur; cur = cur.parent) {
    if (FUNCTION_LIKE(cur)) {
      for (const p of cur.parameters) {
        if (ts.isIdentifier(p.name) && p.name.text === name)
          return !!p.type && /\bPartsTranslator\b/.test(p.type.getText());
        if (!ts.isIdentifier(p.name) && p.name.getText().split(/\W+/).includes(name)) return false;
      }
    }
    const statements =
      ts.isBlock(cur) || ts.isSourceFile(cur) || ts.isModuleBlock(cur) ? cur.statements : null;
    if (statements) {
      for (const st of statements) {
        if (ts.isFunctionDeclaration(st) && st.name?.text === name) return false;
        if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.name.text === name)
              return !!d.initializer && isTranslatorInit(d.initializer);
            if (!ts.isIdentifier(d.name) && d.name.getText().split(/\W+/).includes(name))
              return false;
          }
        }
      }
    }
  }
  return false;
}

/** `t('key', ...)` with a translator `t`: returns the call, else null. */
function translatorCall(node) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return null;
  return isTranslatorUse(node.expression) ? node : null;
}

function literalKey(call) {
  const a = call.arguments[0];
  return a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null;
}

/** The calls of `expr` that end up as a rendered child: through ?:, &&, ||, ??, parens. */
function nodePositionCalls(expr, out = []) {
  const e = ts.isParenthesizedExpression(expr) ? expr.expression : expr;
  if (ts.isCallExpression(e)) out.push(e);
  else if (ts.isConditionalExpression(e)) {
    nodePositionCalls(e.whenTrue, out);
    nodePositionCalls(e.whenFalse, out);
  } else if (ts.isBinaryExpression(e)) {
    const k = e.operatorToken.kind;
    if (k === ts.SyntaxKind.AmpersandAmpersandToken) nodePositionCalls(e.right, out);
    else if (k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken) {
      nodePositionCalls(e.left, out);
      nodePositionCalls(e.right, out);
    }
  }
  return out;
}

const tagName = (opening) => opening.tagName.getText();
/** Components that hand their props straight to a host element (`lang` included). */
const HOST_LIKE = new Set(['Link']);
const isHostTag = (opening) => /^[a-z]/.test(tagName(opening)) || HOST_LIKE.has(tagName(opening));

function hasLangMarker(opening) {
  return opening.attributes.properties.some((p) => {
    if (ts.isJsxAttribute(p)) return p.name.getText() === 'lang';
    const e = p.expression;
    return (
      ts.isCallExpression(e) &&
      ts.isPropertyAccessExpression(e.expression) &&
      e.expression.name.text === 'lang'
    );
  });
}

/** Components whose output holds no words of their own. */
const WORDLESS = new Set(['Icon', 'BrandMark']);

/**
 * Could anything inside `element` be in a language other than the one `key` is in? Only content
 * that is provably the same message, or provably wordless (an icon, an empty tag), is safe; a
 * variable, a `.map()`, another message, written words or an unknown component all count as
 * "maybe", because one `lang` on the element would then be wrong for them.
 */
function otherTextInside(element, key) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isJsxText(n)) {
      if (/\p{L}/u.test(n.text)) found = true;
      return;
    }
    if (
      ts.isJsxExpression(n) &&
      n.expression &&
      (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))
    ) {
      // A child expression: only `t('same.key')` or `t.node('same.key')` is known.
      const e = unwrap(n.expression);
      const callee = e && ts.isCallExpression(e) ? e.expression : null;
      const base = callee && ts.isPropertyAccessExpression(callee) ? callee.expression : callee;
      const same = base && ts.isIdentifier(base) && isTranslatorUse(base) && literalKey(e) === key;
      if (!same) found = true;
      return;
    }
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const base = ts.isPropertyAccessExpression(callee) ? callee.expression : callee;
      if (ts.isIdentifier(base) && isTranslatorUse(base) && literalKey(n) !== key) {
        found = true;
        return;
      }
    }
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const name = n.tagName.getText();
      if (/^[A-Z]/.test(name) && !WORDLESS.has(name) && !HOST_LIKE.has(name)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  for (const child of element.children) visit(child);
  return found;
}

/**
 * Analyse one file. Returns the edits to make and a tally. `code` is the file text; nothing is
 * written here.
 */
export function markSource(code, fileName = 'file.tsx', { nodeProps = new Set() } = {}) {
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const edits = [];
  const tally = {
    nodes: 0,
    propNodes: 0,
    langAttrs: 0,
    optionLangs: 0,
    skipped: {},
    plain: {},
    details: [],
  };
  const addTo = (bucket, reason, at) => {
    tally[bucket][reason] = (tally[bucket][reason] ?? 0) + 1;
    if (at) {
      const { line } = sf.getLineAndCharacterOfPosition(at.getStart());
      tally.details.push(
        `${fileName}:${line + 1} ${bucket === 'plain' ? 'left plain' : 'skipped'}: ${reason}`,
      );
    }
  };
  const handled = new Set();
  const spreadFor = (call, key) => ` {...${call.expression.getText()}.lang(${key.raw})}`;

  // Attributes grouped per host element.
  const attrGroups = new Map();
  const visit = (n) => {
    if (
      ts.isJsxExpression(n) &&
      n.expression &&
      (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))
    ) {
      const parentElement = ts.isJsxElement(n.parent) ? n.parent : null;
      const calls = nodePositionCalls(n.expression);
      const openEl = parentElement?.openingElement;
      if (openEl && isHostTag(openEl) && STRING_ONLY.has(tagName(openEl))) {
        const translated = calls.map(translatorCall).filter(Boolean);
        for (const tc of translated) handled.add(tc);
        if (translated.length) {
          const meaningful = parentElement.children.filter(
            (c) => !(ts.isJsxText(c) && c.text.trim() === ''),
          );
          const tc = translated[0];
          if (
            translated.length === 1 &&
            meaningful.length === 1 &&
            n.expression === tc &&
            literalKey(tc) !== null
          ) {
            if (!hasLangMarker(openEl)) {
              edits.push({
                pos: openEl.tagName.getEnd(),
                end: openEl.tagName.getEnd(),
                text: spreadFor(tc, { raw: tc.arguments[0].getText() }),
              });
              tally.optionLangs++;
            }
          } else addTo('skipped', 'string_only_parent', tc);
        }
        calls.length = 0;
      }
      for (const call of calls) {
        const tc = translatorCall(call);
        if (!tc) continue;
        handled.add(tc);
        edits.push({ pos: tc.expression.getEnd(), end: tc.expression.getEnd(), text: '.node' });
        tally.nodes++;
      }
    }
    if (
      ts.isJsxAttribute(n) &&
      n.initializer &&
      ts.isJsxExpression(n.initializer) &&
      n.initializer.expression
    ) {
      const inner = unwrap(n.initializer.expression);
      const tc = inner && translatorCall(inner);
      const opening = n.parent.parent;
      if (tc && !isHostTag(opening) && nodeProps.has(`${tagName(opening)}.${n.name.getText()}`)) {
        // A component prop the author has widened to ReactNode: it renders the prop as a child.
        handled.add(tc);
        edits.push({ pos: tc.expression.getEnd(), end: tc.expression.getEnd(), text: '.node' });
        tally.propNodes++;
      } else if (tc && LANG_ATTRS.has(n.name.getText())) {
        handled.add(tc);
        if (!isHostTag(opening)) addTo('plain', 'component_prop', tc);
        else {
          const list = attrGroups.get(opening) ?? [];
          list.push({ attr: n, call: tc });
          attrGroups.set(opening, list);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  for (const [opening, list] of attrGroups) {
    const element = ts.isJsxOpeningElement(opening) ? opening.parent : null;
    const keys = new Set(list.map((x) => literalKey(x.call)));
    const key = [...keys][0];
    if (hasLangMarker(opening)) continue;
    // A lang on a form control also names the language of what the person types into it.
    if (['input', 'textarea', 'select'].includes(tagName(opening))) {
      for (const x of list) addTo('skipped', 'form_control', x.attr);
      continue;
    }
    const reason =
      keys.has(null) || keys.size > 1 || (element && otherTextInside(element, key))
        ? 'attribute_lang_mixed'
        : null;
    if (reason) {
      for (const x of list) addTo('skipped', reason, x.attr);
      continue;
    }
    const first = list[0];
    edits.push({
      pos: first.attr.getEnd(),
      end: first.attr.getEnd(),
      text: spreadFor(first.call, { raw: first.call.arguments[0].getText() }),
    });
    tally.langAttrs++;
  }

  // Everything else that is still a plain `t()`.
  const rest = (n) => {
    const tc = translatorCall(n);
    if (tc && !handled.has(tc)) {
      let reason = 'value_flow';
      if (ts.isTemplateSpan(tc.parent)) reason = 'template_literal';
      else if (ts.isJsxExpression(tc.parent) && ts.isJsxAttribute(tc.parent.parent))
        reason = isHostTag(tc.parent.parent.parent.parent) ? 'attribute_other' : 'component_prop';
      addTo('plain', reason, tc);
    }
    ts.forEachChild(n, rest);
  };
  rest(sf);

  edits.sort((a, b) => b.pos - a.pos);
  let out = code;
  for (const e of edits) out = out.slice(0, e.pos) + e.text + out.slice(e.end);
  return { code: out, changed: out !== code, tally };
}

const sum = (a, b) => {
  const r = { ...a };
  for (const [k, v] of Object.entries(b)) r[k] = (r[k] ?? 0) + v;
  return r;
};

function walkTsx(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTsx(p, out);
    else if (ent.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

export function catalogSurfaces(root) {
  const dir = path.join(root, 'apps/web/src/i18n');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .map((f) => f.slice(0, -3));
}

/** Files under apps/web/src that import the given surface's catalogue (tests never). */
export function filesOfSurface(root, surface) {
  const re = new RegExp(`from\\s+['"][^'"]*\\bi18n/${surface}['"]`);
  return walkTsx(path.join(root, 'apps/web/src'))
    .map((abs) => path.relative(root, abs).split(path.sep).join('/'))
    .filter((rel) => !isTestFile(rel) && re.test(fs.readFileSync(path.join(root, rel), 'utf8')))
    .sort();
}

/**
 * groups: [{ surface, files }]. Returns one report per surface. Excluded path prefixes are never
 * read or written.
 */
export function runMarkParts({
  root = REPO_ROOT,
  groups,
  dryRun = false,
  exclude = [],
  format = true,
  nodeProps = new Set(),
}) {
  const seen = new Set();
  const reports = [];
  const changedAll = [];
  for (const g of groups) {
    const report = {
      surface: g.surface,
      files: 0,
      changedFiles: [],
      nodes: 0,
      propNodes: 0,
      langAttrs: 0,
      optionLangs: 0,
      skipped: {},
      plain: {},
      excluded: [],
      details: [],
    };
    for (const rel of g.files) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      if (exclude.some((p) => rel.startsWith(p))) {
        report.excluded.push(rel);
        continue;
      }
      const abs = path.join(root, rel);
      const code = fs.readFileSync(abs, 'utf8');
      const r = markSource(code, rel, { nodeProps });
      report.files++;
      report.nodes += r.tally.nodes;
      report.propNodes += r.tally.propNodes;
      report.langAttrs += r.tally.langAttrs;
      report.optionLangs += r.tally.optionLangs;
      report.skipped = sum(report.skipped, r.tally.skipped);
      report.plain = sum(report.plain, r.tally.plain);
      report.details.push(...r.tally.details);
      if (r.changed) {
        report.changedFiles.push(rel);
        if (!dryRun) {
          fs.writeFileSync(abs, r.code);
          changedAll.push(rel);
        }
      }
    }
    reports.push(report);
  }
  if (!dryRun && format && changedAll.length) biomeFormat(root, changedAll);
  return reports;
}

function parseArgs(argv) {
  const a = {
    files: [],
    exclude: [],
    dryRun: false,
    all: false,
    surfaces: [],
    format: true,
    nodeProps: new Set(),
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--dry-run') a.dryRun = true;
    else if (x === '--all') a.all = true;
    else if (x === '--no-format') a.format = false;
    else if (x === '--verbose') a.verbose = true;
    else if (x === '--surface') a.surfaces.push(...argv[++i].split(','));
    else if (x === '--node-props') for (const p of argv[++i].split(',')) a.nodeProps.add(p);
    else if (x === '--exclude' || x === '--files') {
      const into = x === '--exclude' ? a.exclude : a.files;
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) into.push(argv[++i]);
    } else throw new Error(`unknown option ${x}`);
  }
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  let groups;
  if (a.files.length) groups = [{ surface: 'files', files: a.files }];
  else {
    const surfaces = a.all ? catalogSurfaces(REPO_ROOT) : a.surfaces;
    if (!surfaces.length)
      throw new Error(
        'usage: mark-parts.mjs (--surface <a,b> | --all | --files <file>...) [--exclude <prefix>...] [--dry-run]',
      );
    groups = surfaces.map((surface) => ({ surface, files: filesOfSurface(REPO_ROOT, surface) }));
  }
  const reports = runMarkParts({
    groups,
    dryRun: a.dryRun,
    exclude: a.exclude,
    format: a.format,
    nodeProps: a.nodeProps,
  });
  say('surface\tfiles\tchanged\tnode\tprop_node\tlang_attr\toption_lang\tskipped\tleft_plain');
  const count = (o) => Object.values(o).reduce((s, v) => s + v, 0);
  for (const r of reports)
    say(
      [
        r.surface,
        r.files,
        r.changedFiles.length,
        r.nodes,
        r.propNodes,
        r.langAttrs,
        r.optionLangs,
        count(r.skipped),
        count(r.plain),
      ].join('\t'),
    );
  const skipped = reports.reduce((s, r) => sum(s, r.skipped), {});
  const plain = reports.reduce((s, r) => sum(s, r.plain), {});
  say(`skipped: ${JSON.stringify(skipped)}`);
  say(`left plain: ${JSON.stringify(plain)}`);
  if (a.verbose) for (const d of reports.flatMap((r) => r.details)) say(d);
  const ex = reports.flatMap((r) => r.excluded);
  if (ex.length) say(`excluded (not touched): ${ex.length}\n${ex.join('\n')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
