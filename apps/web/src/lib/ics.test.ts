import { describe, expect, it } from 'vitest';
import { buildIcsForAppointment } from './ics';

describe('buildIcsForAppointment - a real, importable .ics file (Commercial V1 Part 4 §11)', () => {
  const base = {
    id: 'appt-1',
    title: 'Visa interview prep',
    localDateTime: new Date('2026-12-01T09:00:00.000Z'),
    timezone: 'Asia/Dhaka',
    place: 'Agency office' as string | null,
    channel: 'In person' as string | null,
  };

  it('produces a well-formed VCALENDAR/VEVENT with the required fields, CRLF line endings', () => {
    const ics = buildIcsForAppointment(base);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:appointment-appt-1@visastack');
    expect(ics).toContain('SUMMARY:Visa interview prep');
    expect(ics).toContain('LOCATION:Agency office');
    expect(ics).toContain('DESCRIPTION:Channel: In person');
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
