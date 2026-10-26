import type { CalendarEvent } from './model';

/** A fixed set of made-up events for the golden file: one of each start kind, a reminder, a cancellation. */
export const GOLDEN_EVENTS: readonly CalendarEvent[] = [
  {
    uid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@visastack',
    sequence: 25_920_000,
    status: 'CONFIRMED',
    start: { kind: 'date', date: '2026-12-31' },
    end: { kind: 'duration', minutes: 1440 },
    title: 'Task Due - Japan Visit',
    description: 'From VisaStack. Open VisaStack for the details.',
    privacy: 'private',
    categories: ['VisaStack Task'],
    alarms: [{ minutesBefore: 1440 }, { minutesBefore: 0 }],
    source: { kind: 'task_due', key: 'task_due:t1' },
  },
  {
    uid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb@visastack',
    sequence: 0,
    status: 'CONFIRMED',
    start: { kind: 'instant', utc: '2026-11-03T03:30:00Z', timeZone: 'Asia/Dhaka' },
    end: { kind: 'duration', minutes: 60 },
    title: 'Appointment',
    location: 'Room 4, Floor 2; Gulshan',
    privacy: 'private',
    categories: ['VisaStack Appointment'],
    alarms: [{ minutesBefore: 60 }],
    source: { kind: 'appointment', key: 'appointment:a1' },
  },
  {
    uid: 'cccccccccccccccccccccccccccccccc@visastack',
    sequence: 7,
    status: 'CANCELLED',
    start: { kind: 'date', date: '2027-04-30' },
    end: { kind: 'date', date: '2027-05-01' },
    title: 'Document Expires',
    privacy: 'private',
    source: { kind: 'document_expires', key: 'document_expires:d1' },
  },
];
