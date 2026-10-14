import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildDestinations, readBatch } from './build-destinations.mjs';

const FOLDER = 'docs/product/master-profile-enrichment/country-intake/batch-001';
const OUT = 'packages/core/src/destinations/batch-001.json';

test('the committed data file matches the three sheets', () => {
  const built = buildDestinations(readBatch(FOLDER));
  const committed = JSON.parse(readFileSync(OUT, 'utf8'));
  assert.deepEqual(committed, built);
});

test('a country with no stated entry status is not marked researched', () => {
  const built = buildDestinations({
    countries:
      'country,iso2,entry_status_for_bangladesh_ordinary_passport,source_url\nAlpha,AA,NOT_FOUND,https://example.org\nBeta,BB,E_VISA,https://example.org\n',
    routes: 'pack_key\n',
    requirements: 'pack_key\n',
  });
  assert.deepEqual(
    built.countries.map((c) => c.researched),
    [false, true],
  );
});
