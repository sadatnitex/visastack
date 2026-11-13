import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { readCatalog, renderCatalog, renderSources } from './catalog.mjs';
import { KEY_HOLDBACK, loadKeyDrafts, refillBengali } from './refill.mjs';

const SIGNOFF_NOTE =
  'Legal wording: OWNER_BLANKET_SIGNOFF_2026-11-12 (legal wording, not reviewed)';
import { HOLDBACK, Register } from './register.mjs';

const BN = 'শর্ত';
const header = 'semantic_group,review_queue,english,bn_BD_draft,automated_checks\n';
const reg = new Register({
  registerCsv:
    `${header}SG-A,PRIVACY_CONSENT_LEGAL,Terms of use,${BN},PASS\n` +
    `SG-B,OFFICIAL_VISA_REQUIREMENT,Fee,${BN},PASS\n` +
    `SG-C,ORDINARY_UI,Save,${BN},CASE_UPLOAD_AMBIGUITY\n` +
    `SG-D,ORDINARY_UI, (Optional),${BN},PASS\n`,
});

function root(bn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refill-'));
  fs.mkdirSync(path.join(dir, 'apps/web/src/i18n'), { recursive: true });
  const en = {
    'x.terms': 'Terms of use',
    'x.fee': 'Fee',
    'x.save': 'Save',
    'x.two': 'Terms of use',
  };
  fs.writeFileSync(path.join(dir, 'apps/web/src/i18n/x.ts'), renderCatalog('x', en, bn));
  fs.writeFileSync(
    path.join(dir, 'apps/web/src/i18n/x.sources.json'),
    renderSources({
      'x.terms': 'SG-A',
      'x.fee': 'SG-B',
      'x.save': 'SG-C',
      'x.two': 'SG-A|SG-C',
      'x.optional': 'SG-D',
    }),
  );
  return dir;
}

