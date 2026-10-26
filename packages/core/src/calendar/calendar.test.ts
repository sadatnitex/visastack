import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CALENDAR_KINDS, CALENDAR_KIND_IDS, isCalendarKind } from './kinds';
import {
  CALENDAR_OPTION_FIELDS,
  DEFAULT_CALENDAR_EXPORT_OPTIONS,
  calendarOptionFields,
  parseCalendarExportOptions,
} from './options';
import { CALENDAR_SEQUENCE_EPOCH, calendarSequence } from './sequence';
import { sha256Hex } from './sha256';
import { canonicalTimeZone, utcToWallClock, wallClockToUtc } from './time';
import { calendarUid } from './uid';

describe('the kinds registry', () => {
  it('has one entry per kind, each with a generic Title Case title, timing, length and category', () => {
    expect(CALENDAR_KIND_IDS).toEqual([
      'appointment',
      'task_due',
      'request_due',
      'document_expires',
    ]);
    for (const kind of CALENDAR_KIND_IDS) {
      const entry = CALENDAR_KINDS[kind];
      expect(entry.title).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)*$/);
      expect(entry.title).not.toMatch(/passport|bank|visa|mission|\d/i);
      expect(['all_day', 'timed']).toContain(entry.timing);
      expect(entry.defaultDurationMinutes).toBeGreaterThan(0);
      expect(entry.category.startsWith('VisaStack ')).toBe(true);
    }
    expect(isCalendarKind('task_due')).toBe(true);
    expect(isCalendarKind('toString')).toBe(false);
    expect(isCalendarKind(1)).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('matches the published test vectors and Node, for ASCII and multi-byte text', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    for (const text of [
      'a'.repeat(55),
      'a'.repeat(56),
      'a'.repeat(64),
      'a'.repeat(1000),
      'ব\u{1F30F}',
    ]) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });
});

describe('calendarUid: the permanent scheme', () => {
  const id = '0b6f1c2e-2222-4a8e-9d0c-000000000002';
  it('is the first 32 hex of sha256("visastack:v1:<kind>:<id>") at visastack', () => {
    expect(calendarUid('task_due', id)).toBe(
      `${createHash('sha256').update(`visastack:v1:task_due:${id}`).digest('hex').slice(0, 32)}@visastack`,
    );
    // Pinned: changing the scheme would duplicate every date people have already imported.
    expect(calendarUid('appointment', 'appt-1')).toBe(
      `${createHash('sha256').update('visastack:v1:appointment:appt-1').digest('hex').slice(0, 32)}@visastack`,
    );
  });

  it('is opaque, the same for the same key and different for a different kind or id', () => {
    const uid = calendarUid('task_due', id);
    expect(uid).toMatch(/^[0-9a-f]{32}@visastack$/);
    expect(uid).not.toContain(id.slice(0, 8));
    expect(calendarUid('task_due', id)).toBe(uid);
    expect(calendarUid('request_due', id)).not.toBe(uid);
    expect(calendarUid('task_due', `${id.slice(0, -1)}3`)).not.toBe(uid);
  });
});

describe('calendarSequence', () => {
  it('is whole seconds since 1 Jan 2020 of the last change, never negative, and grows with it', () => {
    expect(CALENDAR_SEQUENCE_EPOCH).toBe(Date.UTC(2020, 0, 1));
    expect(calendarSequence(new Date(CALENDAR_SEQUENCE_EPOCH))).toBe(0);
    expect(calendarSequence(new Date(CALENDAR_SEQUENCE_EPOCH - 5000))).toBe(0);
    expect(calendarSequence('2020-01-01T00:01:00.900Z')).toBe(60);
    expect(calendarSequence('not a date')).toBe(0);
    // Records changed before 2026 still order.
    expect(calendarSequence('2025-06-01T00:00:00Z')).toBeLessThan(
      calendarSequence('2025-06-01T00:00:01Z'),
    );
    expect(calendarSequence('2025-06-01T00:00:00Z')).toBeGreaterThan(0);
    // Under 2^31 for decades.
    expect(calendarSequence(new Date('2088-01-01T00:00:00Z'))).toBeLessThan(2 ** 31);
  });
});

