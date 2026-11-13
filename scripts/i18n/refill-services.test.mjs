import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { quote as q } from './catalog.mjs';
import {
  ENGLISH_ONLY,
  SERVICES_I18N_REL,
  parseServiceCatalogue,
  refillServiceBengali,
} from './refill-services.mjs';
import { HOLDBACK, Register } from './register.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HELD = [...HOLDBACK.keys()][0];
const csv = (rows) =>
  `semantic_group,review_queue,english,bn_BD_draft,automated_checks\n${rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')}\n`;

const ENGLISH = {
  'x.plain': 'case not found',
  'x.entity': 'Use "Other"',
  'x.held': 'held sentence',
  'x.official': 'official sentence',
  'x.failing': 'failing sentence',
  'x.nodraft': 'no draft sentence',
  'x.count': 'Up to {max} files.',
  'x.countWrongName': 'Up to {max} papers.',
  'x.countDraftDiffers': 'Keep {n} words.',
  'x.plural': '{count, plural, one {# file} other {# files}} left',
  'x.pluralNoOther': '{count, plural, one {# day} other {# days}} left',
  'x.pluralNoNumber': '{count, plural, one {# week} other {# weeks}} left',
  'x.dashEntity': 'dash sentence',
  'x.payment': 'payment sentence',
  'x.homograph': 'not available',
  'x.homographNoCensus': 'not shown',
  'x.borrowed': 'borrowed sentence',
  'x.blockedByOfficial': 'blocked sentence',
  'x.existing': 'existing sentence',
  'x.oneAnswer': 'Invitation unavailable.',
};

const register = new Register({
  registerCsv: csv([
    ['SG-plain', 'ORDINARY_UI', 'case not found', 'ফাইল পাওয়া যায়নি', 'PASS'],
    ['SG-entity', 'ORDINARY_UI', 'Use "Other"', '&quot;অন্যান্য&quot; ব্যবহার করুন', 'PASS'],
    [HELD, 'ORDINARY_UI', 'held sentence', 'আটকে রাখা', 'PASS'],
    ['SG-off', 'OFFICIAL_VISA_REQUIREMENT', 'official sentence', 'অফিসিয়াল', 'PASS'],
    ['SG-fail', 'ORDINARY_UI', 'failing sentence', 'ব্যর্থ', 'FAIL:GLOSSARY'],
    ['SG-nodraft', 'ORDINARY_UI', 'no draft sentence', '', ''],
    ['SG-count', 'ORDINARY_UI', 'Up to {max} files.', 'সর্বোচ্চ {max}টি ফাইল।', 'PASS'],
    [
      'SG-papers',
      'ORDINARY_UI',
      'Up to {PAPERS_MAX} papers.',
      'সর্বোচ্চ {PAPERS_MAX}টি কাগজ।',
      'PASS',
    ],
    ['SG-words', 'ORDINARY_UI', 'Keep {n} words.', '{count}টি শব্দ রাখুন।', 'PASS'],
    [
      'SG-plural',
      'ORDINARY_UI',
      '{count, plural, one {# file} other {# files}} left',
      '{count, plural, other {#টি ফাইল}} বাকি',
      'PASS',
    ],
    [
      'SG-plural2',
      'ORDINARY_UI',
      '{count, plural, one {# day} other {# days}} left',
      '{count, plural, one {# দিন}} বাকি',
      'PASS',
    ],
    [
      'SG-plural3',
      'ORDINARY_UI',
      '{count, plural, one {# week} other {# weeks}} left',
      '{count, plural, other {সপ্তাহ}} বাকি',
      'PASS',
    ],
    ['SG-dash', 'ORDINARY_UI', 'dash sentence', 'ক &mdash; খ', 'PASS'],
    ['SG-own-payment', 'COMMERCIAL', 'payment sentence', '', ''],
    ['SG-pay-lender', 'ORDINARY_UI', 'payment sentence', 'অর্থের বাক্য', 'PASS'],
    ['SG-home-a', 'ORDINARY_UI', 'not available', 'পাওয়া যাচ্ছে না (ক)', 'PASS'],
    ['SG-home-b', 'ORDINARY_UI', 'not available', 'পাওয়া যাচ্ছে না (খ)', 'PASS'],
    ['SG-shown-a', 'ORDINARY_UI', 'not shown', 'দেখানো হয়নি (ক)', 'PASS'],
    ['SG-shown-b', 'ORDINARY_UI', 'not shown', 'দেখানো হয়নি (খ)', 'PASS'],
    ['SG-own-empty', 'ORDINARY_UI', 'borrowed sentence', '', ''],
    ['SG-lender', 'ORDINARY_UI', 'borrowed sentence', 'ধার করা বাক্য', 'PASS'],
    ['SG-own-official', 'OFFICIAL_VISA_REQUIREMENT', 'blocked sentence', '', ''],
    ['SG-other-pass', 'ORDINARY_UI', 'blocked sentence', 'আটকানো বাক্য', 'PASS'],
    ['SG-existing', 'ORDINARY_UI', 'existing sentence', 'নতুন খসড়া', 'PASS'],
    ['SG-one', 'ORDINARY_UI', 'Invitation unavailable.', 'আমন্ত্রণ পাওয়া যাচ্ছে না।', 'PASS'],
  ]),
});

