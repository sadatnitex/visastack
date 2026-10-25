import { describe, expect, it } from 'vitest';
import { documentName, readinessLine, timeUntilExpiry } from './insights-wording';

describe('insights wording', () => {
  it('says how long until a document expires in the words a person would use', () => {
    expect(
      [-400, -45, -1, 0, 1, 2, 60, 61, 90, 400, 729, 730, 3650].map((days) =>
        timeUntilExpiry(days),
      ),
    ).toEqual([
      'Expired about 13 months ago',
      'Expired 45 days ago',
      'Expired yesterday',
      'Expires today',
      'Expires tomorrow',
      'Expires in 2 days',
      'Expires in 60 days',
      'Expires in about 2 months',
      'Expires in about 3 months',
      'Expires in about 13 months',
      'Expires in about 24 months',
      'Expires in about 2 years',
      'Expires in about 10 years',
    ]);
  });

  it('says a document that ran out earlier today has expired', () => {
    expect(timeUntilExpiry(0, true)).toBe('Expired today');
    expect(timeUntilExpiry(0, false)).toBe('Expires today');
  });

  it('names a document by its kind, numbered only when there are several', () => {
    const ref = { id: 'd', kind: 'PASSPORT', restricted: true, ordinal: 1, ofKind: 1 };
    expect(documentName(ref)).toBe('Passport');
    expect(documentName({ ...ref, ordinal: 2, ofKind: 3 })).toBe('Passport 2 of 3');
    expect(documentName({ ...ref, kind: null })).toBe('Document Not Yet Sorted');
  });

  it('describes readiness as a count, or as the next step when there is nothing to count', () => {
    expect(readinessLine('NEEDS_ACTION', 1, 3)).toBe('1 of 3 required items ready');
    expect(readinessLine('READY_FOR_APPLICANT_REVIEW', 1, 1)).toBe('1 of 1 required item ready');
    expect(readinessLine('NO_CHECKLIST', 0, 0)).toBe(
      'Choose a visa route on this case to see what it needs.',
    );
  });
});
