import { describe, expect, it } from 'vitest';
import { GOLDEN_EVENTS } from './fixtures.test-support';
import { escapeText, foldLine, serializeCalendar } from './ics';
import type { CalendarEvent } from './model';

const NOW = new Date('2026-10-26T12:34:56.789Z');
const EM_DASH = String.fromCodePoint(0x2014);
const utf8 = (text: string) => new TextEncoder().encode(text).length;

/** The exact file for `GOLDEN_EVENTS`: any change to the format shows up here first. */
const GOLDEN = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//VisaStack//Calendar//EN',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-CALNAME:VisaStack Dates',
  'BEGIN:VEVENT',
  'UID:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@visastack',
  'SEQUENCE:25920000',
  'DTSTAMP:20261026T123456Z',
  'DTSTART;VALUE=DATE:20261231',
  'DTEND;VALUE=DATE:20270101',
  'SUMMARY:Task Due - Japan Visit',
  'DESCRIPTION:From VisaStack. Open VisaStack for the details.',
  'CLASS:PRIVATE',
  'STATUS:CONFIRMED',
  'CATEGORIES:VisaStack Task',
  'TRANSP:TRANSPARENT',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT900M',
  'DESCRIPTION:Task Due - Japan Visit',
  'END:VALARM',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:PT540M',
  'DESCRIPTION:Task Due - Japan Visit',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@visastack',
  'SEQUENCE:0',
  'DTSTAMP:20261026T123456Z',
  'DTSTART:20261103T033000Z',
  'DTEND:20261103T043000Z',
  'SUMMARY:Appointment',
  'LOCATION:Room 4\\, Floor 2\\; Gulshan',
  'CLASS:PRIVATE',
  'STATUS:CONFIRMED',
  'CATEGORIES:VisaStack Appointment',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT60M',
  'DESCRIPTION:Appointment',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:cccccccccccccccccccccccccccccccc@visastack',
  'SEQUENCE:7',
  'DTSTAMP:20261026T123456Z',
  'DTSTART;VALUE=DATE:20270430',
  'DTEND;VALUE=DATE:20270501',
  'SUMMARY:Document Expires',
  'CLASS:PRIVATE',
  'STATUS:CANCELLED',
  'TRANSP:TRANSPARENT',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    uid: 'x@visastack',
    sequence: 1,
    status: 'CONFIRMED',
    start: { kind: 'date', date: '2026-11-01' },
    end: { kind: 'duration', minutes: 1440 },
    title: 'Task Due',
    privacy: 'private',
    source: { kind: 'task_due', key: 'task_due:x' },
    ...overrides,
  };
}

describe('serializeCalendar (RFC 5545)', () => {
  it('writes the golden file exactly', () => {
    expect(serializeCalendar(GOLDEN_EVENTS, { now: NOW, calendarName: 'VisaStack Dates' })).toBe(
      GOLDEN,
    );
  });

  it('never writes the VisaStack source, which is for tracing inside VisaStack only', () => {
    const ics = serializeCalendar(GOLDEN_EVENTS, { now: NOW });
    expect(ics).not.toMatch(/task_due:t1|appointment:a1|document_expires/);
    expect(ics).not.toContain('X-WR-CALNAME');
  });

  it('ends an all-day event on a later day and a moment at a later moment', () => {
    const lines = (e: CalendarEvent) =>
      serializeCalendar([e], { now: NOW })
        .split('\r\n')
        .filter((l) => l.startsWith('DTSTART') || l.startsWith('DTEND'));
    expect(lines(event({ end: { kind: 'duration', minutes: 0 } }))).toEqual([
      'DTSTART;VALUE=DATE:20261101',
      'DTEND;VALUE=DATE:20261102',
    ]);
    expect(lines(event({ end: { kind: 'duration', minutes: 2 * 1440 } }))).toEqual([
      'DTSTART;VALUE=DATE:20261101',
      'DTEND;VALUE=DATE:20261103',
    ]);
    expect(
      lines(
        event({
          start: { kind: 'instant', utc: '2026-03-08T09:30:00.000Z' },
          end: { kind: 'instant', utc: '2026-03-08T10:15:00Z' },
        }),
      ),
    ).toEqual(['DTSTART:20260308T093000Z', 'DTEND:20260308T101500Z']);
  });

  it('refuses a malformed date rather than writing a broken file', () => {
    expect(() =>
      serializeCalendar([event({ start: { kind: 'date', date: '2026-11-01\r\nX:1' } })], {
        now: NOW,
      }),
    ).toThrow(RangeError);
  });

  it('neutralises line breaks and control characters in every value, so nothing can add a property', () => {
    const ics = serializeCalendar(
      [
        event({
          uid: 'abc\r\nX-INJECT:1@visastack',
          title: 'Task\r\nX-INJECT:2',
          description: 'Line one\nLine two\rX-INJECT:3\u0007',
          location: `Room\u0000${String.fromCodePoint(0x2028)}X-INJECT:4`,
          categories: ['A\r\nX-INJECT:5'],
          alarms: [{ minutesBefore: 0 }],
        }),
      ],
      { now: NOW },
    );
    for (const line of ics.split('\r\n')) expect(line).not.toMatch(/^X-INJECT/);
    expect(ics).toContain('UID:abc X-INJECT:1@visastack');
    expect(ics).toContain('SUMMARY:Task\\nX-INJECT:2');
    // biome-ignore lint/suspicious/noControlCharactersInRegex: proving none is left.
    expect(ics).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
  });

  it('treats CRLF, a lone CR, LF, NEL and the Unicode separators alike, and drops C1 controls', () => {
    const nel = String.fromCodePoint(0x85);
    const ls = String.fromCodePoint(0x2028);
    const ps = String.fromCodePoint(0x2029);
    const c1 = String.fromCodePoint(0x9b);
    expect(escapeText(`a\r\nb\rc\nd${nel}e${ls}f${ps}g${c1}h`)).toBe('a\\nb\\nc\\nd\\ne\\nf\\ngh');
    const ics = serializeCalendar([event({ uid: `a\rb${nel}c${c1}@visastack` })], { now: NOW });
    expect(ics).toContain('UID:a b c@visastack');
  });

  it('writes two reminders that land on the same moment once', () => {
    const ics = serializeCalendar(
      [event({ alarms: [{ minutesBefore: 15 }, { minutesBefore: 60 }, { minutesBefore: 0 }] })],
      { now: NOW },
    );
    expect(ics.split('\r\n').filter((l) => l.startsWith('TRIGGER:'))).toEqual(['TRIGGER:PT540M']);
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(1);
  });

  it('escapes TEXT values and turns long dashes into hyphens', () => {
    expect(escapeText(`a\\b;c,d\ne ${EM_DASH} f`)).toBe('a\\\\b\\;c\\,d\\ne - f');
  });

  it('writes reminders: before a moment, and at 09:00 on or before an all-day date', () => {
    const triggers = (e: CalendarEvent) =>
      serializeCalendar([e], { now: NOW })
        .split('\r\n')
        .filter((l) => l.startsWith('TRIGGER:'));
    expect(
      triggers(
        event({
          alarms: [{ minutesBefore: 10080 }, { minutesBefore: 1440 }, { minutesBefore: 0 }],
        }),
      ),
    ).toEqual(['TRIGGER:-PT9540M', 'TRIGGER:-PT900M', 'TRIGGER:PT540M']);
    expect(
      triggers(
        event({
          start: { kind: 'instant', utc: '2026-11-03T03:30:00Z' },
          end: { kind: 'duration', minutes: 60 },
          alarms: [{ minutesBefore: 15 }, { minutesBefore: 0 }],
        }),
      ),
    ).toEqual(['TRIGGER:-PT15M', 'TRIGGER:PT0M']);
  });
});

