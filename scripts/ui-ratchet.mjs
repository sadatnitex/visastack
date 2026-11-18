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
 * 4. Raw details elements (WAL1, ADR 0030): every open-and-close section is built with the shared
 *    Expandable Section (components/ui-lift/expandable-section.tsx), which is the one file allowed
 *    to hold a raw `<details>`. Each screen moved onto it lowers its file's count.
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

/** The one file that may hold a raw details element: the shared Expandable Section. */
export const DETAILS_HOME = 'apps/web/src/components/ui-lift/expandable-section.tsx';

/** Built from the code point so no tool rewrites it into the character itself. */
const LONG_DASH = String.fromCharCode(0x2014);

export function measure(source, filename = 'component.tsx') {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let inlineStyles = 0;
  let rawCodes = 0;
  let emDashes = 0;
  let rawDetails = 0;
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
      node.tagName.getText(file) === 'details'
    )
      rawDetails += 1;
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
  return { inlineStyles, rawCodes, emDashes, rawDetails };
}

export function measureTree(root) {
  const inlineStyles = {};
  const rawCodes = {};
  const emDashes = {};
  const rawDetails = {};
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test')) {
        const counts = measure(readFileSync(full, 'utf8'), full);
        const key = relative(root, full).replaceAll('\\', '/');
        if (counts.inlineStyles) inlineStyles[key] = counts.inlineStyles;
        if (counts.rawCodes) rawCodes[key] = counts.rawCodes;
        if (counts.emDashes) emDashes[key] = counts.emDashes;
        if (counts.rawDetails && key !== DETAILS_HOME) rawDetails[key] = counts.rawDetails;
      }
    }
  };
  walk(join(root, 'apps/web/src'));
  return { inlineStyles, rawCodes, emDashes, rawDetails };
}

const FIX = {
  inlineStyles: 'Use a shared class.',
  rawCodes: 'Use a plain label.',
  emDashes: 'Use a full stop or a hyphen.',
  rawDetails: 'Use ExpandableSection from components/ui-lift/expandable-section.tsx.',
};

const COUNTERS = ['inlineStyles', 'rawCodes', 'emDashes', 'rawDetails'];

const total = (map) => Object.values(map).reduce((sum, value) => sum + value, 0);

export function compare(current, baseline) {
  const errors = [];
  for (const [label, key] of [
    ['inline style props', 'inlineStyles'],
    ['raw codes shown as page text', 'rawCodes'],
    ['long dashes in visible text', 'emDashes'],
    ['raw details elements', 'rawDetails'],
  ]) {
    for (const [file, count] of Object.entries(current[key] ?? {})) {
      const allowed = baseline[key]?.[file] ?? 0;
      if (count > allowed)
        errors.push(
          `${file}: ${count} ${label}, up from ${allowed}. ${FIX[key]}`,
        );
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
