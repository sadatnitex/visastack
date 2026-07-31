import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './db';

/**
 * Regression coverage for a real bug found via a genuine concurrent-race
 * test (accounts.test.ts): drizzle wraps every driver error in a
 * `DrizzleQueryError` with the real error (the one carrying `.code`)
 * attached as `.cause` — checking only the top-level error never matches,
 * silently turning every unique-violation race-recovery path in the
 * codebase into an unhandled exception instead of the intended fallback.
 */
describe('isUniqueViolation', () => {
  it('matches a raw driver error with code 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('matches a drizzle-wrapped error (the real error nested as .cause)', () => {
    const driverError = Object.assign(new Error('duplicate key value'), { code: '23505' });
    const wrapped = new Error('Failed query: insert into ...', { cause: driverError });
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it('matches through a couple of nested wrapping layers', () => {
    const driverError = Object.assign(new Error('duplicate key value'), { code: '23505' });
    const onceWrapped = new Error('wrapped once', { cause: driverError });
    const twiceWrapped = new Error('wrapped twice', { cause: onceWrapped });
    expect(isUniqueViolation(twiceWrapped)).toBe(true);
  });

  it('does not match a different SQLSTATE', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false); // foreign_key_violation
    const wrapped = new Error('Failed query', {
      cause: Object.assign(new Error('fk'), { code: '23503' }),
    });
    expect(isUniqueViolation(wrapped)).toBe(false);
  });

  it('does not match a plain error with no code anywhere in the chain', () => {
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(new Error('outer', { cause: new Error('inner') }))).toBe(false);
  });

  it('does not match non-error values', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isUniqueViolation(23505)).toBe(false);
  });
});
