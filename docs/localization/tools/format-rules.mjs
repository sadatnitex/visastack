#!/usr/bin/env node
/**
 * Writes data/NUMBER_DATE_FORMAT_RULES.md and data/NUMBER_DATE_AUDIT.csv.
 * The examples are real `Intl` output from the machine that ran this script. No runtime formatting is
 * changed by this work; the rules describe what a later implementation should do.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LOC = path.join(ROOT, 'docs/localization');
const rows = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'apps/web/.preview/l10n/work/rows.json'), 'utf8'),
);

// ---- real Intl output
const d = new Date('2026-11-12T09:05:00');
const f = (loc, opts, v = d) => new Intl.DateTimeFormat(loc, opts).format(v);
const n = (loc, opts, v) => new Intl.NumberFormat(loc, opts).format(v);
const ex = [
  ['Long date', f('en-GB', { dateStyle: 'long' }), f('bn-BD', { dateStyle: 'long' })],
  ['Short date', f('en-GB', { dateStyle: 'short' }), f('bn-BD', { dateStyle: 'short' })],
  ['Weekday and date', f('en-GB', { dateStyle: 'full' }), f('bn-BD', { dateStyle: 'full' })],
  ['Time', f('en-GB', { timeStyle: 'short' }), f('bn-BD', { timeStyle: 'short' })],
  [
    'Month and day',
    f('en-GB', { day: 'numeric', month: 'short' }),
    f('bn-BD', { day: 'numeric', month: 'short' }),
  ],
  ['Count', n('en-GB', {}, 1234567), n('bn-BD', {}, 1234567)],
  ['Decimal', n('en-GB', {}, 2500.5), n('bn-BD', {}, 2500.5)],
  ['Percent', n('en-GB', { style: 'percent' }, 0.25), n('bn-BD', { style: 'percent' }, 0.25)],
  [
    'Amount in BDT',
    n('en-GB', { style: 'currency', currency: 'BDT' }, 25000),
    n('bn-BD', { style: 'currency', currency: 'BDT' }, 25000),
  ],
  [
    'Amount in USD (symbol)',
    n('en-GB', { style: 'currency', currency: 'USD' }, 150),
    n('bn-BD', { style: 'currency', currency: 'USD' }, 150),
  ],
  [
    'Amount in USD (code)',
    n('en-GB', { style: 'currency', currency: 'USD', currencyDisplay: 'code' }, 150),
    n('bn-BD', { style: 'currency', currency: 'USD', currencyDisplay: 'code' }, 150),
  ],
  ['Latin digits kept, lakh grouping', n('en-GB', {}, 1234567), n('bn-BD-u-nu-latn', {}, 1234567)],
];
const calendar = new Intl.DateTimeFormat('bn-BD').resolvedOptions().calendar;
const numbering = new Intl.NumberFormat('bn-BD').resolvedOptions().numberingSystem;
const plural = [0, 1, 2, 5]
  .map((x) => `${x}: ${new Intl.PluralRules('bn-BD').select(x)}`)
  .join(', ');
const regionSG = new Intl.DisplayNames(['bn-BD'], { type: 'region' }).of('SG');
const regionBD = new Intl.DisplayNames(['bn-BD'], { type: 'region' }).of('BD');

// ---- audit: did the digit conversion touch anything it must not?
function parseCsv(text) {
  const out = [];
  let row = [];
  let fld = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          fld += '"';
          i++;
        } else q = false;
      } else fld += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(fld);
      fld = '';
    } else if (c === '\n') {
      row.push(fld);
      out.push(row);
      row = [];
      fld = '';
    } else if (c !== '\r') fld += c;
  }
  const [h, ...b] = out;
  return b
    .filter((r) => r.length === h.length)
    .map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
const reg = parseCsv(fs.readFileSync(path.join(LOC, 'VISASTACK_TRANSLATION_REGISTER.csv'), 'utf8'));
const BN = '০১২৩৪৫৬৭৮৯';
const toLatin = (s) => s.replace(/[০-৯]/g, (c) => String(BN.indexOf(c)));
const PROTECT =
  /https?:\/\/\S+|\S+@\S+\.\S+|[A-Za-z][\w./-]*[0-9][\w./-]*|[0-9][\w./-]*[A-Za-z][\w./-]*/g;
