import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  REMOVAL_STATUS_LABELS,
  RemovalRecordList,
  type RemovalRecordRow,
  removalRecordSentence,
} from './removal-record-list';

const NOW = new Date('2026-11-01T09:00:00Z');
const row = (overrides: Partial<RemovalRecordRow> = {}): RemovalRecordRow => ({
  id: 'r1',
  subjectKind: 'DOCUMENT',
  subjectCode: 'D-7K2Q9M',
  documentKind: 'PASSPORT',
  scheduledFor: null,
  verifiedGoneAt: null,
  requestedAt: '2026-10-01T09:00:00Z',
  status: 'REMOVED',
  effects: {},
  ...overrides,
});

describe('removal record sentences', () => {
  it('says what went, when, and how many cases it was used in', () => {
    expect(
      removalRecordSentence(
        row({
          verifiedGoneAt: new Date(NOW.getFullYear(), 10, 3, 12),
          effects: { casesSwitched: ['C-7K2Q9M'], casesFlagged: ['C-AAAAAA', 'C-7K2Q9M'] },
        }),
        NOW,
      ),
    ).toBe('Removed on 3 Nov: Passport D-7K2Q9M. Used in 2 cases.');
  });
  it('counts down a scheduled removal and names every other state in plain words', () => {
    expect(
      removalRecordSentence(
        row({ status: 'SCHEDULED', scheduledFor: new Date(NOW.getTime() + 12 * 86_400_000) }),
        NOW,
      ),
    ).toBe('Removed in 12 Days: Passport D-7K2Q9M.');
    expect(removalRecordSentence(row({ status: 'REMOVING' }), NOW)).toBe(
      'Removing Securely: Passport D-7K2Q9M.',
    );
    expect(removalRecordSentence(row({ status: 'BLOCKED', documentKind: null }), NOW)).toBe(
      'Kept (Legal Requirement): Document D-7K2Q9M.',
    );
    expect(
      removalRecordSentence(
        row({ status: 'RESTORED', subjectKind: 'TRAVELLER', subjectCode: 'P-7K2Q9M' }),
        NOW,
      ),
    ).toBe('Restored: Traveller record P-7K2Q9M.');
    expect(Object.values(REMOVAL_STATUS_LABELS)).toEqual([
      'Scheduled',
      'Restored',
      'Removing Securely',
      'Removed',
      'Kept (Legal Requirement)',
    ]);
  });
});

describe('RemovalRecordList', () => {
  it('shows ten records, then the rest behind Show More', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ id: `r${i}` }));
    const html = renderToStaticMarkup(<RemovalRecordList records={rows} now={NOW} />);
    expect(html.split('class="lc-record"').length - 1).toBe(12);
    expect(html).toContain('<summary>Show More (2)</summary>');
  });
  it('says so when nothing has been removed', () => {
    expect(renderToStaticMarkup(<RemovalRecordList records={[]} />)).toContain(
      'Nothing has been removed from this record.',
    );
  });
});
