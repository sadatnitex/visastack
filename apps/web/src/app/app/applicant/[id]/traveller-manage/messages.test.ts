import { TRAVELLER_REFUSALS } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import { outcomeMessage, refusalOutcome, removedInDays } from './messages';

describe('traveller action words', () => {
  it('has plain words for every refusal the services can give', () => {
    for (const message of Object.values(TRAVELLER_REFUSALS)) {
      const outcome = refusalOutcome(message);
      expect(outcome).not.toBe('refused-failed');
      const words = outcomeMessage(outcome);
      expect(words?.ok).toBe(false);
      expect(words?.text).not.toContain(message);
    }
    expect(refusalOutcome('a driver error with details')).toBe('refused-failed');
  });

  it('shows only the outcome words it knows', () => {
    expect(outcomeMessage('archived')?.ok).toBe(true);
    expect(outcomeMessage('removed')?.text).toContain('Recently Deleted');
    for (const value of [
      undefined,
      '',
      'refused-',
      'refused-toString',
      'constructor',
      ['archived'],
    ]) {
      expect(outcomeMessage(value)).toBeNull();
    }
  });

  it('counts the days left in Recently Deleted, never below one', () => {
    const now = new Date('2026-11-01T10:00:00Z');
    expect(removedInDays(new Date('2026-12-01T10:00:00Z'), now)).toBe('Removed in 30 Days');
    expect(removedInDays(new Date('2026-11-01T12:00:00Z'), now)).toBe('Removed in 1 Day');
    expect(removedInDays(new Date('2026-10-31T10:00:00Z'), now)).toBe('Removed in 1 Day');
  });
});