const strip = (s) => s.replace(/\{[^}]*\}|<[^>]*>/g, ' ');
const exceptions = [];
let drafted = 0;
let withDigits = 0;
let protectedChecked = 0;
for (const r of reg) {
  if (!r.bn_BD_draft) continue;
  drafted++;
  const en = strip(r.english);
  const bn = strip(r.bn_BD_draft);
  const PROSE_NUMBER_UNIT = /^[0-9]+-(day|hour|minute|week|month|year)s?$/i; // a number written as a word, not a code
  const enProt = [...en.matchAll(PROTECT)]
    .map((m) => m[0].replace(/[.,;:)]+$/, ''))
    .filter((t) => !PROSE_NUMBER_UNIT.test(t));
  for (const t of enProt) {
    protectedChecked++;
    if (!bn.includes(t))
      exceptions.push([
        r.semantic_group,
        'PROTECTED_TOKEN_CHANGED_OR_MISSING',
        t,
        r.english,
        r.bn_BD_draft,
      ]);
  }
  const enNoProt = en.replace(PROTECT, (m) =>
    PROSE_NUMBER_UNIT.test(m.replace(/[.,;:)]+$/, '')) ? m : ' ',
  );
  const bnNoProt = bn.replace(PROTECT, ' ');
  const enDigits = enNoProt.match(/[0-9]+/g) ?? [];
  const bnLatin = bnNoProt.match(/[0-9]+/g) ?? [];
  const bnBengali = (bnNoProt.match(/[০-৯]+/g) ?? []).map(toLatin);
  if (bnBengali.length) withDigits++;
  if (bnLatin.length)
    exceptions.push([
      r.semantic_group,
      'LATIN_DIGITS_LEFT_IN_PROSE',
      bnLatin.join(' '),
      r.english,
      r.bn_BD_draft,
    ]);
  if (enDigits.length && JSON.stringify(enDigits) !== JSON.stringify([...bnBengali, ...bnLatin]))
    exceptions.push([
      r.semantic_group,
      'NUMBER_CHANGED_OR_MISSING',
      `en ${enDigits.join(' ')} vs bn ${[...bnBengali, ...bnLatin].join(' ')}`,
      r.english,
      r.bn_BD_draft,
    ]);
}
const q = (v) => `"${String(v).replace(/—/g, '[U+2014]').replace(/"/g, '""')}"`;
fs.writeFileSync(
  path.join(LOC, 'data/NUMBER_DATE_AUDIT.csv'),
  `${['semantic_group,issue,detail,english,bn_BD_draft', ...exceptions.map((e) => e.map(q).join(','))].join('\n')}\n`,
);

// identifiers present in source strings (examples for the table)
const sample = (re) =>
  [...new Set(rows.filter((r) => re.test(r.english)).map((r) => r.english))]
    .slice(0, 3)
    .join('; ') || 'none in static source';

