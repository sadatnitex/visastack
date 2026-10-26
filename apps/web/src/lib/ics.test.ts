import {
  DEFAULT_CALENDAR_EXPORT_OPTIONS,
  calendarUid,
  parseCalendarExportOptions,
} from '@visastack/core/calendar';
import type { CalendarItem } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_EVENT_DESCRIPTION,
  CALENDAR_EXPORT_LIMIT,
  buildIcsCalendar,
  buildIcsForAppointment,
  calendarCaseName,
  calendarEventTitle,
  describeCalendarStart,
  selectCalendarEvents,
} from './ics';

const NOW = new Date('2026-10-26T12:34:56.000Z');
const EM_DASH = String.fromCodePoint(0x2014);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const unfold = (ics: string) => ics.replace(/\r\n /g, '');
const property = (ics: string, name: string) =>
  unfold(ics)
    .split('\r\n')
    .filter((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`));

describe('buildIcsForAppointment - one appointment (Commercial V1 Part 4 section 11)', () => {
  const base = {
    id: 'appt-1',
    title: 'Visa interview prep',
    localDateTime: new Date('2026-12-01T09:00:00.000Z'),
    timezone: 'Asia/Dhaka',
    place: 'Agency office' as string | null,
    channel: 'In Person' as string | null,
    updatedAt: new Date('2026-10-20T08:00:00.000Z'),
  };

  it('is a well-formed private VCALENDAR with its title, place and channel, CRLF line endings', () => {
    const ics = buildIcsForAppointment(base, { now: NOW });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('\r\nVERSION:2.0\r\n');
    expect(property(ics, 'SUMMARY')).toEqual(['SUMMARY:Visa interview prep']);
    expect(property(ics, 'LOCATION')).toEqual(['LOCATION:Agency office']);
    expect(property(ics, 'DESCRIPTION')).toEqual(['DESCRIPTION:Channel: In Person']);
    expect(property(ics, 'CLASS')).toEqual(['CLASS:PRIVATE']);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('writes the time the person meant as UTC, so every calendar shows it right without a zone block', () => {
    const ics = buildIcsForAppointment(base, { now: NOW });
    // 09:00 in Dhaka (UTC+6) is 03:00 UTC; one hour by default.
    expect(property(ics, 'DTSTART')).toEqual(['DTSTART:20261201T030000Z']);
    expect(property(ics, 'DTEND')).toEqual(['DTEND:20261201T040000Z']);
    expect(ics).not.toContain('TZID');
    const la = buildIcsForAppointment(
      { ...base, timezone: 'America/Los_Angeles', durationMinutes: 30 },
      { now: NOW },
    );
    // 1 Dec is standard time in Los Angeles (UTC-8).
    expect(property(la, 'DTSTART')).toEqual(['DTSTART:20261201T170000Z']);
    expect(property(la, 'DTEND')).toEqual(['DTEND:20261201T173000Z']);
  });

  it('with a stored zone it does not know, keeps the day as an all-day event instead of guessing a time', () => {
    const ics = buildIcsForAppointment({ ...base, timezone: 'Mars/Olympus_Mons' }, { now: NOW });
    expect(property(ics, 'DTSTART')).toEqual(['DTSTART;VALUE=DATE:20261201']);
  });

  it('has an opaque UID, the same as the dates file gives the same appointment', () => {
    const ics = buildIcsForAppointment(base, { now: NOW });
    expect(property(ics, 'UID')).toEqual([`UID:${calendarUid('appointment', 'appt-1')}`]);
    expect(property(ics, 'UID')[0]).toMatch(/^UID:[0-9a-f]{32}@visastack$/);
    expect(ics).not.toContain('appt-1');
    const item: CalendarItem = {
      key: 'appointment:appt-1',
      kind: 'appointment',
      resourceId: 'appt-1',
      when: { kind: 'local', localDateTime: '2026-12-01T09:00:00', timeZone: 'Asia/Dhaka' },
      caseTitle: null,
      updatedAt: base.updatedAt.toISOString(),
    };
    const many = buildIcsCalendar(
      selectCalendarEvents([item], [item.key], DEFAULT_CALENDAR_EXPORT_OPTIONS).events,
      { now: NOW },
    );
    expect(property(many, 'UID')).toEqual(property(ics, 'UID'));
    expect(property(many, 'SEQUENCE')).toEqual(property(ics, 'SEQUENCE'));
  });

  it('a line break in any stored value can never add a property', () => {
    const ics = buildIcsForAppointment(
      {
        ...base,
        title: 'Prep\r\nX-INJECT:1',
        place: 'Room\nX-INJECT:2',
        channel: 'Call\rX-INJECT:3',
        timezone: 'Asia/Dhaka\r\nX-INJECT:4',
      },
      { now: NOW },
    );
    for (const line of ics.split('\r\n')) expect(line).not.toMatch(/^X-INJECT/);
  });
});

// --- Several dated items in one file -----------------------------------------------------------

const ID = {
  appt: '0b6f1c2e-1111-4a8e-9d0c-000000000001',
  task: '0b6f1c2e-2222-4a8e-9d0c-000000000002',
  request: '0b6f1c2e-3333-4a8e-9d0c-000000000003',
  doc: '0b6f1c2e-4444-4a8e-9d0c-000000000004',
};
const UPDATED = '2026-10-20T08:00:00.000Z';
/** In the server's order: earliest first. */
const ITEMS: CalendarItem[] = [
  {
    key: `request_due:${ID.request}`,
    kind: 'request_due',
    resourceId: ID.request,
    when: { kind: 'date', date: '2026-11-01' },
    caseTitle: 'Japan Visit',
    updatedAt: UPDATED,
  },
  {
    key: `appointment:${ID.appt}`,
    kind: 'appointment',
    resourceId: ID.appt,
    when: { kind: 'local', localDateTime: '2026-11-03T09:30:00', timeZone: 'Asia/Dhaka' },
    caseTitle: 'Japan Visit',
    updatedAt: UPDATED,
  },
  {
    key: `task_due:${ID.task}`,
    kind: 'task_due',
    resourceId: ID.task,
    when: { kind: 'date', date: '2026-12-31' },
    caseTitle: 'Japan Visit',
    updatedAt: UPDATED,
  },
  {
    key: `document_expires:${ID.doc}`,
    kind: 'document_expires',
    resourceId: ID.doc,
    when: { kind: 'date', date: '2027-04-30' },
    caseTitle: null,
    updatedAt: UPDATED,
  },
];
const ALL_KEYS = ITEMS.map((i) => i.key);
const WITH_NAMES = parseCalendarExportOptions({ titles: 'withCaseNames' });

function file(keys: readonly string[] = ALL_KEYS, options = DEFAULT_CALENDAR_EXPORT_OPTIONS) {
  return buildIcsCalendar(selectCalendarEvents(ITEMS, keys, options).events, { now: NOW });
}

describe('the dates file (v1.2 B05)', () => {
  it('holds one private event per chosen item, with stable opaque UIDs and a SEQUENCE from the last change', () => {
    const ics = file();
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(property(ics, 'X-WR-CALNAME')).toEqual(['X-WR-CALNAME:VisaStack Dates']);
    const uids = property(ics, 'UID');
    expect(uids).toEqual([
      `UID:${calendarUid('request_due', ID.request)}`,
      `UID:${calendarUid('appointment', ID.appt)}`,
      `UID:${calendarUid('task_due', ID.task)}`,
      `UID:${calendarUid('document_expires', ID.doc)}`,
    ]);
    for (const uid of uids) expect(uid).not.toMatch(UUID);
    expect(new Set(uids).size).toBe(4);
    expect(property(file([...ALL_KEYS].reverse()), 'UID')).toEqual(uids);
    // 2026-10-20T08:00:00Z is 292 days and 8 hours (25 257 600 seconds) after 1 Jan 2026.
    expect(property(ics, 'SEQUENCE')).toEqual(Array(4).fill('SEQUENCE:25257600'));
    expect(property(ics, 'CLASS')).toEqual(Array(4).fill('CLASS:PRIVATE'));
    expect(property(ics, 'CATEGORIES')).toEqual([
      'CATEGORIES:VisaStack Request',
      'CATEGORIES:VisaStack Appointment',
      'CATEGORIES:VisaStack Task',
      'CATEGORIES:VisaStack Document',
    ]);
  });

  it('makes dates all-day and the appointment a UTC moment', () => {
    const ics = file();
    expect(property(ics, 'DTSTART')).toEqual([
      'DTSTART;VALUE=DATE:20261101',
      'DTSTART:20261103T033000Z',
      'DTSTART;VALUE=DATE:20261231',
      'DTSTART;VALUE=DATE:20270430',
    ]);
    expect(property(ics, 'DTEND')).toEqual([
      'DTEND;VALUE=DATE:20261102',
      'DTEND:20261103T043000Z',
      'DTEND;VALUE=DATE:20270101',
      'DTEND;VALUE=DATE:20270501',
    ]);
  });

  it('places a Los Angeles appointment correctly on both sides of the daylight saving change', () => {
    const la = (localDateTime: string): CalendarItem => ({
      key: `appointment:${localDateTime}`,
      kind: 'appointment',
      resourceId: localDateTime,
      when: { kind: 'local', localDateTime, timeZone: 'America/Los_Angeles' },
      caseTitle: null,
      updatedAt: UPDATED,
    });
    const items = [la('2026-10-31T09:00:00'), la('2026-11-02T09:00:00')];
    const { events } = selectCalendarEvents(
      items,
      items.map((i) => i.key),
      DEFAULT_CALENDAR_EXPORT_OPTIONS,
    );
    expect(property(buildIcsCalendar(events, { now: NOW }), 'DTSTART')).toEqual([
      'DTSTART:20261031T160000Z',
      'DTSTART:20261102T170000Z',
    ]);
    // The page shows the same wall clock the person meant.
    expect(events.map(describeCalendarStart)).toEqual([
      'Sat 31 Oct 2026, 09:00 America/Los_Angeles time',
      'Mon 2 Nov 2026, 09:00 America/Los_Angeles time',
    ]);
  });

  it('uses generic titles by default, and case names only when asked, with a hyphen', () => {
    expect(property(file(), 'SUMMARY')).toEqual([
      'SUMMARY:Request Due',
      'SUMMARY:Appointment',
      'SUMMARY:Task Due',
      'SUMMARY:Document Expires',
    ]);
    expect(property(file(ALL_KEYS, WITH_NAMES), 'SUMMARY')).toEqual([
      'SUMMARY:Request Due - Japan Visit',
      'SUMMARY:Appointment - Japan Visit',
      'SUMMARY:Task Due - Japan Visit',
      'SUMMARY:Document Expires',
    ]);
    expect(file(ALL_KEYS, WITH_NAMES)).not.toContain(EM_DASH);
  });

  it('adds a reminder only when chosen, at 09:00 for a date and before the moment for an appointment', () => {
    expect(file()).not.toContain('BEGIN:VALARM');
    const reminded = file(ALL_KEYS, parseCalendarExportOptions({ remind: '10080' }));
    expect(property(reminded, 'TRIGGER')).toEqual([
      'TRIGGER:-PT9540M',
      'TRIGGER:-PT10080M',
      'TRIGGER:-PT9540M',
      'TRIGGER:-PT9540M',
    ]);
  });

  it('includes only the kinds the options allow', () => {
    const onlyTasks = file(ALL_KEYS, parseCalendarExportOptions({ kind: 'task_due' }));
    expect(property(onlyTasks, 'SUMMARY')).toEqual(['SUMMARY:Task Due']);
  });

  it('never puts an id, a link, an email or a long number in a title or description', () => {
    const risky: CalendarItem = {
      ...ITEMS[2],
      caseTitle: 'Passport BX7319046',
    } as CalendarItem;
    const ics = buildIcsCalendar(
      selectCalendarEvents([risky, ...ITEMS], ALL_KEYS, WITH_NAMES).events,
      { now: NOW },
    );
    const text = [...property(ics, 'SUMMARY'), ...property(ics, 'DESCRIPTION')].join('\n');
    expect(text).not.toMatch(UUID);
    expect(text).not.toMatch(/https?:|www\.|\/app\//i);
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\d{5,}/);
    expect(property(ics, 'DESCRIPTION')).toEqual(
      Array(4).fill(`DESCRIPTION:${CALENDAR_EVENT_DESCRIPTION}`),
    );
    expect(ics).not.toMatch(/^(LOCATION|URL|ATTACH|ORGANIZER|ATTENDEE)[:;]/m);
  });

  it('ignores keys the server did not list, and repeats, keeping the server order', () => {
    const { events, leftOut } = selectCalendarEvents(
      ITEMS,
      [
        `task_due:${ID.task}`,
        'task_due:someone-else',
        `task_due:${ID.task}`,
        'appointment:made-up',
      ],
      DEFAULT_CALENDAR_EXPORT_OPTIONS,
    );
    expect(events.map((e) => e.source.key)).toEqual([`task_due:${ID.task}`]);
    expect(leftOut).toBe(0);
  });

  it(`holds at most ${CALENDAR_EXPORT_LIMIT} events, the earliest, and counts the rest`, () => {
    const many: CalendarItem[] = Array.from({ length: CALENDAR_EXPORT_LIMIT + 3 }, (_, i) => ({
      key: `task_due:t${String(i).padStart(3, '0')}`,
      kind: 'task_due',
      resourceId: `t${i}`,
      when: { kind: 'date', date: '2026-11-01' },
      caseTitle: null,
      updatedAt: UPDATED,
    }));
    const { events, leftOut } = selectCalendarEvents(
      many,
      many.map((i) => i.key).reverse(),
      DEFAULT_CALENDAR_EXPORT_OPTIONS,
    );
    expect(events).toHaveLength(CALENDAR_EXPORT_LIMIT);
    expect(events[0]?.source.key).toBe('task_due:t000');
    expect(leftOut).toBe(3);
  });
});

describe('calendarCaseName: what of a case name may sit in a calendar', () => {
  it('keeps an ordinary name, with long dashes turned into hyphens', () => {
    expect(calendarCaseName('Japan Visit 2026')).toBe('Japan Visit 2026');
    expect(calendarCaseName(`Japan ${EM_DASH} Visit\r\nAgain`)).toBe('Japan - Visit Again');
  });

  it('leaves out a name holding a long, grouped or non-Latin number, a link or an email address', () => {
    for (const risky of [
      'Renew passport BX7319046',
      'Account 1234 5678 9012',
      // Bangla digits and full-width digits count as digits.
      `Ref ${String.fromCodePoint(0x09e7, 0x09e8, 0x09e9, 0x09ea, 0x09eb, 0x09ec)}`,
      `Ref ${String.fromCodePoint(0xff11, 0xff12, 0xff13, 0xff14, 0xff15, 0xff16)}`,
      'See visastack.example/app/case',
      'Ask nusrat@example.com',
    ]) {
      expect(calendarCaseName(risky), risky).toBeNull();
    }
    expect(
      calendarEventTitle({ kind: 'task_due', caseTitle: 'Account 1234 5678 9012' }, WITH_NAMES),
    ).toBe('Task Due');
  });

  it('drops bidirectional controls that could disguise the text', () => {
    const rlo = String.fromCodePoint(0x202e);
    const isolate = String.fromCodePoint(0x2066);
    expect(calendarCaseName(`Japan ${rlo}tisiV${isolate}`)).toBe('Japan tisiV');
  });

  it('cuts at 80 characters without splitting one', () => {
    const globe = String.fromCodePoint(0x1f30f);
    const cut = calendarCaseName(`${'a'.repeat(79)}${globe}${globe}`) ?? '';
    expect(Array.from(cut)).toHaveLength(80);
    expect(cut.endsWith(globe)).toBe(true);
    expect(cut).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it('gives the generic title alone when there is no case or the name is empty', () => {
    expect(calendarEventTitle({ kind: 'appointment', caseTitle: null }, WITH_NAMES)).toBe(
      'Appointment',
    );
    expect(calendarEventTitle({ kind: 'task_due', caseTitle: '   ' }, WITH_NAMES)).toBe('Task Due');
  });
});
