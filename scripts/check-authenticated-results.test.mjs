import assert from 'node:assert/strict';
import test from 'node:test';
import { requireExecutedJourneys } from './check-authenticated-results.mjs';
test('only executed passing checks count as evidence', () => {
  const stats = { expected: 10, unexpected: 0, skipped: 0, flaky: 0 };
  assert.equal(requireExecutedJourneys({ stats }), 10);
  for (const patch of [{ expected: 0 }, { skipped: 1 }, { unexpected: 1 }, { flaky: 1 }])
    assert.throws(() => requireExecutedJourneys({ stats: { ...stats, ...patch } }));
  assert.throws(() => requireExecutedJourneys({}));
});
