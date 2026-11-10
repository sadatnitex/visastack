import { describe, expect, it } from 'vitest';
import { buildMissingForCase } from './missing-for-case';
import { buildRequestPicker, requestPickerIndex } from './request-picker';
import { preticked } from './request-picker-types';

const index = requestPickerIndex(buildRequestPicker());
const missing = (
  entry: Partial<{
    kind: 'FIELD' | 'DOCUMENT';
    key: string;
    optional: boolean;
    reason: 'not_provided' | 'unresolved_conflict' | 'stale_evidence';
    alternatives: { kind: 'FIELD' | 'DOCUMENT'; key: string }[];
  }>,
) => ({
  kind: 'DOCUMENT' as const,
  key: 'NID',
  optional: false,
  reason: 'not_provided' as const,
  ...entry,
});

describe('Missing for This Case', () => {
  it('is absent when the case has no checklist or no gaps', () => {
    expect(buildMissingForCase(null, [], index)).toBeNull();
    expect(buildMissingForCase({ missing: [] }, [], index)).toBeNull();
  });

  it('ticks only a required item that was never provided and not already asked', () => {
    const built = buildMissingForCase(
      {
        missing: [
          missing({ key: 'NID' }),
          missing({ key: 'PHOTO', optional: true }),
          missing({ key: 'BANK_STATEMENT', reason: 'stale_evidence' }),
          missing({ kind: 'FIELD', key: 'passport_number', reason: 'unresolved_conflict' }),
          missing({ key: 'PASSPORT' }),
        ],
      },
      [{ kind: 'DOCUMENT', status: 'OPEN', fieldKey: null, docType: 'passport' }],
      index,
    );
    expect(built?.rows.map((r) => [r.id, r.state])).toEqual([
      ['DOCUMENT:NID', 'ask'],
      ['DOCUMENT:PHOTO', 'optional'],
      ['DOCUMENT:BANK_STATEMENT', 'stale'],
      ['FIELD:passport_number', 'conflict'],
      ['DOCUMENT:PASSPORT', 'asked'],
    ]);
    expect(preticked(built)).toEqual(['DOCUMENT:NID']);
  });

  it('counts a request that came back for a replacement as still waiting, and a finished one as not', () => {
    const built = buildMissingForCase(
      { missing: [missing({ key: 'NID' }), missing({ key: 'PHOTO' })] },
      [
        { kind: 'DOCUMENT', status: 'NEEDS_REPLACEMENT', fieldKey: null, docType: 'NID' },
        { kind: 'DOCUMENT', status: 'ACCEPTED', fieldKey: null, docType: 'PHOTO' },
      ],
      index,
    );
    expect(built?.rows.map((r) => r.state)).toEqual(['asked', 'ask']);
  });

  it('never ticks a group of alternatives, and lists each member the agency can tick', () => {
    const built = buildMissingForCase(
      {
        missing: [
          missing({
            alternatives: [
              { kind: 'DOCUMENT', key: 'NID' },
              { kind: 'DOCUMENT', key: 'PASSPORT' },
            ],
          }),
        ],
      },
      [],
      index,
    );
    expect(built?.rows).toEqual([]);
    expect(built?.anyOf).toHaveLength(1);
    expect(built?.anyOf[0]?.map((r) => [r.id, r.state])).toEqual([
      ['DOCUMENT:NID', 'alternative'],
      ['DOCUMENT:PASSPORT', 'alternative'],
    ]);
    expect(preticked(built)).toEqual([]);
  });

  it('shows a checklist name the list does not have as text that can never be sent', () => {
    const built = buildMissingForCase(
      {
        missing: [
          missing({ key: 'Village Elder Letter' }),
          missing({ kind: 'FIELD', key: 'favourite_colour' }),
        ],
      },
      [],
      index,
    );
    expect(built?.rows.map((r) => [r.id, r.state])).toEqual([
      ['', 'unlisted'],
      ['', 'unlisted'],
    ]);
    expect(preticked(built)).toEqual([]);
  });

  it('lists an item once when two checklist lines name it', () => {
    const built = buildMissingForCase(
      { missing: [missing({ key: 'BANK_STATEMENT' }), missing({ key: 'BANK_STATEMENT' })] },
      [],
      index,
    );
    expect(built?.rows.map((r) => r.id)).toEqual(['DOCUMENT:BANK_STATEMENT']);
    expect(preticked(built)).toEqual(['DOCUMENT:BANK_STATEMENT']);
  });

  it('finds a document by any name the catalogue knows it by', () => {
    const built = buildMissingForCase({ missing: [missing({ key: 'Pay Slip' })] }, [], index);
    expect(built?.rows[0]).toMatchObject({ id: 'DOCUMENT:SALARY_SLIP', state: 'ask' });
  });
});
