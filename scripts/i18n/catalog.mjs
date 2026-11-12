/**
 * Read and write a surface catalogue (apps/web/src/i18n/<surface>.ts) and its traceability map
 * (<surface>.sources.json). Existing entries are never removed or rewritten: English keys stay,
 * and Bengali someone already wrote stays. Output is sorted, so the same content always produces
 * the same bytes.
 */
import fs from 'node:fs';
import ts from 'typescript';
import { camel } from './rules.mjs';

export const catalogIdent = (surface) => `${camel(surface)}Catalog`;
export const catalogRel = (surface) => `apps/web/src/i18n/${surface}.ts`;
export const sourcesRel = (surface) => `apps/web/src/i18n/${surface}.sources.json`;

const unquote = (n) => (ts.isStringLiteral(n) || ts.isIdentifier(n) ? n.text : null);

/** Parse an existing catalogue. Throws when it holds anything but literal key/value pairs. */
export function parseCatalog(code, file = 'catalog.ts') {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = null;
  const visit = (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'defineCatalog' &&
      n.arguments[0] &&
      ts.isObjectLiteralExpression(n.arguments[0])
    )
      found = n.arguments[0];
    else ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!found) throw new Error(`${file}: no defineCatalog({ en, bn }) call`);
  const out = { en: {}, bn: {} };
  for (const p of found.properties) {
    if (!ts.isPropertyAssignment(p)) throw new Error(`${file}: unexpected ${p.getText()}`);
    const side = unquote(p.name);
    if (side !== 'en' && side !== 'bn') throw new Error(`${file}: unexpected locale ${side}`);
    if (!ts.isObjectLiteralExpression(p.initializer))
      throw new Error(`${file}: ${side} is not an object literal`);
    for (const e of p.initializer.properties) {
      const key = ts.isPropertyAssignment(e) ? unquote(e.name) : null;
      if (
        key === null ||
        !(ts.isStringLiteral(e.initializer) || ts.isNoSubstitutionTemplateLiteral(e.initializer))
      )
        throw new Error(`${file}: only literal messages are supported (${e.getText()})`);
      out[side][key] = e.initializer.text;
    }
  }
  return out;
}

export function readCatalog(abs) {
  if (!fs.existsSync(abs)) return { en: {}, bn: {} };
  return parseCatalog(fs.readFileSync(abs, 'utf8'), abs);
}

/** A JS string literal with no em dash in the file (written as an escape). */
export function quote(s) {
  return JSON.stringify(s)
    .replace(/\u2014/g, '\\u2014')
    .replace(/\u2013/g, '\\u2013');
}

const byKey = (o) => Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export function renderCatalog(surface, en, bn) {
  const lines = [
    "import { defineCatalog } from '@visastack/i18n';",
    '',
    '/**',
    ` * Messages for the ${surface} surface. Keys were created by scripts/i18n/codemod.mjs; English is`,
    ' * the source text and must not change without the screen changing. Bengali comes from',
    ' * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.',
    ' */',
    `export const ${catalogIdent(surface)} = defineCatalog({`,
    '  en: {',
    ...byKey(en).map((k) => `    ${quote(k)}: ${quote(en[k])},`),
    '  },',
    '  bn: {',
    ...byKey(bn).map((k) => `    ${quote(k)}: ${quote(bn[k])},`),
    '  },',
    '});',
    '',
  ];
  return lines.join('\n');
}

export function readSources(abs) {
  if (!fs.existsSync(abs)) return {};
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

export function renderSources(map) {
  const sorted = {};
  for (const k of byKey(map)) sorted[k] = map[k];
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
