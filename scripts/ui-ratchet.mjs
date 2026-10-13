import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Two counters that may only go down while the interface is being improved.
 *
 * 1. Inline style props: every `style={{...}}` is a spacing or text decision made outside the
 *    shared stylesheet. The count must not rise in any file, and a file with none must stay at none.
 * 2. Raw codes shown as page text: a database value such as PASSPORT or OWNER printed straight
 *    into a page instead of a plain label. The count must not rise in any file.
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
]);

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
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === 'style') inlineStyles += 1;
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
  return { inlineStyles, rawCodes };
}

export function measureTree(root) {
  const inlineStyles = {};
  const rawCodes = {};
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test')) {
        const counts = measure(readFileSync(full, 'utf8'), full);
        const key = relative(root, full).replaceAll('\\', '/');
        if (counts.inlineStyles) inlineStyles[key] = counts.inlineStyles;
        if (counts.rawCodes) rawCodes[key] = counts.rawCodes;
      }
    }
  };
  walk(join(root, 'apps/web/src'));
  return { inlineStyles, rawCodes };
}

const total = (map) => Object.values(map).reduce((sum, value) => sum + value, 0);

export function compare(current, baseline) {
  const errors = [];
  for (const [label, key] of [
    ['inline style props', 'inlineStyles'],
    ['raw codes shown as page text', 'rawCodes'],
  ]) {
    for (const [file, count] of Object.entries(current[key])) {
      const allowed = baseline[key][file] ?? 0;
      if (count > allowed)
        errors.push(
          `${file}: ${count} ${label}, up from ${allowed}. Use a shared class or a plain label.`,
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
    const now = { inline: total(current.inlineStyles), raw: total(current.rawCodes) };
    const was = { inline: total(baseline.inlineStyles), raw: total(baseline.rawCodes) };
    if (process.argv.includes('--lower') && (now.inline < was.inline || now.raw < was.raw)) {
      writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
      process.stdout.write(
        `UI ratchet lowered: inline styles ${was.inline} to ${now.inline}, raw codes ${was.raw} to ${now.raw}\n`,
      );
    } else {
      const hint =
        now.inline < was.inline || now.raw < was.raw
          ? ' (lower it: node scripts/ui-ratchet.mjs --lower)'
          : '';
      process.stdout.write(
        `UI ratchet passed: inline styles ${now.inline}, raw codes ${now.raw}${hint}\n`,
      );
    }
  }
}