describe('wallClockToUtc: the wall clock the person meant, in their zone', () => {
  it('converts Dhaka (no daylight saving)', () => {
    expect(wallClockToUtc('2026-11-03T09:30:00', 'Asia/Dhaka')).toBe('2026-11-03T03:30:00Z');
    expect(wallClockToUtc('2026-11-03T00:15', 'Asia/Dhaka')).toBe('2026-11-02T18:15:00Z');
  });

  it('converts Los Angeles on both sides of each daylight saving change', () => {
    // Spring forward on 8 Mar 2026 at 02:00.
    expect(wallClockToUtc('2026-03-07T09:00:00', 'America/Los_Angeles')).toBe(
      '2026-03-07T17:00:00Z',
    );
    expect(wallClockToUtc('2026-03-09T09:00:00', 'America/Los_Angeles')).toBe(
      '2026-03-09T16:00:00Z',
    );
    // 02:30 that night never happens: it moves forward past the gap.
    expect(wallClockToUtc('2026-03-08T02:30:00', 'America/Los_Angeles')).toBe(
      '2026-03-08T10:30:00Z',
    );
    // Fall back on 1 Nov 2026 at 02:00.
    expect(wallClockToUtc('2026-10-31T09:00:00', 'America/Los_Angeles')).toBe(
      '2026-10-31T16:00:00Z',
    );
    expect(wallClockToUtc('2026-11-02T09:00:00', 'America/Los_Angeles')).toBe(
      '2026-11-02T17:00:00Z',
    );
    // Hours just after each change, where the offset at the wall-clock guess is still the old one.
    expect(wallClockToUtc('2026-03-08T05:00:00', 'America/Los_Angeles')).toBe(
      '2026-03-08T12:00:00Z',
    );
    expect(wallClockToUtc('2026-11-01T05:00:00', 'America/Los_Angeles')).toBe(
      '2026-11-01T13:00:00Z',
    );
    // 01:30 happens twice: the first one.
    expect(wallClockToUtc('2026-11-01T01:30:00', 'America/Los_Angeles')).toBe(
      '2026-11-01T08:30:00Z',
    );
  });

  it('takes the first occurrence of a repeated hour and lands after a skipped one, east of UTC too', () => {
    // Berlin: clocks go back on 25 Oct 2026 at 03:00 CEST and forward on 29 Mar 2026 at 02:00 CET.
    expect(wallClockToUtc('2026-10-25T02:30:00', 'Europe/Berlin')).toBe('2026-10-25T00:30:00Z');
    expect(wallClockToUtc('2026-03-29T02:30:00', 'Europe/Berlin')).toBe('2026-03-29T01:30:00Z');
    expect(wallClockToUtc('2026-10-24T12:00:00', 'Europe/Berlin')).toBe('2026-10-24T10:00:00Z');
    expect(wallClockToUtc('2026-10-26T12:00:00', 'Europe/Berlin')).toBe('2026-10-26T11:00:00Z');
    // Sydney: clocks go back on 5 Apr 2026 at 03:00 AEDT and forward on 4 Oct 2026 at 02:00 AEST.
    expect(wallClockToUtc('2026-04-05T02:30:00', 'Australia/Sydney')).toBe('2026-04-04T15:30:00Z');
    expect(wallClockToUtc('2026-10-04T02:30:00', 'Australia/Sydney')).toBe('2026-10-03T16:30:00Z');
    expect(wallClockToUtc('2026-04-06T09:00:00', 'Australia/Sydney')).toBe('2026-04-05T23:00:00Z');
  });

  it('refuses a wall clock that is not a real one instead of rolling it over', () => {
    for (const bad of [
      '2026-02-30T09:00:00',
      '2026-13-01T09:00:00',
      '2026-11-03T25:00:00',
      '2026-11-03T09:60:00',
      '2026-11-03T09:00:61',
      '2026-00-10T09:00:00',
    ]) {
      expect(wallClockToUtc(bad, 'Asia/Dhaka'), bad).toBeNull();
    }
    expect(wallClockToUtc('2028-02-29T09:00:00', 'Asia/Dhaka')).toBe('2028-02-29T03:00:00Z');
  });

  it('knows each zone by its canonical spelling', () => {
    expect(canonicalTimeZone('asia/dhaka')).toBe('Asia/Dhaka');
    expect(canonicalTimeZone('Asia/Dhaka')).toBe('Asia/Dhaka');
    expect(canonicalTimeZone('Nowhere/Else')).toBeNull();
  });

  it('refuses an unknown zone or a malformed time instead of guessing', () => {
    expect(wallClockToUtc('2026-11-03T09:30:00', 'Mars/Olympus_Mons')).toBeNull();
    expect(wallClockToUtc('2026-11-03 09:30', 'Asia/Dhaka')).toBeNull();
    expect(wallClockToUtc('2026-11-03T09:30:00Z', 'Asia/Dhaka')).toBeNull();
  });

  it('round-trips through utcToWallClock', () => {
    for (const [wall, zone] of [
      ['2026-11-03T09:30:00', 'Asia/Dhaka'],
      ['2026-03-09T09:00:00', 'America/Los_Angeles'],
      ['2026-10-31T23:45:00', 'Europe/London'],
    ] as const) {
      const utc = wallClockToUtc(wall, zone);
      expect(utc).not.toBeNull();
      expect(utcToWallClock(utc ?? '', zone)).toEqual({
        date: wall.slice(0, 10),
        time: wall.slice(11, 16),
      });
    }
    expect(utcToWallClock('2026-11-03T03:30:00Z', 'Nowhere/Else')).toBeNull();
  });
});

