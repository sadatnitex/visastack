import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  REMOVAL_STATUS_LABELS,
  RemovalRecordList,
  type RemovalRecordRow,
  removalRecordDetail,
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
  it('decides "this year" from the given time, not the clock', () => {
    const next = new Date('2027-01-02T09:00:00Z');
    expect(removalRecordSentence(row({ verifiedGoneAt: new Date(2026, 10, 3, 12) }), next)).toBe(
      'Removed on 3 Nov 2026: Passport D-7K2Q9M.',
    );
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

describe('who asked and when', () => {
  const asked = '2026-11-03T14:05:00Z';
  it('says the account and the moment in UTC, and nothing about the person', () => {
    expect(removalRecordDetail(row({ requestedAt: asked, requestedBy: 'OWNER_ACCOUNT' }))).toBe(
      'Asked from your account on 3 Nov 2026, 14:05 UTC.',
    );
    expect(removalRecordDetail(row({ requestedAt: asked, requestedBy: 'ANOTHER_ACCOUNT' }))).toBe(
      'Asked from another account on 3 Nov 2026, 14:05 UTC.',
    );
    expect(removalRecordDetail(row({ requestedAt: asked, requestedBy: 'NOT_RECORDED' }))).toBe(
      'Recorded on 3 Nov 2026, 14:05 UTC.',
    );
  });
  it('adds support approval only when support approved it', () => {
    expect(
      removalRecordDetail(
        row({ requestedAt: asked, requestedBy: 'OWNER_ACCOUNT', approvedBy: 'SUPPORT' }),
      ),
    ).toBe('Asked from your account on 3 Nov 2026, 14:05 UTC. Approved by VisaStack support.');
  });
  it('shows no detail line for a row that carries none, and renders it under the sentence', () => {
    expect(removalRecordDetail(row())).toBeNull();
    const html = renderToStaticMarkup(
      <RemovalRecordList
        records={[row({ requestedAt: asked, requestedBy: 'OWNER_ACCOUNT' })]}
        now={NOW}
      />,
    );
    expect(html).toContain('Asked from your account on 3 Nov 2026, 14:05 UTC.');
    expect(renderToStaticMarkup(<RemovalRecordList records={[row()]} now={NOW} />)).not.toContain(
      'Asked from',
    );
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