const L = [
  '# Bengali number and date rules (documentation only)',
  '',
  'Scope: rules for a later implementation. Nothing in the product was changed, no runtime formatting was implemented, and the language switch stays off. Examples are real `Intl` output from the machine that generated this file (Node ICU), so they show what the platform produces, not what anyone assumed.',
  '',
  '## 1. The principle',
  '',
  '1. **Human-readable numbers and dates** (counts, amounts, dates, times, percentages written for a person) follow the `bn-BD` locale: Bengali digits, lakh grouping, Bengali month names. The owner decided Bengali digits in prose on 2026-11-12.',
  '2. **Anything a person types, copies, reads back or matches against another system stays exactly as it is**: passport numbers, national ID numbers, document numbers, application and reference codes (for example `C-8807JK`, `D-3M46M5`, `R-0PPRBH`), case and request codes, email addresses, URLs, file names, phone numbers as entered, one-time codes, and any other technical value the user entered. Never convert digits or letters in these, never add grouping, never translate.',
  '3. **Machine-readable fields stay ISO**: dates in exports, calendar files, email headers, URLs and API fields keep ISO 8601 and Latin digits. Only the text shown to a person is localised.',
  "4. **Names and addresses**: Bengali and Latin letters are both left-to-right, so a name in either script may sit inside a Bengali sentence. Keep a person's name in the script they entered it.",
  '',
  '## 2. What the platform produces for bn-BD',
  '',
  `Resolved calendar: \`${calendar}\` (Gregorian). Resolved numbering system: \`${numbering}\` (Bengali digits). Plural categories (CLDR): ${plural}. Country names: Singapore is \`${regionSG}\`, Bangladesh is \`${regionBD}\` (from \`Intl.DisplayNames\`, which the product currently calls with English only).`,
  '',
  '| Kind | en-GB today | bn-BD |',
  '|---|---|---|',
  ...ex.map((e) => `| ${e[0]} | ${e[1]} | ${e[2]} |`),
  '',
  'Notes from the output: dates use Bengali digits and Bengali month names; grouping is lakh style (`12,34,567`); BDT shows the taka sign after the number; the AM/PM marker stays Latin in this ICU build; the plural rule treats 0 and 1 as the same category.',
  '',
  '## 3. Category rules',
  '',
  '| Category | Examples in the product | Rule |',
  '|---|---|---|',
  `| Reference and case codes | ${sample(/\b[CDRP]-[A-Z0-9]{4,}/)} | Keep exactly. Not a number to format |`,
  '| Passport, ID, document numbers, phone numbers entered by the user | entered at run time | Keep exactly, including Latin digits |',
  '| Email addresses and URLs | `jane@example.com`, `https://` | Keep exactly |',
  '| Counts shown to a person | `{count}`, `{length}` | bn-BD number format (Bengali digits, lakh grouping) |',
  '| Dates and times shown to a person | expiry dates, reminders, history | bn-BD date format. Gregorian calendar only. Do not use the Bengali (Bongabdo) calendar unless the owner decides |',
  '| Fees and amounts | visa fee and plan amounts | Decision for the editor: bn-BD currency format (`২৫,০০০.০০৳`) or keep the ISO currency code beside the amount, for official fees where ambiguity would be costly. Never convert currencies |',
  '| File sizes | `4 MB`, `{uploadLimitLabel}` | Digits follow the prose rule; the unit stays `MB` unless the editor chooses a Bengali unit |',
  '| Durations in prose | `7 days`, `24 hours` | Bengali digits; no plural suffix is needed |',
  '| Typed confirmation keywords | `DELETE` | Keep exactly; the person must type it |',
  '| ISO dates in exports and calendar files | `2026-11-12` | Keep ISO and Latin digits |',
  '',
  '## 4. What the register drafts do today',
  '',
  `Static digits in drafted Bengali prose were converted to Bengali digits by the register builder, skipping placeholders, tags, URLs, email addresses and code-like tokens. Audit of ${drafted} drafted groups: ${withDigits} contain Bengali digits; ${protectedChecked} protected tokens (emails, URLs, code-like tokens) in the English were checked for survival in the Bengali; ${exceptions.length} exception(s) are listed in \`data/NUMBER_DATE_AUDIT.csv\` (issue types: protected token changed or missing, Latin digits left in prose, number changed or missing).`,
  '',
  '## 5. What a later implementation must do (not done here)',
  '',
  '1. Pass the resolved locale (`bn-BD`) to every `Intl` and `toLocale*` call. 30 calls in the web app fix English today (see the coverage report).',
  '2. Format only values meant for people. Render identifiers, codes and typed values through a path that never formats.',
  "3. Keep input fields (dates, numbers, phone) in the control's own format; validate on the Latin form the server expects.",
  '4. Decide AM/PM versus 24-hour time, and the currency display, with the editor.',
  '',
];
fs.writeFileSync(path.join(LOC, 'data/NUMBER_DATE_FORMAT_RULES.md'), L.join('\n'));
process.stdout.write(
  `format rules written; drafts ${drafted}, with Bengali digits ${withDigits}, exceptions ${exceptions.length}\n`,
);
