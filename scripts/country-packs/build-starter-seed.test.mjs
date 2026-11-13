import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv } from '../../packages/core/src/csv.ts';
import { readSheet, replaceCountries } from './build-starter-seed.mjs';

const HEADER = '"country","purpose","appliesWhen","text","keep","reference"';
const line = (country, purpose, text, keep = 'Yes', reference = 'Page | https://x.gov | grade A') =>
  [country, purpose, 'All applicants', text, keep, reference].map((c) => `"${c}"`).join(',');
const LONG_DASH = String.fromCharCode(0x2014);

test('reads a six-column sheet, quotes and commas included', () => {
  const rows = readSheet(
    `﻿${HEADER}\n${line('Peru', 'Tourist (base)', 'Passport, valid 6 months')}\n`,
    parseCsv,
  );
  assert.deepEqual(rows, [
    {
      country: 'Peru',
      purpose: 'Tourist (base)',
      appliesWhen: 'All applicants',
      text: 'Passport, valid 6 months',
      keep: 'Yes',
      reference: 'Page | https://x.gov | grade A',
    },
  ]);
});

test('refuses what the seed must not hold', () => {
  const bad = [
    ['a different header', 'country,purpose\nPeru,Tourist (base)\n'],
    ['a purpose beyond Tourist and Business', `${HEADER}\n${line('Peru', 'Study', 'Offer')}\n`],
    ['a line marked not to keep', `${HEADER}\n${line('Peru', 'Tourist (base)', 'X', 'No')}\n`],
    ['a NOT_FOUND value', `${HEADER}\n${line('Peru', 'Tourist (base)', 'NOT_FOUND')}\n`],
    ['an empty cell', `${HEADER}\n${line('Peru', 'Tourist (base)', ' ')}\n`],
    ['a long dash', `${HEADER}\n${line('Peru', 'Tourist (base)', `A ${LONG_DASH} B`)}\n`],
  ];
  for (const [why, csv] of bad) assert.throws(() => readSheet(csv, parseCsv), Error, why);
});

test('replaces only the Tourist and Business lines of the named countries, in place', () => {
  const row = (country, purpose, text) => ({ country, purpose, text });
  const original = [
    row('Italy', 'Tourist (base)', 'old 1'),
    row('Italy', 'Business (extra)', 'old 2'),
    row('Japan', 'Tourist (base)', 'kept'),
    row('Thailand', 'Tourist (base)', 'old 3'),
    row('Thailand', 'Medical (extra)', 'kept medical'),
  ];
  const entries = replaceCountries(original, [
    row('Italy', 'Tourist (base)', 'new 1'),
    row('Thailand', 'Tourist (base)', 'new 2'),
    row('Thailand', 'Business (extra)', 'new 3'),
  ]);
  const flat = entries.flatMap((e) => (e.row ? [e.row.text] : e.rows.map((r) => r.text)));
  assert.deepEqual(flat, ['new 1', 'kept', 'new 2', 'new 3', 'kept medical']);
  assert.throws(() => replaceCountries(original, [row('Peru', 'Tourist (base)', 'x')]), /Peru/);
  // A country whose only lines are Medical has no slot: the new lines must not vanish silently.
  assert.throws(
    () =>
      replaceCountries(
        [row('India', 'Medical (extra)', 'm')],
        [row('India', 'Tourist (base)', 'x')],
      ),
    /India has no Tourist or Business lines/,
  );
});
