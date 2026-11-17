import type { Readiness } from '@visastack/services';
import { describe, expect, it, vi } from 'vitest';
import { renderServer } from '../../../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => 'en' }));

import {
  CasePreparationSummary,
  segmentItemsFromResults as itemsFromResults,
} from '../../../../components/case-preparation-summary';

type Row = Readiness['requirementResults'][number];

const row = (id: string, state: Row['state'], extra: Partial<Row> = {}): Row => ({
  packRequirementId: id,
  kind: 'DOCUMENT',
  key: 'passport',
  optional: false,
  state,
  ...extra,
});

const make = (rows: Row[], satisfied: number, required: number): Readiness => ({
  total: rows.length,
  requiredCount: required,
  satisfiedRequired: satisfied,
  missing: [],
  ready: false,
  overallState: 'NEEDS_ACTION',
  requirementResults: rows,
});

const render = (readiness: Readiness) =>
  renderServer(<CasePreparationSummary readiness={readiness} />);

describe('case readiness segment ring', () => {
  it('draws one segment per required item and fills only the ready ones', async () => {
    const html = await render(
      make(
        [
          row('a', 'SATISFIED', { key: 'passport' }),
          row('b', 'CRITICAL_GAP', { key: 'bank_statement' }),
          row('c', 'UNVERIFIED', { key: 'photo' }),
        ],
        1,
        3,
      ),
    );
    expect(html.match(/readiness-seg-on/g)).toHaveLength(1);
    expect(html.match(/readiness-seg-off/g)).toHaveLength(2);
    expect(html).toContain('aria-label="1 of 3 items ready"');
    // The count stays the visible numeral, and the explain fold is still there.
    expect(html).toContain('1 of 3');
    expect(html).toContain('How This Is Counted');
  });

  it('names each item in the legend in words, Ready or Still Needed', async () => {
    const html = await render(
      make([row('a', 'SATISFIED', { key: 'passport' }), row('b', 'CRITICAL_GAP')], 1, 2),
    );
    expect(html).toContain('readiness-legend');
    expect(html.match(/data-ready="yes"/g)).toHaveLength(1);
    expect(html.match(/data-ready="no"/g)).toHaveLength(1);
    expect(html).toContain('Ready');
    expect(html).toContain('Still Needed');
  });

  it('puts the legend at Browse level and says the ring is not an approval', async () => {
    const html = await render(make([row('a', 'SATISFIED'), row('b', 'CRITICAL_GAP')], 1, 2));
    expect(html).toContain('What This Ring Counts');
    expect(html).toContain('not whether a visa will be approved');
    // The legend is a Browse block, so Glance shows the ring alone (and the 30-word rule holds).
    expect(html).toMatch(/<ul class="readiness-legend" data-level="browse">/);
  });

  it('counts a group of alternatives as one segment and skips a covered alternative', () => {
    const items = itemsFromResults([
      row('a1', 'SATISFIED', { groupKey: 'funds' }),
      row('a2', 'ATTENTION', { groupKey: 'funds', optional: true, coveredByAlternative: true }),
      row('b1', 'CRITICAL_GAP', { groupKey: 'id' }),
      row('b2', 'UNVERIFIED', { groupKey: 'id' }),
      row('c', 'CRITICAL_GAP', { optional: true }),
    ]);
    expect(items.map((i) => i.ready)).toEqual([true, false]);
  });

  it('keeps the plain empty state when no item is required', async () => {
    const html = await render(make([row('a', 'ATTENTION', { optional: true })], 0, 0));
    expect(html).toContain('No required items');
    expect(html).not.toContain('readiness-seg');
    expect(html).not.toContain('100%');
  });

  it('drops the legend, not the count, when the items disagree with the count', async () => {
    const html = await render(make([row('a', 'SATISFIED')], 1, 3));
    expect(html.match(/readiness-seg-on/g)).toHaveLength(1);
    expect(html.match(/readiness-seg-off/g)).toHaveLength(2);
    expect(html).not.toContain('readiness-legend-row');
  });

  it('uses plain Title Case names, never "mission", and no em dash', async () => {
    const html = await render(make([row('a', 'SATISFIED'), row('b', 'CRITICAL_GAP')], 1, 2));
    expect(html).not.toMatch(/\bmission\b/i);
    expect(html).not.toContain(String.fromCodePoint(0x2014));
  });
});