const census = `file,line_start,english,semantic_group
packages/services/src/area.ts,10,not available,SG-home-b
packages/services/src/area.ts,11,borrowed sentence,SG-own-empty
packages/services/src/area.ts,12,blocked sentence,SG-own-official
packages/services/src/area.ts,13,Up to {PAPERS_MAX} papers.,SG-papers
packages/services/src/area.ts,14,payment sentence,SG-own-payment
`;

const catalogueSource = (en, bn) =>
  `/** Area refusals. */\nexport const areaEn = {\n${Object.entries(en)
    .map(([k, v]) => `  ${q(k)}: ${q(v)},`)
    .join('\n')}\n} as const;\n\nexport const areaBn = {\n${Object.entries(bn)
    .map(([k, v]) => `  ${q(k)}: ${q(v)},`)
    .join('\n')}\n} as const;\n`;

function fixture(bn = { 'x.existing': 'আগের বাংলা' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refill-services-'));
  fs.mkdirSync(path.join(dir, SERVICES_I18N_REL), { recursive: true });
  fs.writeFileSync(path.join(dir, SERVICES_I18N_REL, 'area.ts'), catalogueSource(ENGLISH, bn));
  fs.writeFileSync(path.join(dir, SERVICES_I18N_REL, 'index.ts'), 'export {};\n');
  fs.writeFileSync(
    path.join(dir, 'packages/services/src/area.ts'),
    Object.keys(ENGLISH)
      .map((k) => `keyedError('invalid', '${k}');`)
      .join('\n'),
  );
  return dir;
}

const run = (dir, extra = {}) =>
  refillServiceBengali({ root: dir, register, censusCsv: census, ...extra })[0];
const read = (dir) =>
  parseServiceCatalogue(fs.readFileSync(path.join(dir, SERVICES_I18N_REL, 'area.ts'), 'utf8'));
const reasonOf = (r, key) => r.skipped.find((s) => s.key === key)?.reason;

describe('refillServiceBengali', () => {
  test('fills PASS rows only, decodes entities, and leaves the English byte-identical', () => {
    const dir = fixture();
    const before = read(dir).en.values;
    const r = run(dir);
    const after = read(dir);
    assert.deepEqual(after.en.values, before);
    assert.equal(after.bn.values['x.plain'], 'ফাইল পাওয়া যায়নি');
    assert.equal(after.bn.values['x.entity'], '"অন্যান্য" ব্যবহার করুন');
    assert.deepEqual(r.filled, [
      'x.plain',
      'x.entity',
      'x.count',
      'x.plural',
      'x.homograph',
      'x.borrowed',
      'x.oneAnswer',
    ]);
  });

  test('skips held, unreleased, failing and undrafted rows', () => {
    const r = run(fixture());
    assert.match(reasonOf(r, 'x.held'), /^held_back:/);
    assert.equal(
      reasonOf(r, 'x.official'),
      'review_queue_not_signed_off:OFFICIAL_VISA_REQUIREMENT',
    );
    assert.equal(reasonOf(r, 'x.failing'), 'checks_not_pass:FAIL');
    assert.equal(reasonOf(r, 'x.nodraft'), 'no_bn_draft');
    // An entity that spells an em dash is caught after decoding.
    assert.equal(reasonOf(r, 'x.dashEntity'), 'bn_has_marker_or_em_dash');
  });

  test('keeps placeholders exactly: a different name in the draft or the register stays English', () => {
    const dir = fixture();
    const r = run(dir);
    assert.equal(read(dir).bn.values['x.count'], 'সর্বোচ্চ {max}টি ফাইল।');
    assert.equal(reasonOf(r, 'x.countDraftDiffers'), 'bn_placeholders_differ');
    const wrong = r.skipped.find((s) => s.key === 'x.countWrongName');
    assert.equal(wrong.reason, 'placeholder_names_differ');
    assert.deepEqual(wrong.groups, ['SG-papers']);
  });

  test('fills an ICU plural whose shape matches, refuses one without an other branch', () => {
    const dir = fixture();
    const r = run(dir);
    assert.equal(read(dir).bn.values['x.plural'], '{count, plural, other {#টি ফাইল}} বাকি');
    assert.equal(reasonOf(r, 'x.pluralNoOther'), 'bn_plural_differs');
    assert.equal(reasonOf(r, 'x.pluralNoNumber'), 'bn_plural_differs');
    // Web catalogues keep refusing plurals: the default lookup is unchanged.
    assert.equal(
      register.resolveGroup('SG-plural', ENGLISH['x.plural']).reason,
      'english_is_plural_message',
    );
  });

  test("two wordings for one English: the call site's census row decides, else it stays English", () => {
    const dir = fixture();
    const r = run(dir);
    assert.equal(read(dir).bn.values['x.homograph'], 'পাওয়া যাচ্ছে না (খ)');
    assert.equal(reasonOf(r, 'x.homographNoCensus'), 'register_ambiguous');
  });

  test("an undrafted own row borrows its English twin's Bengali; an official own row blocks it", () => {
    const dir = fixture();
    const r = run(dir);
    assert.equal(read(dir).bn.values['x.borrowed'], 'ধার করা বাক্য');
    assert.equal(
      reasonOf(r, 'x.blockedByOfficial'),
      'review_queue_not_signed_off:OFFICIAL_VISA_REQUIREMENT',
    );
    // An undrafted payment row does not borrow ordinary-screen Bengali either.
    assert.equal(reasonOf(r, 'x.payment'), 'checks_not_pass:empty');
  });

  test('never changes Bengali already in the catalogue and never fills an English-only key', () => {
    const dir = fixture({ 'x.existing': 'আগের বাংলা' });
    const r = refillServiceBengali({
      root: dir,
      register,
      censusCsv: census,
      englishOnly: new Map([['x.oneAnswer', 'one answer']]),
    })[0];
    assert.deepEqual(r.kept, ['x.existing']);
    assert.equal(read(dir).bn.values['x.existing'], 'আগের বাংলা');
    assert.equal(reasonOf(r, 'x.oneAnswer'), 'english_only');
    assert.equal(read(dir).bn.values['x.oneAnswer'], undefined);
  });

  test('a second run changes nothing', () => {
    const dir = fixture();
    run(dir);
    const file = path.join(dir, SERVICES_I18N_REL, 'area.ts');
    const once = fs.readFileSync(file, 'utf8');
    assert.deepEqual(run(dir).filled, []);
    assert.equal(fs.readFileSync(file, 'utf8'), once);
  });

  test('a dry run writes nothing', () => {
    const dir = fixture();
    const file = path.join(dir, SERVICES_I18N_REL, 'area.ts');
    const before = fs.readFileSync(file, 'utf8');
    assert.ok(run(dir, { dryRun: true }).filled.length > 0);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });

  test('refuses to rewrite a Bengali object that holds a comment', () => {
    const dir = fixture();
    const file = path.join(dir, SERVICES_I18N_REL, 'area.ts');
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, 'utf8')
        .replace(`${q('x.existing')}: ${q('আগের বাংলা')},`, '$& // owner wording'),
    );
    assert.throws(() => run(dir), /holds a comment/);
  });
});

