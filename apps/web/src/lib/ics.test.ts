import type { CalendarItem } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_EVENT_DESCRIPTION,
  CALENDAR_EXPORT_LIMIT,
  buildIcsCalendar,
  buildIcsForAppointment,
  calendarCaseName,
  calendarEventTitle,
  describeCalendarWhen,
  foldIcsLine,
  icsUid,
  selectCalendarEvents,
} from './ics';

describe('buildIcsForAppointment - a real, importable .ics file (Commercial V1 Part 4 §11)', () => {
  const base = {
    id: 'appt-1',
    title: 'Visa interview prep',
    localDateTime: new Date('2026-12-01T09:00:00.000Z'),
    timezone: 'Asia/Dhaka',
    place: 'Agency office' as string | null,
    channel: 'In Person' as string | null,
  };

  it('produces a well-formed VCALENDAR/VEVENT with the required fields, CRLF line endings', () => {
    const ics = buildIcsForAppointment(base);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:appointment-appt-1@visastack');
    expect(ics).toContain('SUMMARY:Visa interview prep');
    expect(ics).toContain('LOCATION:Agency office');
    expect(ics).toContain('DESCRIPTION:Channel: In Person');
    expect(ics).toContain('END:VEVENT\r\n');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('expresses the wall-clock local time via TZID, never converting it to a UTC instant', () => {
    const ics = buildIcsForAppointment(base);
    // The stored local value reads 09:00 (see schema.ts's localDateTime doc
    // comment: this process runs at TZ=UTC, so the UTC-getter components
    // ARE the original wall-clock numbers) - DTSTART must carry that exact
    // clock time tagged with the zone, not a shifted UTC instant.
    expect(ics).toContain('DTSTART;TZID=Asia/Dhaka:20261201T090000');
    expect(ics).toContain('DTEND;TZID=Asia/Dhaka:20261201T100000'); // default 60-minute block
    // Never a bare UTC 'Z'-suffixed DTSTART - that would be a different,
    // wrong instant once a calendar app applies the TZID's own offset.
    expect(ics).not.toContain('DTSTART:20261201T090000Z');
  });

  it('honors an explicit duration for DTEND', () => {
    const ics = buildIcsForAppointment({ ...base, durationMinutes: 30 });
    expect(ics).toContain('DTSTART;TZID=Asia/Dhaka:20261201T090000');
    expect(ics).toContain('DTEND;TZID=Asia/Dhaka:20261201T093000');
  });

  it('omits LOCATION/DESCRIPTION entirely when place/channel are null, rather than emitting an empty field', () => {
    const ics = buildIcsForAppointment({ ...base, place: null, channel: null });
    expect(ics).not.toContain('LOCATION:');
    expect(ics).not.toContain('DESCRIPTION:');
  });

  it('escapes RFC 5545 special characters in free text (comma, semicolon, backslash, newline)', () => {
    const ics = buildIcsForAppointment({
      ...base,
      title: 'Meeting; agenda: visas, docs\nand fees',
      place: 'Room A\\B',
    });
    expect(ics).toContain('SUMMARY:Meeting\\; agenda: visas\\, docs\\nand fees');
    expect(ics).toContain('LOCATION:Room A\\\\B');
  });

  it('gives every appointment a distinct UID, so two calendar entries never collide or overwrite one another', () => {
    const first = buildIcsForAppointment({ ...base, id: 'appt-a' });
    const second = buildIcsForAppointment({ ...base, id: 'appt-b' });
    expect(first).toContain('UID:appointment-appt-a@visastack');
    expect(second).toContain('UID:appointment-appt-b@visastack');
  });
});

// --- Several dated items in one file (v1.2 B05 calendar export) -----------------------------

const EM_DASH = String.fromCodePoint(0x2014);
const NOW = new Date('2026-10-26T12:34:56.000Z');
const ID = {
  appt: '0b6f1c2e-1111-4a8e-9d0c-000000000001',
  task: '0b6f1c2e-2222-4a8e-9d0c-000000000002',
  request: '0b6f1c2e-3333-4a8e-9d0c-000000000003',
  doc: '0b6f1c2e-4444-4a8e-9d0c-000000000004',
};
/** In the server's order: earliest first. */
const ITEMS: CalendarItem[] = [
  {
    key: `evidence_request:${ID.request}`,
    kind: 'evidence_request',
    when: { kind: 'date', date: '2026-11-01' },
    caseTitle: 'Japan Visit',
  },
  {
    key: `appointment:${ID.appt}`,
    kind: 'appointment',
    when: { kind: 'local', localDateTime: '2026-11-03T09:30:00', timezone: 'Asia/Dhaka' },
    caseTitle: 'Japan Visit',
  },
  {
    key: `task:${ID.task}`,
    kind: 'task',
    when: { kind: 'date', date: '2026-12-31' },
    caseTitle: 'Japan Visit',
  },
  {
    key: `document_expiry:${ID.doc}`,
    kind: 'document_expiry',
    when: { kind: 'date', date: '2027-04-30' },
    caseTitle: null,
  },
];
const ALL_KEYS = ITEMS.map((i) => i.key);

/** Undo RFC 5545 folding: a CRLF followed by one space joins the lines. */
const unfold = (ics: string) => ics.replace(/\r\n /g, '');
const property = (ics: string, name: string) =>
  unfold(ics)
    .split('\r\n')
    .filter((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`));
const utf8 = (text: string) => new TextEncoder().encode(text).length;

function file(keys: readonly string[] = ALL_KEYS, caseNames = false) {
  return buildIcsCalendar(selectCalendarEvents(ITEMS, keys, { caseNames }).events, { now: NOW });
}

describe('buildIcsCalendar - one file for several dated items (v1.2 B05)', () => {
  it('is a publishable VCALENDAR with one VEVENT per item and CRLF line endings only', () => {
    const ics = file();
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics).toContain('\r\nPRODID:-//VisaStack//Calendar Export//EN\r\n');
    expect(ics).toContain('\r\nCALSCALE:GREGORIAN\r\n');
    expect(ics).toContain('\r\nMETHOD:PUBLISH\r\n');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(ics.match(/END:VEVENT/g)).toHaveLength(4);
    // Every newline is part of a CRLF.
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(property(ics, 'DTSTAMP')).toEqual(Array(4).fill('DTSTAMP:20261026T123456Z'));
  });

  it('makes a date an all-day event ending the next day, across a month and a year end', () => {
    const ics = file([`task:${ID.task}`, `evidence_request:${ID.request}`]);
    expect(property(ics, 'DTSTART')).toEqual([
      'DTSTART;VALUE=DATE:20261101',
      'DTSTART;VALUE=DATE:20261231',
    ]);
    expect(property(ics, 'DTEND')).toEqual([
      'DTEND;VALUE=DATE:20261102',
      'DTEND;VALUE=DATE:20270101',
    ]);
    expect(property(ics, 'TRANSP')).toEqual(['TRANSP:TRANSPARENT', 'TRANSP:TRANSPARENT']);
  });

  it('keeps an appointment at its wall-clock time with its TZID, never converted to UTC', () => {
    const ics = file([`appointment:${ID.appt}`]);
    expect(property(ics, 'DTSTART')).toEqual(['DTSTART;TZID=Asia/Dhaka:20261103T093000']);
    expect(property(ics, 'DTEND')).toEqual(['DTEND;TZID=Asia/Dhaka:20261103T103000']);
    expect(ics).not.toMatch(/DTSTART[^\r]*Z\r/);
    expect(ics).not.toContain('TRANSP');
  });

  it('without a recognised zone, keeps the clock time floating rather than guessing one', () => {
    const events = [
      {
        key: `appointment:${ID.appt}`,
        summary: 'Appointment',
        when: { kind: 'local' as const, localDateTime: '2026-11-03T09:30:00', timezone: null },
      },
      {
        key: 'appointment:other',
        summary: 'Appointment',
        when: {
          kind: 'local' as const,
          localDateTime: '2026-11-04T09:30:00',
          timezone: 'Asia/Dhaka\r\nX-INJECT:1',
        },
      },
    ];
    const ics = buildIcsCalendar(events, { now: NOW });
    expect(property(ics, 'DTSTART')).toEqual([
      'DTSTART:20261103T093000',
      'DTSTART:20261104T093000',
    ]);
    expect(ics).not.toContain('X-INJECT');
  });

  it('gives each item a stable UID from its key, distinct between items and kinds', () => {
    const first = property(file(), 'UID');
    const again = property(file([...ALL_KEYS].reverse()), 'UID');
    expect(first).toEqual([
      `UID:evidence_request-${ID.request}@visastack`,
      `UID:appointment-${ID.appt}@visastack`,
      `UID:task-${ID.task}@visastack`,
      `UID:document_expiry-${ID.doc}@visastack`,
    ]);
    expect(again).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
    // The same UID as the single-appointment file, so importing both does not duplicate it.
    expect(icsUid(`appointment:${ID.appt}`)).toBe(`appointment-${ID.appt}@visastack`);
    expect(icsUid('task:a;b\r\nX')).toBe('task-a-b--X@visastack');
  });

  it('uses generic titles by default, and adds case names only when asked, with a hyphen', () => {
    expect(property(file(), 'SUMMARY')).toEqual([
      'SUMMARY:Request Due',
      'SUMMARY:Appointment',
      'SUMMARY:Task Due',
      'SUMMARY:Document Expires',
    ]);
    const named = property(file(ALL_KEYS, true), 'SUMMARY');
    expect(named).toEqual([
      'SUMMARY:Request Due - Japan Visit',
      'SUMMARY:Appointment - Japan Visit',
      'SUMMARY:Task Due - Japan Visit',
      'SUMMARY:Document Expires',
    ]);
    expect(file(ALL_KEYS, true)).not.toContain(EM_DASH);
  });

  it('never puts an id, a link, an email or a long number in a title or description', () => {
    const ics = buildIcsCalendar(
      selectCalendarEvents(
        [
          {
            key: `task:${ID.task}`,
            kind: 'task',
            when: { kind: 'date', date: '2026-11-01' },
            caseTitle: `Passport BX7319046 ${EM_DASH} account 0123456789\nnext`,
          },
          ...ITEMS,
        ],
        ALL_KEYS,
        { caseNames: true },
      ).events,
      { now: NOW },
    );
    const text = [...property(ics, 'SUMMARY'), ...property(ics, 'DESCRIPTION')].join('\n');
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(text).not.toMatch(/https?:|www\.|\/app\//i);
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\d{5,}/);
    expect(text).not.toContain(EM_DASH);
    expect(property(ics, 'DESCRIPTION')).toEqual(
      Array(4).fill(`DESCRIPTION:${CALENDAR_EVENT_DESCRIPTION}`),
    );
    expect(ics).not.toMatch(/^(LOCATION|URL|ATTACH|ORGANIZER|ATTENDEE)[:;]/m);
  });

  it('escapes text and folds lines at 75 octets in UTF-8 without splitting a character', () => {
    const summary = `Task Due - ${'Dhaka, Gulshan; Room\\A '.repeat(3)}${'\u09AC\u09BE\u0982\u09B2\u09BE'.repeat(8)}\u{1F30F}`;
    const ics = buildIcsCalendar(
      [{ key: 'task:x', summary, when: { kind: 'date', date: '2026-11-01' } }],
      { now: NOW },
    );
    const lines = ics.split('\r\n');
    for (const line of lines) expect(utf8(line)).toBeLessThanOrEqual(75);
    const folded = lines.filter((line) => line.startsWith(' '));
    expect(folded.length).toBeGreaterThan(1);
    // No line is cut inside a character: every line decodes to itself, with no U+FFFD.
    for (const line of lines) expect(line).not.toContain('\uFFFD');
    expect(property(ics, 'SUMMARY')).toEqual([
      `SUMMARY:Task Due - ${'Dhaka\\, Gulshan\\; Room\\\\A '.repeat(3)}${'\u09AC\u09BE\u0982\u09B2\u09BE'.repeat(8)}\u{1F30F}`,
    ]);
  });

  it('folds exactly at the limit: 75 octets, then a space and at most 74', () => {
    const ascii = foldIcsLine('A'.repeat(200));
    const parts = ascii.split('\r\n');
    expect(parts.map(utf8)).toEqual([75, 75, 52]);
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(foldIcsLine('A'.repeat(75))).toBe('A'.repeat(75));
    // A three-octet character that would cross octet 75 moves whole to the next line.
    const bangla = foldIcsLine(`${'A'.repeat(73)}\u09AC`);
    expect(bangla).toBe(`${'A'.repeat(73)}\r\n \u09AC`);
    const emoji = foldIcsLine(`${'A'.repeat(72)}\u{1F30F}`);
    expect(emoji).toBe(`${'A'.repeat(72)}\r\n \u{1F30F}`);
  });
});

describe('selectCalendarEvents - the preview and the file are built from the same items', () => {
  it('ignores keys the server did not list, and repeats, keeping the server order', () => {
    const { events, leftOut } = selectCalendarEvents(
      ITEMS,
      [`task:${ID.task}`, 'task:someone-else', `task:${ID.task}`, 'appointment:made-up'],
      { caseNames: false },
    );
    expect(events).toEqual([
      { key: `task:${ID.task}`, summary: 'Task Due', when: { kind: 'date', date: '2026-12-31' } },
    ]);
    expect(leftOut).toBe(0);
    expect(selectCalendarEvents(ITEMS, ['nothing'], { caseNames: true }).events).toEqual([]);
  });

  it(`holds at most ${CALENDAR_EXPORT_LIMIT} events, the earliest, and counts the rest`, () => {
    const many: CalendarItem[] = Array.from({ length: CALENDAR_EXPORT_LIMIT + 3 }, (_, i) => ({
      key: `task:t${String(i).padStart(3, '0')}`,
      kind: 'task',
      when: { kind: 'date', date: '2026-11-01' },
      caseTitle: null,
    }));
    const { events, leftOut } = selectCalendarEvents(many, many.map((i) => i.key).reverse(), {
      caseNames: false,
    });
    expect(events).toHaveLength(CALENDAR_EXPORT_LIMIT);
    expect(events[0]?.key).toBe('task:t000');
    expect(leftOut).toBe(3);
  });
});

describe('calendar wording helpers', () => {
  it('names a case safely: hyphens, no control characters, long numbers hidden, capped', () => {
    expect(calendarCaseName(`Japan ${EM_DASH} Visit\r\nX`)).toBe('Japan - Visit X');
    expect(calendarCaseName('Renew passport BX7319046 now')).toBe(
      'Renew passport (number hidden) now',
    );
    expect(calendarCaseName('Trip 2026')).toBe('Trip 2026');
    expect(calendarCaseName('x'.repeat(200))).toHaveLength(80);
    expect(calendarEventTitle({ kind: 'appointment', caseTitle: null }, { caseNames: true })).toBe(
      'Appointment',
    );
    expect(calendarEventTitle({ kind: 'task', caseTitle: '   ' }, { caseNames: true })).toBe(
      'Task Due',
    );
  });

  it('describes a date as written in the file: all day, or the clock time with its zone', () => {
    expect(describeCalendarWhen({ kind: 'date', date: '2026-11-03' })).toBe(
      'Tue 3 Nov 2026, all day',
    );
    expect(
      describeCalendarWhen({
        kind: 'local',
        localDateTime: '2026-11-03T09:30:00',
        timezone: 'Asia/Dhaka',
      }),
    ).toBe('Tue 3 Nov 2026, 09:30 Asia/Dhaka time');
    expect(
      describeCalendarWhen({ kind: 'local', localDateTime: '2026-11-03T09:30:00', timezone: null }),
    ).toContain('time zone not recorded');
  });
});
