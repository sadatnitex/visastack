/**
 * A minimal iCalendar (RFC 5545) VEVENT generator for one appointment.
 * Commercial V1 Part 4 §11: "Appointment: ... add-to-calendar file/download.
 * No calendar SaaS integration required." - a real, importable .ics file is
 * sufficient; no Google/Outlook API integration is in scope.
 *
 * Uses a bare `DTSTART;TZID=<iana>` referencing the zone by name rather than
 * embedding a full VTIMEZONE block: every mainstream calendar app (Google
 * Calendar, Outlook, Apple Calendar) resolves a recognized IANA id this way,
 * and the PRD's own "no calendar SaaS integration required" sets the bar at
 * "importable," not "valid against every RFC 5545 conformance test."
 */

/** Escape text per RFC 5545 §3.3.11: backslash, semicolon, comma, then newlines to literal \n. */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * `YYYYMMDDTHHMMSS`, from a wall-clock local date/time. Deliberately reads
 * the UTC-getter methods, not the local ones: this process runs with TZ=UTC
 * (see schema.ts's `localDateTime` doc comment for why that makes the two
 * equivalent here), so `getUTCHours()` etc. return the exact wall-clock
 * numbers that were stored, with no conversion in either direction.
 */
function formatLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

/** `YYYYMMDDTHHMMSSZ`, a genuine UTC instant (used only for DTSTAMP, "when this file was generated"). */
function formatUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

export interface IcsAppointment {
  readonly id: string;
  readonly title: string;
  /** Wall-clock local value; interpreted in `timezone`, never converted. */
  readonly localDateTime: Date;
  readonly timezone: string;
  readonly place: string | null;
  readonly channel: string | null;
  /** Minutes; appointments have no stored end time, so this only sizes the calendar block. */
  readonly durationMinutes?: number;
}

/** Builds a complete, single-event .ics file. */
export function buildIcsForAppointment(appt: IcsAppointment): string {
  const duration = appt.durationMinutes ?? 60;
  const end = new Date(appt.localDateTime.getTime() + duration * 60_000);
  const descriptionParts = [appt.channel ? `Channel: ${appt.channel}` : null].filter(
    (p): p is string => p !== null,
  );

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VisaStack//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:appointment-${appt.id}@visastack`,
    `DTSTAMP:${formatUtc(new Date())}`,
    `DTSTART;TZID=${appt.timezone}:${formatLocal(appt.localDateTime)}`,
    `DTEND;TZID=${appt.timezone}:${formatLocal(end)}`,
    `SUMMARY:${escapeIcsText(appt.title)}`,
    ...(appt.place ? [`LOCATION:${escapeIcsText(appt.place)}`] : []),
    ...(descriptionParts.length > 0
      ? [`DESCRIPTION:${escapeIcsText(descriptionParts.join('\n'))}`]
      : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  // RFC 5545 requires CRLF line endings.
  return `${lines.join('\r\n')}\r\n`;
}
