import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { readCatalog, renderCatalog, renderSources } from './catalog.mjs';
import { refillBengali } from './refill.mjs';
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
