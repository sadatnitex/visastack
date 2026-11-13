import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { REFILL_REVIEW_HOLDS } from './refill-holds.mjs';
import { KEY_HOLDBACK, refillBengali } from './refill.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEFTOVERS = 'docs/localization/data/REFILL_LEFTOVERS.md';

/**
 * The keys of every "Left English at review" table in REFILL_LEFTOVERS.md: one key per row, in
 * the second column, in backticks.
 * @param {string} text
 */
function reviewTableKeys(text) {
  const keys = [];
  for (const section of text.split(/^## /m)) {
    if (!section.startsWith('Left English at review')) continue;
    for (const line of section.split('\n')) {
      if (!line.startsWith('| ') || line.startsWith('| Surface') || line.startsWith('| ---'))
        continue;
      const key = line.split(' | ')[1]?.match(/^`([^`]+)`$/)?.[1];
      assert.ok(key, `a review table row with no key in backticks: ${line.slice(0, 80)}`);
      keys.push(key);
    }
  }
  return keys;
}

describe('keys left English at review stay held', () => {
  const listed = reviewTableKeys(fs.readFileSync(path.join(ROOT, LEFTOVERS), 'utf8'));

  test('every listed key is held, and every held review key is listed (one key per row, no repeats)', () => {
    assert.ok(listed.length > 0, 'the review tables list no key');
    assert.equal(new Set(listed).size, listed.length, 'a key is listed twice');
    const held = REFILL_REVIEW_HOLDS.map(([key]) => key);
    assert.deepEqual([...held].sort(), [...listed].sort());
    for (const key of listed) assert.ok(KEY_HOLDBACK.has(key), `${key} is not in KEY_HOLDBACK`);
    for (const [key, reason] of REFILL_REVIEW_HOLDS)
      assert.ok(reason.replace(/^[^:]*:/, '').trim().length > 10, `${key} has no reason`);
  });

  test('a plain --refill-bn dry run on this tree fills none of the listed keys', () => {
    const filled = refillBengali({ root: ROOT, dryRun: true }).flatMap((r) => r.filled);
    const listedSet = new Set(listed);
    assert.deepEqual(
      filled.filter((key) => listedSet.has(key)),
      [],
    );
  });
});