describe('the services catalogues in this repository', () => {
  const dir = path.join(REPO, SERVICES_I18N_REL);
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .filter((f) => f !== 'index.ts' && f !== 'messages.ts');
  const catalogues = files.map((f) =>
    parseServiceCatalogue(fs.readFileSync(path.join(dir, f), 'utf8'), f),
  );

  test('a hidden-record answer (one key for both forbidden and not_found) is English-only', () => {
    const keys = new Set(catalogues.flatMap((c) => Object.keys(c.en.values)));
    const codes = new Map();
    const walk = (abs) => {
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const child = path.join(abs, e.name);
        if (e.isDirectory()) walk(child);
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
          for (const m of fs
            .readFileSync(child, 'utf8')
            .matchAll(/keyedError\(\s*'(\w+)',\s*'([\w.-]+)'/g))
            if (keys.has(m[2])) codes.set(m[2], new Set([...(codes.get(m[2]) ?? []), m[1]]));
      }
    };
    walk(path.join(REPO, 'packages/services/src'));
    const oneAnswer = [...codes]
      .filter(([, set]) => set.has('forbidden') && set.has('not_found'))
      .map(([k]) => k)
      .sort();
    for (const key of oneAnswer) assert.ok(ENGLISH_ONLY.has(key), `${key} must stay English`);
    for (const key of ENGLISH_ONLY.keys())
      for (const c of catalogues) assert.equal(c.bn.values[key], undefined, `${key} has Bengali`);
  });

  test('every Bengali key has English behind it with the same placeholders', () => {
    const names = (s) =>
      [...s.matchAll(/\{(\w+)/g)]
        .map((m) => m[1])
        .sort()
        .join(',');
    for (const c of catalogues)
      for (const [key, bn] of Object.entries(c.bn.values)) {
        assert.ok(key in c.en.values, `${key} has no English`);
        assert.equal(names(bn), names(c.en.values[key]), key);
      }
  });
});
