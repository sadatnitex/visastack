#!/usr/bin/env node
/**
 * Builds docs/localization/service-english-golden.json: every person-facing English string the
 * census found in packages/services and packages/core, grouped by source file. The golden test
 * (packages/services/src/english-golden.test.ts) checks each one still appears word for word,
 * either in its source file or in an `en` catalogue under that package's i18n folder. AI model
 * prompts and assistant tool text are left out on purpose: they stay English for the model.
 *
 * Usage: node docs/localization/tools/build-service-golden.mjs
 * Run it only when the census is regenerated; the golden is not edited by hand.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CSV = path.join(ROOT, 'docs/localization/VISASTACK_UI_SOURCE_CENSUS.csv');
const OUT = path.join(ROOT, 'docs/localization/service-english-golden.json');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  return rows;
}

/** The text outside every (possibly nested) {placeholder}, trimmed. */
function fixedText(english) {
  let depth = 0;
  let text = '';
  for (const char of english) {
    if (char === '{') depth += 1;
    else if (char === '}' && depth > 0) depth -= 1;
    else if (depth === 0) text += char;
  }
  return text.trim();
}

const rows = parseCsv(fs.readFileSync(CSV, 'utf8'));
const head = rows[0];
const col = (name) => head.indexOf(name);
const byFile = {};
for (const r of rows.slice(1)) {
  const file = r[col('file')];
  if (!/^packages\/(services|core)\//.test(file) || r[col('audience')] !== 'person') continue;
  const english = r[col('english')];
  // A value that is only placeholders (or code in braces) carries no words to keep.
  if (!english || fixedText(english).length < 3) continue;
  if (!byFile[file]) byFile[file] = new Set();
  byFile[file].add(english);
}
const out = {};
for (const file of Object.keys(byFile).sort()) out[file] = [...byFile[file]].sort();
fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`);
// The repository formatter owns the layout of every committed file.
execFileSync('pnpm', ['exec', 'biome', 'format', '--write', OUT], { cwd: ROOT, stdio: 'inherit' });
const count = Object.values(out).reduce((n, l) => n + l.length, 0);
console.info(`${Object.keys(out).length} files, ${count} strings, ${fs.statSync(OUT).size} bytes`);
