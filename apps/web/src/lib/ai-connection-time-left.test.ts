import { describe, expect, it } from 'vitest';
import {
  AI_ENDING_SOON_MAX_MS,
  aiConnectionTimeLeft,
  aiEndingSoonWindowMs,
  displayTimeZone,
  formatDayIn,
  formatMomentIn,
} from './ai-connection-time-left';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Built from a fixed clock, never close to the real today.
const NOW = new Date(Date.UTC(2030, 0, 15, 12, 0));
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe('the time an AI connection has left', () => {
  it('has no end while it works until turned off', () => {
    expect(aiConnectionTimeLeft({ start: at(-DAY), end: null, now: NOW })).toEqual({
      state: 'open',
      fraction: 1,
      msLeft: null,
      daysLeft: null,
      hoursLeft: null,
    });
  });

  it('counts days and the share left of a 30 day connection', () => {
    const left = aiConnectionTimeLeft({
      start: at(-DAY),
      end: at(29 * DAY),
      now: NOW,
      timeZone: 'UTC',
    });
    expect(left.state).toBe('running');
    expect(left.daysLeft).toBe(29);
    expect(left.hoursLeft).toBeNull();
    expect(left.fraction).toBeCloseTo(29 / 30, 5);
  });

  it('is ending soon within a quarter of its length, never more than seven days', () => {
    expect(aiEndingSoonWindowMs(HOUR)).toBe(HOUR / 4);
    expect(aiEndingSoonWindowMs(DAY)).toBe(6 * HOUR);
    expect(aiEndingSoonWindowMs(7 * DAY)).toBe(42 * HOUR);
    expect(aiEndingSoonWindowMs(30 * DAY)).toBe(AI_ENDING_SOON_MAX_MS);
    // 24 hours, 7 left: running; 5 left: ending soon.
    expect(aiConnectionTimeLeft({ start: at(-17 * HOUR), end: at(7 * HOUR), now: NOW }).state).toBe(
      'running',
    );
    const soon = aiConnectionTimeLeft({ start: at(-19 * HOUR), end: at(5 * HOUR), now: NOW });
    expect(soon.state).toBe('ending_soon');
    expect(soon.hoursLeft).toBe(5);
    // 30 days with 8 left: running; with 6 left: ending soon.
    expect(aiConnectionTimeLeft({ start: at(-22 * DAY), end: at(8 * DAY), now: NOW }).state).toBe(
      'running',
    );
    expect(aiConnectionTimeLeft({ start: at(-24 * DAY), end: at(6 * DAY), now: NOW }).state).toBe(
      'ending_soon',
    );
  });

  it('has ended once the end passes, or once the services say it is not live', () => {
    expect(aiConnectionTimeLeft({ start: at(-DAY), end: at(-1), now: NOW }).state).toBe('ended');
    expect(aiConnectionTimeLeft({ start: at(-DAY), end: NOW, now: NOW }).state).toBe('ended');
    const off = aiConnectionTimeLeft({ start: at(-DAY), end: at(9 * DAY), now: NOW, live: false });
    expect(off).toMatchObject({ state: 'ended', fraction: 0, msLeft: 0 });
  });

  it('counts calendar days in the person time zone, so an end tonight is today', () => {
    // 12:00 UTC now; the end is 20:00 UTC, which is already tomorrow (02:00) in Dhaka.
    const end = at(8 * HOUR);
    const start = at(-30 * DAY);
    expect(aiConnectionTimeLeft({ start, end, now: NOW, timeZone: 'UTC' }).daysLeft).toBe(0);
    expect(aiConnectionTimeLeft({ start, end, now: NOW, timeZone: 'Asia/Dhaka' }).daysLeft).toBe(1);
    // ...and in Los Angeles both moments fall on the same day.
    expect(
      aiConnectionTimeLeft({ start, end, now: NOW, timeZone: 'America/Los_Angeles' }).daysLeft,
    ).toBe(0);
  });

  it('falls back to UTC only when the zone is unknown', () => {
    expect(displayTimeZone('Asia/Dhaka')).toBe('Asia/Dhaka');
    expect(displayTimeZone('Not/AZone')).toBe('UTC');
    expect(displayTimeZone(null)).toBe('UTC');
    const end = at(8 * HOUR);
    expect(
      aiConnectionTimeLeft({ start: at(-DAY), end, now: NOW, timeZone: 'Not/AZone' }).daysLeft,
    ).toBe(0);
  });

  it('writes moments and days in the person zone', () => {
    const end = at(8 * HOUR);
    expect(formatMomentIn(end, 'Asia/Dhaka')).toBe('16 Jan 2030, 02:00');
    expect(formatMomentIn(end, 'UTC')).toBe('15 Jan 2030, 20:00');
    expect(formatDayIn(end, 'Asia/Dhaka')).toBe('16 Jan 2030');
    expect(formatDayIn(end, 'America/Los_Angeles')).toBe('15 Jan 2030');
  });
});
