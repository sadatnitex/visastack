// Writes the starter checklist seed files from the owner's research sheets (CSV, six columns:
// country, purpose, appliesWhen, text, keep, reference), so no line is retyped by hand.
//
//   --replace <csv>  lines that replace the Tourist and Business lines of the countries they name,
//                    in packages/core/src/starter-checklists/seed-rows.ts (other lines untouched)
//   --add <csv>      lines for new countries, written to seed-rows-new-countries.ts
//   --date <YYYY-MM-DD>  the day the owner's research was supplied, named in the file comments
//
// Usage (from the repository root):
//   node --experimental-strip-types scripts/country-packs/build-starter-seed.mjs \
//     --replace visastack_update_existing_countries.csv --add visastack_load_new_countries.csv \
//     --date 2026-11-13
// Then run `pnpm exec biome format --write packages/core/src/starter-checklists`.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DIR = 'packages/core/src/starter-checklists';
const COLUMNS = ['country', 'purpose', 'appliesWhen', 'text', 'keep', 'reference'];
const PURPOSES = ['Tourist (base)', 'Business (extra)'];
const LONG_DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

/** Reads a six-column sheet and refuses anything the seed must not hold. */
export function readSheet(text, parseCsv) {
  const [header = [], ...body] = parseCsv(text.replace(/^﻿/, ''));
  if (header.join('|') !== COLUMNS.join('|')) {
    throw new Error(`expected the columns ${COLUMNS.join(', ')}, got ${header.join(', ')}`);
  }
  const rows = [];
  for (const cells of body) {
    if (cells.every((c) => c.trim() === '')) continue;
    if (cells.length !== COLUMNS.length) throw new Error(`a line has ${cells.length} cells`);
    const row = Object.fromEntries(COLUMNS.map((name, i) => [name, cells[i]]));
    if (!PURPOSES.includes(row.purpose)) throw new Error(`purpose "${row.purpose}" is not allowed`);
    if (row.keep !== 'Yes') throw new Error(`keep "${row.keep}" is not Yes`);
    for (const name of COLUMNS) {
      const value = row[name];
      if (value.trim() === '') throw new Error(`${row.country}: ${name} is empty`);
      if (/NOT_FOUND/.test(value)) throw new Error(`${row.country}: ${name} is NOT_FOUND`);
      if (LONG_DASHES.test(value)) throw new Error(`${row.country}: ${name} holds a long dash`);
    }
    rows.push(row);
  }
  return rows;
}

const literal = (row) =>
  `  {\n${COLUMNS.map((name) => `    ${name}: ${JSON.stringify(row[name])},`).join('\n')}\n  },`;

/** The original lines with the named countries' Tourist and Business lines swapped for new ones. */
export function replaceCountries(original, replacements) {
  const countries = [...new Set(replacements.map((r) => r.country))];
  for (const country of countries) {
    if (!original.some((r) => r.country === country)) {
      throw new Error(`${country} is not in the existing seed, so nothing can be replaced`);
    }
  }
  const out = [];
  const done = new Set();
  for (const row of original) {
    const replaced = countries.includes(row.country) && PURPOSES.includes(row.purpose);
    if (!replaced) {
      out.push({ row });
      continue;
    }
    if (done.has(row.country)) continue;
    done.add(row.country);
    out.push({ country: row.country, rows: replacements.filter((r) => r.country === row.country) });
  }
  const noSlot = countries.filter((country) => !done.has(country));
  if (noSlot.length > 0) {
    throw new Error(`${noSlot.join(', ')} has no Tourist or Business lines to replace`);
  }
  return out;
}

/** A paragraph as comment lines no wider than 100 characters. */
function comment(text, indent = ' * ') {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && indent.length + line.length + 1 + word.length > 100) {
      lines.push(`${indent}${line}`);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(`${indent}${line}`);
  return lines.join('\n');
}

function seedRowsFile(entries, date, counts) {
  const body = entries
    .map((entry) => {
      if (entry.row) return literal(entry.row);
      const note = comment(
        `${entry.country}: the Tourist and Business lines were replaced on ${date} with the owner's checked list (official pages where found, agency files otherwise; each line names its source, grade and Checked on date). The earlier agency lines are in git history.`,
        '  // ',
      );
      return [note, ...entry.rows.map(literal)].join('\n');
    })
    .join('\n');
  return `import type { StarterSheetRow } from './build';

/**
 * The country checklists supplied by the owner on 6 November 2026 ("VisaStack Country Checklists
 * Editable"): 485 lines for 33 countries, as the sheet has them. They are starting references from
 * the agency's shared files, not official and not a check against current rules. Loading them into
 * Pack Studio is an explicit admin action; nothing here reaches a traveller by itself.
 *
${comment(`Source changed on ${date}: the Tourist and Business lines of ${counts.countries.join(', ')} were replaced with ${counts.added} lines of the owner's research. The earlier agency lines for them are in git history. Written by scripts/country-packs/build-starter-seed.mjs from visastack_update_existing_countries.csv; this file now holds ${counts.total} lines. The lists stay starter lists, not official.`)}
 */
export const SHEET_SEED_ROWS: readonly StarterSheetRow[] = [
${body}
];
`;
}

function newCountriesFile(rows, date) {
  const countries = [...new Set(rows.map((r) => r.country))];
  return `import type { StarterSheetRow } from './build';

/**
${comment(`Starter lines for ${countries.length} more countries (${countries.join(', ')}): ${rows.length} lines from the owner's research supplied on ${date} (visastack_load_new_countries.csv), written by scripts/country-packs/build-starter-seed.mjs. Each line names its source, evidence grade and Checked on date. They are starter lists like the rest, not official; loading them into Pack Studio is an explicit admin action.`)}
 */
export const NEW_COUNTRY_SEED_ROWS: readonly StarterSheetRow[] = [
${rows.map(literal).join('\n')}
];
`;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0 || !args[i + 1]) throw new Error(`${flag} is required`);
    return args[i + 1];
  };
  const date = get('--date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date must be YYYY-MM-DD');
  const { parseCsv } = await import(pathToFileURL(join(process.cwd(), 'packages/core/src/csv.ts')));
  const { SHEET_SEED_ROWS } = await import(pathToFileURL(join(process.cwd(), DIR, 'seed-rows.ts')));
  const replacements = readSheet(readFileSync(get('--replace'), 'utf8'), parseCsv);
  const additions = readSheet(readFileSync(get('--add'), 'utf8'), parseCsv);
  const known = new Set(SHEET_SEED_ROWS.map((r) => r.country));
  for (const row of additions) {
    if (known.has(row.country)) throw new Error(`${row.country} already has seed lines`);
  }
  const entries = replaceCountries(SHEET_SEED_ROWS, replacements);
  const kept = entries.filter((e) => e.row).length;
  const counts = {
    countries: [...new Set(replacements.map((r) => r.country))],
    added: replacements.length,
    total: kept + replacements.length,
  };
  writeFileSync(join(DIR, 'seed-rows.ts'), seedRowsFile(entries, date, counts));
  writeFileSync(join(DIR, 'seed-rows-new-countries.ts'), newCountriesFile(additions, date));
  console.info(JSON.stringify({ ...counts, newCountryLines: additions.length }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
