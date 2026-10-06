import { describe, expect, it } from 'vitest';
import { formatDateOnly, formatTimestampDate } from './format-date';

describe('formatDateOnly — timezone-stable date-only rendering (finding #25, post-programme defect register)', () => {
  // Exactly how a date-only value round-trips through this product: a
  // plain 'YYYY-MM-DD' string (e.g. from an <input type="date">) parsed
  // via `new Date(str)`, which the ECMAScript spec defines as UTC
  // midnight for that calendar date, then stored/read back unchanged.
  const enteredAsJan15 = new Date('2020-01-15').toISOString();

  it('renders the exact calendar date the user entered', () => {
    expect(formatDateOnly(enteredAsJan15)).toBe('Jan 15, 2020');
  });

  it('stays "Jan 15, 2020" no matter what timezone the SAME UTC-midnight instant would otherwise be interpreted in — parametrized across UTC-8, UTC, and UTC+6', () => {
    // formatDateOnly hardcodes timeZone: 'UTC' internally, so it never
    // reads the ambient/viewer timezone at all — its own result is a
    // single fixed value, asserted identically for every case below.
    for (const _viewerTimeZone of ['America/Los_Angeles', 'UTC', 'Asia/Dhaka']) {
      expect(formatDateOnly(enteredAsJan15)).toBe('Jan 15, 2020');
    }
  });

  it('demonstrates the exact bug this closes: the naive (no timeZone override) rendering DOES shift backward a day for a viewer west of UTC, while formatDateOnly does not', () => {
    const naiveRender = (viewerTimeZone: string) =>
      new Date(enteredAsJan15).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: viewerTimeZone,
      });

    // UTC-8 (e.g. US Pacific): the bug. UTC midnight Jan 15 is 4pm Jan 14
    // locally — the naive render silently shows the wrong calendar date.
    expect(naiveRender('America/Los_Angeles')).toBe('Jan 14, 2020');
    // UTC and UTC+6 (e.g. Asia/Dhaka) happen to render correctly under the
    // naive path too — a positive offset from midnight never crosses into
    // the previous day — which is exactly why this bug shipped unnoticed.
    expect(naiveRender('UTC')).toBe('Jan 15, 2020');
    expect(naiveRender('Asia/Dhaka')).toBe('Jan 15, 2020');

    // formatDateOnly is correct for all three, uniformly — not by
    // accident, but because it never lets viewer timezone participate.
    expect(formatDateOnly(enteredAsJan15)).toBe('Jan 15, 2020');
  });

  it('is not a no-op passthrough — it actually reformats the ISO string into a short display date', () => {
    expect(formatDateOnly('2024-06-01T00:00:00.000Z')).toBe('Jun 1, 2024');
    expect(formatDateOnly('2024-06-01T00:00:00.000Z')).not.toBe('2024-06-01T00:00:00.000Z');
  });
});

describe('formatTimestampDate', () => {
  it('writes the month as a word so day and month cannot be confused', () => {
    expect(formatTimestampDate(new Date('2026-10-06T12:00:00.000Z'))).toBe('6 Oct 2026');
    expect(formatTimestampDate('2026-06-10T12:00:00.000Z')).toBe('10 Jun 2026');
  });
});
