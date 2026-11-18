import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Counters that may only go down while the interface is being improved.
 *
 * 1. Inline style props: every `style={{...}}` is a spacing or text decision made outside the
 *    shared stylesheet. The count must not rise in any file, and a file with none must stay at none.
 * 2. Raw codes shown as page text: a database value such as PASSPORT or OWNER printed straight
 *    into a page instead of a plain label. The count must not rise in any file.
 *
 * 3. Long dashes in text a person can read (page text and string values; comments are not counted).
 * 4. Open-and-close sections built outside the Expandable Section (WAL1, ADR 0030): a raw
 *    `<details>`, or a use of one of the older shared folds (FOLD_TAGS), however it is written:
 *    a plain tag, a dotted name (`<ui.Disclosure>`, counted by its last part), a renamed import
 *    (`import { Disclosure as D }`), or `createElement('details' | Disclosure, ...)`, in .tsx and
 *    .ts files. Every new section uses ExpandableSection (components/ui-lift/expandable-section.tsx),
 *    the one file not counted. Each screen moved onto it lowers its file's count.
 *
 * The recorded starting point lives in scripts/ui-ratchet.baseline.json. Lower it with
 * `node scripts/ui-ratchet.mjs --lower` after a change reduces a count. Raising it needs a
 * deliberate edit to that file that a reviewer will see.
 */

export const RAW_CODE_FIELDS = new Set([
  'docType',
  'role',
  'status',
  'outcome',
  'decision',
  'state',
  'processingStatus',
  'safetyStatus',
  'suggestedType',
  'eventType',
  'kind',
  'result',
]);

/** The one file that may build an open-and-close section directly: the Expandable Section. */
export const DETAILS_HOME = 'apps/web/src/components/ui-lift/expandable-section.tsx';

/** JSX tags that build an open-and-close section outside the Expandable Section. */
export const FOLD_TAGS = new Set([
  'details',
  'Disclosure',
  'AboutDisclosure',
  'CollapsibleGroup',
  'CollapsibleGroups',
  'StickyDetails',
  'LazyDisclosure',
  'RailFold',
  'Fold',
  'ReadinessLegendFold',
]);

/** The last part of a tag or callee name: `ui.Disclosure` is `Disclosure`. */
function lastPart(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isJsxNamespacedName?.(node)) return node.name.text;
  if (node.kind === ts.SyntaxKind.ThisKeyword) return '';
  return node.getText();
}

/** Built from the code point so no tool rewrites it into the character itself. */
const LONG_DASH = String.fromCharCode(0x2014);

export function measure(source, filename = 'component.tsx') {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  // A counted fold imported under another name is still that fold.
  const foldNames = new Set(FOLD_TAGS);
  for (const statement of file.statements) {
    const named = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : undefined;
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if (element.propertyName && FOLD_TAGS.has(element.propertyName.text)) {
          foldNames.add(element.name.text);
        }
      }
    }
  }
  let inlineStyles = 0;
  let rawCodes = 0;
  let emDashes = 0;
  let folds = 0;
  const visit = (node) => {
    if (
      (ts.isJsxText(node) ||
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      node.text.includes(LONG_DASH)
    )
      emDashes += 1;
    if (ts.isJsxAttribute(node) && node.name.getText(file) === 'style') inlineStyles += 1;
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      foldNames.has(lastPart(node.tagName))
    )
      folds += 1;
    if (
      ts.isCallExpression(node) &&
      lastPart(node.expression) === 'createElement' &&
      node.arguments[0] &&
      ((ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === 'details') ||
        (!ts.isStringLiteralLike(node.arguments[0]) &&
          foldNames.has(lastPart(node.arguments[0])) &&
          lastPart(node.arguments[0]) !== 'details'))
    )
      folds += 1;
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      ts.isPropertyAccessExpression(node.expression) &&
      RAW_CODE_FIELDS.has(node.expression.name.text) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    )
      rawCodes += 1;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { inlineStyles, rawCodes, emDashes, folds };
}

export function measureTree(root) {
  const inlineStyles = {};
  const rawCodes = {};
  const emDashes = {};
  const folds = {};
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        /\.tsx?$/.test(entry.name) &&
        !entry.name.endsWith('.d.ts') &&
        !entry.name.includes('.test')
      ) {
        const counts = measure(readFileSync(full, 'utf8'), full);
        const key = relative(root, full).replaceAll('\\', '/');
        // The first three counters read page markup, which only .tsx files hold.
        if (entry.name.endsWith('.tsx')) {
          if (counts.inlineStyles) inlineStyles[key] = counts.inlineStyles;
          if (counts.rawCodes) rawCodes[key] = counts.rawCodes;
          if (counts.emDashes) emDashes[key] = counts.emDashes;
        }
        if (counts.folds && key !== DETAILS_HOME) folds[key] = counts.folds;
      }
    }
  };
  walk(join(root, 'apps/web/src'));
  return { inlineStyles, rawCodes, emDashes, folds };
}

const FIX = {
  inlineStyles: 'Use a shared class.',
  rawCodes: 'Use a plain label.',
  emDashes: 'Use a full stop or a hyphen.',
  folds: 'Use ExpandableSection from components/ui-lift/expandable-section.tsx.',
};

const COUNTERS = ['inlineStyles', 'rawCodes', 'emDashes', 'folds'];

const total = (map) => Object.values(map).reduce((sum, value) => sum + value, 0);

export function compare(current, baseline) {
  const errors = [];
  for (const [label, key] of [
    ['inline style props', 'inlineStyles'],
    ['raw codes shown as page text', 'rawCodes'],
    ['long dashes in visible text', 'emDashes'],
    ['open-and-close sections outside ExpandableSection', 'folds'],
  ]) {
    for (const [file, count] of Object.entries(current[key] ?? {})) {
      const allowed = baseline[key]?.[file] ?? 0;
      if (count > allowed)
        errors.push(`${file}: ${count} ${label}, up from ${allowed}. ${FIX[key]}`);
    }
  }
  return errors;
}

const baselinePath = join(dirname(fileURLToPath(import.meta.url)), 'ui-ratchet.baseline.json');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const current = measureTree(root);
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const errors = compare(current, baseline);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    const now = Object.fromEntries(COUNTERS.map((k) => [k, total(current[k] ?? {})]));
    const was = Object.fromEntries(COUNTERS.map((k) => [k, total(baseline[k] ?? {})]));
    const lowered = COUNTERS.some((k) => now[k] < was[k]);
    const line = COUNTERS.map((k) => `${k} ${was[k]} to ${now[k]}`).join(', ');
    if (process.argv.includes('--lower') && lowered) {
      writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
      process.stdout.write(`UI ratchet lowered: ${line}\n`);
    } else {
      const hint = lowered ? ' (lower it: node scripts/ui-ratchet.mjs --lower)' : '';
      const counts = COUNTERS.map((k) => `${k} ${now[k]}`).join(', ');
      process.stdout.write(`UI ratchet passed: ${counts}${hint}\n`);
    }
  }
}