describe('refillBengali', () => {
  test('fills a released, passing key only; official queue, failed checks and ambiguous keys stay English', () => {
    const dir = root({});
    const [r] = refillBengali({ root: dir, register: reg, format: undefined });
    assert.deepEqual(r.filled, ['x.terms']);
    const cat = readCatalog(path.join(dir, 'apps/web/src/i18n/x.ts'));
    assert.deepEqual(Object.keys(cat.bn), ['x.terms']);
    assert.equal(cat.bn['x.terms'], BN);
  });

  test('never rewrites Bengali already in the catalogue, and a second run changes nothing', () => {
    const dir = root({ 'x.terms': 'old' });
    assert.deepEqual(refillBengali({ root: dir, register: reg })[0].filled, []);
    assert.equal(readCatalog(path.join(dir, 'apps/web/src/i18n/x.ts')).bn['x.terms'], 'old');
    const again = root({});
    refillBengali({ root: again, register: reg });
    assert.deepEqual(refillBengali({ root: again, register: reg })[0].filled, []);
  });

  test('a dry run writes nothing', () => {
    const dir = root({});
    refillBengali({ root: dir, register: reg, dryRun: true });
    assert.deepEqual(readCatalog(path.join(dir, 'apps/web/src/i18n/x.ts')).bn, {});
  });

  test('decodes HTML entities in the register Bengali, so a catalogue never holds "&middot;"', () => {
    const entityReg = new Register({
      registerCsv: `${header}SG-A,PRIVACY_CONSENT_LEGAL,Terms of use,ক &middot; খ &amp; গ,PASS\n`,
    });
    const dir = root({});
    refillBengali({ root: dir, register: entityReg });
    const value = readCatalog(path.join(dir, 'apps/web/src/i18n/x.ts')).bn['x.terms'];
    assert.equal(value, 'ক \u00b7 খ & গ');
    assert.ok(!/&[a-z#0-9]+;/i.test(value));
  });
});

describe('refillBengali: drafts written for a catalogue key (no census row, no register group)', () => {
  const KEPT = 'This copy answered a request from an agency, so it is kept.';
  const KEPT_BN = 'এই কপিটি একটি এজেন্সির অনুরোধের উত্তরে দেওয়া হয়েছিল, তাই এটি রাখা আছে।';
  /** A catalogue whose keys have no register group (sources null), as the removal sentences do. */
  function keyRoot(en, extraSources = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refill-key-'));
    fs.mkdirSync(path.join(dir, 'apps/web/src/i18n'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'apps/web/src/i18n/x.ts'), renderCatalog('x', en, {}));
    fs.writeFileSync(
      path.join(dir, 'apps/web/src/i18n/x.sources.json'),
      renderSources({
        ...Object.fromEntries(Object.keys(en).map((k) => [k, null])),
        ...extraSources,
      }),
    );
    return dir;
  }
  const drafts = (rows) => new Map(rows.map(([k, en, bn, note = '']) => [k, { en, bn, note }]));
  const run = (dir, keyDrafts, extra = {}) =>
    refillBengali({ root: dir, register: reg, keyDrafts, ...extra })[0].filled;

  test('fills a key with no register group from a passing draft written for that key', () => {
    const dir = keyRoot({ 'x.kept': KEPT });
    assert.deepEqual(run(dir, drafts([['x.kept', KEPT, KEPT_BN]])), ['x.kept']);
    assert.equal(readCatalog(path.join(dir, 'apps/web/src/i18n/x.ts')).bn['x.kept'], KEPT_BN);
  });

  test('loads key drafts from no-census-*.jsonl: a later row is a correction, a torn line is skipped', () => {
    const dir = keyRoot({ 'x.kept': KEPT, 'x.fixed': 'Save', 'x.torn': 'Close' });
    const d = path.join(dir, 'docs/localization/data/drafts');
    fs.mkdirSync(d, { recursive: true });
    const row = (k, en, bn) => JSON.stringify({ catalogue_key: k, en, bn, note: '' });
    fs.writeFileSync(
      path.join(d, 'no-census-A.jsonl'),
      `${row('x.kept', KEPT, KEPT_BN)}\n${row('x.fixed', 'Save', 'একটি নথি')}\n`,
    );
    fs.writeFileSync(
      path.join(d, 'no-census-B.jsonl'),
      `${row('x.fixed', 'Save', 'সংরক্ষণ করুন')}\n{"catalogue_key": "x.torn", "en": "Close", "bn": "বন্`,
    );
    fs.writeFileSync(path.join(d, 'bn-BD.part-Z.jsonl'), `${row('x.other', 'Save', 'সেভ')}\n`);
    const loaded = loadKeyDrafts(dir);
    assert.deepEqual([...loaded.keys()].sort(), ['x.fixed', 'x.kept']);
    assert.equal(loaded.get('x.fixed')?.bn, 'সংরক্ষণ করুন');
    assert.deepEqual(refillBengali({ root: dir, register: reg })[0].filled, ['x.fixed', 'x.kept']);
  });

  test('other English, failing checks, Latin digits, a held key, official wording, or legal and payment wording without the sign-off stays English', () => {
    const held = [...KEY_HOLDBACK.keys()][0];
    const legal = 'This copy must be kept for a legal requirement.';
    const paid = 'This copy is kept while a payment is open.';
    const en = {
      'x.changed': KEPT,
      'x.failing': 'Upload a document.',
      'x.digits': 'It stays for 30 days.',
      'x.official': 'Check the embassy website before you go.',
      'x.legal': legal,
      'x.paid': paid,
      [held]: KEPT,
    };
    const dir = keyRoot(en);
    const filled = run(
      dir,
      drafts([
        ['x.changed', 'This copy answered a request, so it is kept.', KEPT_BN],
        // নথি fails the guardrail check (NOT_STANDARD_DOCUMENT_WORD).
        ['x.failing', 'Upload a document.', 'একটি নথি আপলোড করুন।'],
        // A key draft is final as written: Latin digits in Bengali prose do not ship.
        ['x.digits', 'It stays for 30 days.', 'এটি 30 দিন থাকে।'],
        ['x.official', 'Check the embassy website before you go.', 'যাওয়ার আগে দূতাবাসের ওয়েবসাইট দেখুন।'],
        ['x.legal', legal, 'একটি আইনি প্রয়োজনে এই কপিটি রেখে দিতে হবে।'],
        ['x.paid', paid, 'একটি পেমেন্ট চালু থাকা পর্যন্ত এই কপিটি রাখা থাকবে।'],
        [held, KEPT, KEPT_BN, SIGNOFF_NOTE],
      ]),
    );
    assert.deepEqual(filled, []);
    assert.deepEqual(readCatalog(path.join(dir, 'apps/web/src/i18n/x.ts')).bn, {});
  });

  test('legal, consent and payment wording is refused even when the draft note declares a sign-off; Bengali digits pass', () => {
    const legal = 'This copy must be kept for a legal requirement.';
    const consent = 'Withdraw consent for this copy.';
    const paid = 'This copy is kept while a payment is open.';
    const dir = keyRoot({
      'x.legal': legal,
      'x.consent': consent,
      'x.paid': paid,
      'x.digits': 'It stays for 30 days.',
    });
    const filled = run(
      dir,
      drafts([
        ['x.legal', legal, 'একটি আইনি প্রয়োজনে এই কপিটি রেখে দিতে হবে।', SIGNOFF_NOTE],
        ['x.consent', consent, 'এই কপির জন্য সম্মতি প্রত্যাহার করুন।', SIGNOFF_NOTE],
        ['x.paid', paid, 'একটি পেমেন্ট চালু থাকা পর্যন্ত এই কপিটি রাখা থাকবে।', SIGNOFF_NOTE],
        ['x.digits', 'It stays for 30 days.', 'এটি ৩০ দিন থাকে।'],
      ]),
    );
    assert.deepEqual(filled, ['x.digits']);
  });

  test('placeholder or edge-space mismatch stays English', () => {
    const dir = keyRoot({ 'x.name': 'Kept for {name}.', 'x.edge': ' (kept)' });
    const filled = run(
      dir,
      drafts([
        ['x.name', 'Kept for {name}.', 'রাখা আছে।'],
        ['x.edge', ' (kept)', '(রাখা আছে)'],
      ]),
    );
    assert.deepEqual(filled, []);
  });

  test('a register group always wins, and a release of named groups or a key prefix fills nothing else', () => {
    const dir = keyRoot({ 'x.kept': KEPT, 'x.terms': 'Terms of use' }, { 'x.terms': 'SG-A' });
    const d = drafts([
      ['x.kept', KEPT, KEPT_BN],
      ['x.terms', 'Terms of use', 'অন্য'],
    ]);
    assert.deepEqual(run(dir, d, { groups: new Set(['SG-A']), dryRun: true }), ['x.terms']);
    assert.deepEqual(run(dir, d, { keyPrefix: 'x.kep', dryRun: true }), ['x.kept']);
    run(dir, d);
    assert.equal(readCatalog(path.join(dir, 'apps/web/src/i18n/x.ts')).bn['x.terms'], BN);
  });

  test('build-register.mjs takes its queue words from review-queue.mjs, as the key drafts do', () => {
    const src = fs.readFileSync(
      path.join(import.meta.dirname, '../../docs/localization/tools/build-register.mjs'),
      'utf8',
    );
    assert.match(
      src,
      /import \{ COMMERCIAL_RE, LEGAL_RE, OFFICIAL_RE \} from '\.\/review-queue\.mjs';/,
    );
    assert.doesNotMatch(src, /const (LEGAL|COMMERCIAL|OFFICIAL)_RE\s*=/);
  });
});

describe('refillBengali: plural messages and renamed placeholders from a draft written for the key', () => {
  const PLURAL = '{count, plural, one {# request waiting} other {# requests waiting}}';
  const PLURAL_BN = '{count, plural, one {#টি অনুরোধ অপেক্ষায়} other {#টি অনুরোধ অপেক্ষায়}}';
  const OF = 'Showing {length} of {length2}.';
  const OF_BN = '{length2}টির মধ্যে {length}টি দেখানো হচ্ছে।';
  const pluralReg = new Register({
    registerCsv: [
      'semantic_group,review_queue,english,bn_BD_draft,automated_checks',
      'SG-P,ORDINARY_UI,{count} request{choice} waiting,{count}টি অনুরোধ অপেক্ষায়,PASS',
      'SG-N,ORDINARY_UI,Showing {length} of {length}.,{length}টির মধ্যে {length}টি দেখানো হচ্ছে।,PASS',
      'SG-H,OFFICIAL_VISA_REQUIREMENT,{count} fee{choice} due,{count}টি ফি বাকি,PASS',
      'SG-F,ORDINARY_UI,{count} file{choice} held,{count}টি ডকুমেন্ট,CASE_UPLOAD_AMBIGUITY',
      'SG-G,ORDINARY_UI,Close,বন্ধ করুন,PASS',
      '',
    ].join('\n'),
  });
  function mixedRoot(en, sources) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refill-plural-'));
    fs.mkdirSync(path.join(dir, 'apps/web/src/i18n'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'apps/web/src/i18n/x.ts'), renderCatalog('x', en, {}));
    fs.writeFileSync(path.join(dir, 'apps/web/src/i18n/x.sources.json'), renderSources(sources));
    return dir;
  }
  const drafts = (rows) => new Map(rows.map(([k, en, bn, note = '']) => [k, { en, bn, note }]));
  const run = (dir, keyDrafts, extra = {}) =>
    refillBengali({ root: dir, register: pluralReg, keyDrafts, ...extra })[0].filled;

  test('a key with no group takes a plural draft whose variables and nesting match the English', () => {
    const dir = mixedRoot({ 'x.waiting': PLURAL }, { 'x.waiting': null });
    assert.deepEqual(run(dir, drafts([['x.waiting', PLURAL, PLURAL_BN]])), ['x.waiting']);
    assert.equal(readCatalog(path.join(dir, 'apps/web/src/i18n/x.ts')).bn['x.waiting'], PLURAL_BN);
  });

  test('a plural draft with another variable, a missing other branch, a flattened plural or an English word stays English', () => {
    const en = { 'x.a': PLURAL, 'x.b': PLURAL, 'x.c': PLURAL, 'x.d': PLURAL };
    const dir = mixedRoot(en, { 'x.a': null, 'x.b': null, 'x.c': null, 'x.d': null });
    const rows = drafts([
      ['x.a', PLURAL, '{total, plural, one {#টি অনুরোধ অপেক্ষায়} other {#টি অনুরোধ অপেক্ষায়}}'],
      ['x.b', PLURAL, '{count, plural, one {#টি অনুরোধ অপেক্ষায়}}'],
      ['x.c', PLURAL, '{count}টি অনুরোধ অপেক্ষায়'],
      ['x.d', PLURAL, '{count, plural, one {# request অপেক্ষায়} other {#টি অনুরোধ অপেক্ষায়}}'],
    ]);
    assert.deepEqual(run(dir, rows), []);
  });

  test('a passing group that cannot fit the key (plural switch, other placeholder names) falls back to the key draft', () => {
    const dir = mixedRoot(
      { 'x.waiting': PLURAL, 'x.of': OF },
      { 'x.waiting': 'SG-P', 'x.of': 'SG-N' },
    );
    // Without a draft for the key the group still fills nothing.
    assert.deepEqual(run(dir, drafts([])), []);
    const rows = drafts([
      ['x.waiting', PLURAL, PLURAL_BN],
      ['x.of', OF, OF_BN],
    ]);
    assert.deepEqual(run(dir, rows), ['x.of', 'x.waiting']);
    const bn = readCatalog(path.join(dir, 'apps/web/src/i18n/x.ts')).bn;
    assert.equal(bn['x.of'], OF_BN);
    assert.equal(bn['x.waiting'], PLURAL_BN);
  });

  test('a held, unreleased or failing group never falls back to a key draft, and neither does a release of named groups', () => {
    const HELD = [...HOLDBACK.keys()][0];
    const due = '{count, plural, one {# fee due} other {# fees due}}';
    const heldFile = '{count, plural, one {# file held} other {# files held}}';
    const en = { 'x.official': due, 'x.failing': heldFile, 'x.held': PLURAL, 'x.waiting': PLURAL };
    const dir = mixedRoot(en, {
      'x.official': 'SG-H',
      'x.failing': 'SG-F',
      'x.held': HELD,
      'x.waiting': 'SG-P',
    });
    const rows = drafts([
      ['x.official', due, '{count, plural, one {#টি ফি বাকি} other {#টি ফি বাকি}}'],
      ['x.failing', heldFile, '{count, plural, one {#টি ডকুমেন্ট} other {#টি ডকুমেন্ট}}'],
      ['x.held', PLURAL, PLURAL_BN],
      ['x.waiting', PLURAL, PLURAL_BN],
    ]);
    assert.deepEqual(run(dir, rows, { groups: new Set(['SG-P']) }), []);
    assert.deepEqual(run(dir, rows), ['x.waiting']);
  });

  test('a group that simply fills is never replaced by a key draft', () => {
    const dir = mixedRoot({ 'x.close': 'Close' }, { 'x.close': 'SG-G' });
    assert.deepEqual(run(dir, drafts([['x.close', 'Close', 'বন্ধ']])), ['x.close']);
    assert.equal(readCatalog(path.join(dir, 'apps/web/src/i18n/x.ts')).bn['x.close'], 'বন্ধ করুন');
  });
});

describe('refillBengali keyPrefix', () => {
  test('an empty prefix is refused, never read as every key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refill-prefix-'));
    assert.throws(() => refillBengali({ root: dir, register: reg, keyPrefix: '' }), /non-empty/);
    assert.throws(() => refillBengali({ root: dir, register: reg, keyPrefix: ' ' }), /non-empty/);
  });
});