describe('parseCalendarExportOptions: one parser for every input, never throws', () => {
  const query = (text: string) => new URLSearchParams(text);

  it('gives the defaults for nothing, junk or a version it does not know', () => {
    for (const input of [
      undefined,
      null,
      {},
      query(''),
      query('titles=everything&remind=7&remind=-15&kind=nope&v=1'),
      query('v=2&titles=withCaseNames'),
      { version: 99, titleStyle: 'withCaseNames' },
      { getAll: () => [{}, 5, null] },
      'not an object' as unknown as null,
    ]) {
      expect(parseCalendarExportOptions(input)).toEqual(DEFAULT_CALENDAR_EXPORT_OPTIONS);
    }
    expect(DEFAULT_CALENDAR_EXPORT_OPTIONS).toEqual({
      version: 1,
      titleStyle: 'generic',
      kinds: CALENDAR_KIND_IDS,
      alarms: [],
    });
  });

  it('reads form data, URL parameters, a Next.js query record and stored choices alike', () => {
    const expected = {
      version: 1,
      titleStyle: 'withCaseNames',
      kinds: ['appointment', 'task_due'],
      alarms: [10080, 0],
    };
    const form = new FormData();
    form.append('titles', 'withCaseNames');
    form.append('kind', 'task_due');
    form.append('kind', 'appointment');
    form.append('remind', '0');
    form.append('remind', '10080');
    form.append('remind', '0');
    expect(parseCalendarExportOptions(form)).toEqual(expected);
    expect(
      parseCalendarExportOptions(
        query('titles=withCaseNames&kind=task_due&kind=appointment&remind=0&remind=10080'),
      ),
    ).toEqual(expected);
    expect(
      parseCalendarExportOptions({
        titles: 'withCaseNames',
        kind: ['task_due', 'appointment'],
        remind: ['0', '10080'],
      }),
    ).toEqual(expected);
    expect(
      parseCalendarExportOptions({
        version: 1,
        titleStyle: 'withCaseNames',
        kinds: ['appointment', 'task_due'],
        alarms: [0, 10080],
      }),
    ).toEqual(expected);
  });

  it('keeps only allowed reminders, at most three, and the known kinds when some are unknown', () => {
    const parsed = parseCalendarExportOptions(
      query(
        'remind=0&remind=15&remind=60&remind=1440&remind=10080&remind=99999&kind=task_due&kind=x',
      ),
    );
    expect(parsed.alarms).toEqual([10080, 1440, 60]);
    expect(parsed.kinds).toEqual(['task_due']);
    expect(parseCalendarExportOptions(query('kind=x&kind=y')).kinds).toEqual(CALENDAR_KIND_IDS);
  });

  it('writes options back as the same fields, so a preview carries them to the download', () => {
    const options = parseCalendarExportOptions(
      query('titles=withCaseNames&remind=1440&kind=task_due'),
    );
    const fields = calendarOptionFields(options);
    expect(fields).toEqual([
      [CALENDAR_OPTION_FIELDS.titleStyle, 'withCaseNames'],
      [CALENDAR_OPTION_FIELDS.kinds, 'task_due'],
      [CALENDAR_OPTION_FIELDS.alarms, '1440'],
    ]);
    const back = new URLSearchParams(
      fields.map(([name, value]): [string, string] => [name, value]),
    );
    expect(parseCalendarExportOptions(back)).toEqual(options);
    expect(calendarOptionFields(DEFAULT_CALENDAR_EXPORT_OPTIONS)).toEqual([]);
  });
});
