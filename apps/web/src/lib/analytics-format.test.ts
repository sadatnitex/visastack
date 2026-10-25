import { describe, expect, it } from 'vitest';
import { formatDuration, formatMinorUnits, humanizeLabel } from './analytics-format';

describe('humanizeLabel', () => {
  it('turns an event-log token into a Title Case term', () => {
    expect(humanizeLabel('IN_REVIEW')).toBe('In Review');
    expect(humanizeLabel('READY_FOR_APPLICANT_REVIEW')).toBe('Ready for Applicant Review');
    expect(humanizeLabel('BDT')).toBe('Bdt');
    expect(humanizeLabel('')).toBe('');
  });
});

describe('formatDuration', () => {
  it('shows at most two units, largest first', () => {
    expect(formatDuration(30)).toBe('30 s');
    expect(formatDuration(45 * 60)).toBe('45 min');
    expect(formatDuration(3_600)).toBe('1 h');
    expect(formatDuration(3_600 + 5 * 60)).toBe('1 h 5 min');
    expect(formatDuration(2 * 86_400 + 3 * 3_600 + 59)).toBe('2 d 3 h');
    expect(formatDuration(3 * 86_400)).toBe('3 d');
  });

  it('says n/a rather than a misleading zero when there is no data or the value is not sensible', () => {
    expect(formatDuration(null)).toBe('n/a');
    expect(formatDuration(Number.NaN)).toBe('n/a');
    expect(formatDuration(-5)).toBe('n/a');
    expect(formatDuration(0)).toBe('0 s');
  });
});

describe('formatMinorUnits', () => {
  it('divides by the currency own number of minor units, never a fixed 100', () => {
    expect(formatMinorUnits(250_000, 'BDT')).toContain('2,500.00');
    expect(formatMinorUnits(2_500, 'USD')).toBe('$25.00');
    // Yen has no minor unit: 2500 is 2,500 yen, not 25.
    expect(formatMinorUnits(2_500, 'JPY')).toContain('2,500');
    expect(formatMinorUnits(2_500, 'JPY')).not.toContain('25.00');
  });

  it('falls back to the raw figure for something that is not a currency code at all', () => {
    expect(formatMinorUnits(1_234, 'not-a-code')).toBe('1234 not-a-code (minor units)');
  });
});
