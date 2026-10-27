import { describe, expect, it } from 'vitest';
import { isMissingRelationError } from './missing-relation';

describe('isMissingRelationError', () => {
  it('recognises the Postgres codes, directly or wrapped by the driver', () => {
    expect(isMissingRelationError({ code: '42P01' })).toBe(true);
    expect(isMissingRelationError({ code: '42703' })).toBe(true);
    expect(isMissingRelationError({ message: 'query failed', cause: { code: '42P01' } })).toBe(
      true,
    );
  });

  it("recognises Postgres's wording when no code survived", () => {
    expect(isMissingRelationError(new Error('relation "channel_identities" does not exist'))).toBe(
      true,
    );
    expect(isMissingRelationError(new Error('column "opt_changed_at" does not exist'))).toBe(true);
    expect(
      isMissingRelationError({
        message: 'Failed query',
        cause: new Error('relation "x" does not exist'),
      }),
    ).toBe(true);
  });

  it('does not mistake other failures for a missing table', () => {
    expect(
      isMissingRelationError(new Error('duplicate key value violates unique constraint')),
    ).toBe(false);
    expect(isMissingRelationError(new Error('the file does not exist'))).toBe(false);
    expect(isMissingRelationError(null)).toBe(false);
    expect(isMissingRelationError('relation x does not exist')).toBe(false);
  });

  it('stays fast on a long crafted message', () => {
    const crafted = `${'column '.repeat(200_000)}x`;
    const started = performance.now();
    expect(isMissingRelationError(new Error(crafted))).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
