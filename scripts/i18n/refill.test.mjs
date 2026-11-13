import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { readCatalog, renderCatalog, renderSources } from './catalog.mjs';
import { KEY_HOLDBACK, OWNER_BLANKET_SIGNOFF, loadKeyDrafts, refillBengali } from './refill.mjs';
import { Register } from './register.mjs';

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
        [held, KEPT, KEPT_BN, OWNER_BLANKET_SIGNOFF],
      ]),
    );
    assert.deepEqual(filled, []);
    assert.deepEqual(readCatalog(path.join(dir, 'apps/web/src/i18n/x.ts')).bn, {});
  });

  test('legal and payment wording ships with the owner blanket sign-off recorded on the draft, Bengali digits pass', () => {
    const legal = 'This copy must be kept for a legal requirement.';
    const dir = keyRoot({ 'x.legal': legal, 'x.digits': 'It stays for 30 days.' });
    const filled = run(
      dir,
      drafts([
        [
          'x.legal',
          legal,
          'একটি আইনি প্রয়োজনে এই কপিটি রেখে দিতে হবে।',
          `Legal wording: ${OWNER_BLANKET_SIGNOFF} (not reviewed)`,
        ],
        ['x.digits', 'It stays for 30 days.', 'এটি ৩০ দিন থাকে।'],
      ]),
    );
    assert.deepEqual(filled, ['x.digits', 'x.legal']);
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
