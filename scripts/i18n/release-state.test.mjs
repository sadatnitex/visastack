import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { derive } from '../../docs/localization/tools/apply-release-state.mjs';
import {
  APPROVED_REVIEW_STATE,
  loadClassification,
} from '../../docs/localization/tools/release-state.mjs';
import { HOLDBACK, parseCsv } from './register.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const cl = loadClassification(ROOT);

describe('owner blanket approval of 2026-11-12', () => {
  test('the committed register and queue files are exactly what the derivation gives', () => {
    for (const [rel, text] of derive(ROOT))
      assert.equal(
        read(rel),
        text,
        `${rel} is out of date: run node docs/localization/tools/apply-release-state.mjs`,
      );
  });

  test('exactly the released groups carry the approval state, and nobody is called reviewed', () => {
    const released = new Set(cl.groups.filter((g) => g.state === 'RELEASED').map((g) => g.group));
    const rows = parseCsv(read('docs/localization/VISASTACK_TRANSLATION_REGISTER.csv'));
    const approved = new Set(
      rows.filter((r) => r.review_state === APPROVED_REVIEW_STATE).map((r) => r.semantic_group),
    );
    assert.deepEqual([...approved].sort(), [...released].sort());
    assert.ok(!rows.some((r) => /^REVIEWED/.test(r.review_state)));
    for (const f of [
      '01-ordinary-ui',
      '02-commercial',
      '03-privacy-consent-legal',
      '04-official-visa-requirements',
    ])
      for (const r of parseCsv(read(`docs/localization/data/review-queues/${f}.csv`)))
        assert.equal(r.reviewed, 'NO', r.semantic_group);
  });

  test('a kept group is in the holdback map, a released group is not', () => {
    const kept = cl.groups.filter((g) => g.state === 'KEPT').map((g) => g.group);
    assert.deepEqual([...HOLDBACK.keys()].sort(), kept.sort());
    for (const g of cl.groups.filter((x) => x.state.startsWith('RELEASED')))
      assert.equal(HOLDBACK.has(g.group), false, g.group);
  });

  test('every group has a reason', () => {
    for (const g of cl.groups) assert.ok(g.reason.length > 5, g.group);
  });
});