describe('foldLine', () => {
  it('folds at 75 octets, then a space and at most 74 more, never splitting a character', () => {
    expect(foldLine('A'.repeat(200)).split('\r\n').map(utf8)).toEqual([75, 75, 52]);
    expect(foldLine('A'.repeat(75))).toBe('A'.repeat(75));
    expect(foldLine(`${'A'.repeat(73)}ব`)).toBe(`${'A'.repeat(73)}\r\n ব`);
    expect(foldLine(`${'A'.repeat(72)}\u{1F30F}`)).toBe(`${'A'.repeat(72)}\r\n \u{1F30F}`);
  });
});

/** A fixed, seeded generator so a failure can be reproduced. */
function generator(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const ALPHABET = [
  'a',
  'Z',
  ' ',
  ',',
  ';',
  '\\',
  ':',
  '\n',
  '\r',
  '\t',
  '\u0000',
  'ব',
  'é',
  '\u{1F30F}',
  '\uD800',
  '\uDC00',
  EM_DASH,
  String.fromCodePoint(0x2028),
  '中',
];

describe('serializeCalendar: properties over generated input', () => {
  it('every line is at most 75 octets, ends in CRLF, and holds no bare LF, lone surrogate or em dash', () => {
    const random = generator(20261026);
    const text = (max: number) =>
      Array.from(
        { length: Math.floor(random() * max) },
        () => ALPHABET[Math.floor(random() * ALPHABET.length)],
      ).join('');
    for (let round = 0; round < 200; round++) {
      const ics = serializeCalendar(
        [
          event({
            title: text(120),
            description: text(300),
            location: text(80),
            categories: [text(40)],
            alarms: [{ minutesBefore: 60 }],
          }),
        ],
        { now: NOW, calendarName: text(40) },
      );
      expect(ics.endsWith('\r\n')).toBe(true);
      expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
      expect(ics).not.toContain(EM_DASH);
      expect(ics).not.toMatch(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
      );
      const lines = ics.split('\r\n').slice(0, -1);
      for (const line of lines) {
        expect(utf8(line)).toBeLessThanOrEqual(75);
        // Folding never leaves an empty continuation or splits a pair.
        expect(line.length).toBeGreaterThan(0);
      }
      // Unfolded, every content line is a known property or a BEGIN/END.
      for (const line of ics.replace(/\r\n /g, '').split('\r\n').slice(0, -1)) {
        expect(line).toMatch(
          /^(BEGIN|END|VERSION|PRODID|CALSCALE|METHOD|X-WR-CALNAME|UID|SEQUENCE|DTSTAMP|DTSTART|DTEND|SUMMARY|DESCRIPTION|LOCATION|CLASS|STATUS|CATEGORIES|TRANSP|ACTION|TRIGGER)[:;]/,
        );
      }
    }
  });
});
