import { describe, expect, it } from 'vitest';
import {
  CHECK_THIS_DATE,
  CHECK_THIS_DATE_WHY,
  DEADLINE_TONE_WORDS,
  deadlinePhrase,
  relativeDeadlineWords,
} from './deadline-words';

const BANNED = /\b(ensure[sd]?|guarantee[ds]?|approved|approval|cleared|accepted|promise[sd]?)\b/i;
const EM_DASH = String.fromCodePoint(0x2014);

describe('relativeDeadlineWords at the boundaries', () => {
  it('says today, tomorrow and yesterday in words', () => {
    expect(relativeDeadlineWords(0)).toBe('today');
    expect(relativeDeadlineWords(-0)).toBe('today');
    expect(relativeDeadlineWords(1)).toBe('tomorrow');
    expect(relativeDeadlineWords(-1)).toBe('yesterday');
  });

  it('counts days from two up to sixty, ahead and behind', () => {
    expect(relativeDeadlineWords(2)).toBe('in 2 days');
    expect(relativeDeadlineWords(7)).toBe('in 7 days');
    expect(relativeDeadlineWords(8)).toBe('in 8 days');
    expect(relativeDeadlineWords(12)).toBe('in 12 days');
    expect(relativeDeadlineWords(30)).toBe('in 30 days');
    expect(relativeDeadlineWords(31)).toBe('in 31 days');
    expect(relativeDeadlineWords(60)).toBe('in 60 days');
    expect(relativeDeadlineWords(-2)).toBe('2 days ago');
    expect(relativeDeadlineWords(-3)).toBe('3 days ago');
    expect(relativeDeadlineWords(-30)).toBe('30 days ago');
    expect(relativeDeadlineWords(-60)).toBe('60 days ago');
  });

  it('rounds past two months and says so', () => {
    expect(relativeDeadlineWords(61)).toBe('in about 2 months');
    expect(relativeDeadlineWords(186)).toBe('in about 6 months');
    expect(relativeDeadlineWords(-61)).toBe('about 2 months ago');
    expect(relativeDeadlineWords(700)).toBe('in about 23 months');
  });

  it('moves to years from two years, never "1 years"', () => {
    expect(relativeDeadlineWords(730)).toBe('in about 2 years');
    expect(relativeDeadlineWords(1100)).toBe('in about 3 years');
    expect(relativeDeadlineWords(-1100)).toBe('about 3 years ago');
    for (const days of [716, 730, 731, 1000]) {
      expect(relativeDeadlineWords(days)).not.toMatch(/\b1 years\b/);
    }
  });
});

describe('deadlinePhrase', () => {
  it('words a document expiry, past only once the day has ended', () => {
    expect(deadlinePhrase('document_expires', 12)).toBe('Expires in 12 days');
    expect(deadlinePhrase('document_expires', 1)).toBe('Expires tomorrow');
    expect(deadlinePhrase('document_expires', 0)).toBe('Expires today');
    expect(deadlinePhrase('document_expires', -1)).toBe('Expired yesterday');
    expect(deadlinePhrase('document_expires', -3)).toBe('Expired 3 days ago');
  });

  it('words a task or a request as due', () => {
    for (const kind of ['task_due', 'request_due'] as const) {
      expect(deadlinePhrase(kind, 7)).toBe('Due in 7 days');
      expect(deadlinePhrase(kind, 0)).toBe('Due today');
      expect(deadlinePhrase(kind, -3)).toBe('Was due 3 days ago');
    }
  });

  it('words an appointment as taking place', () => {
    expect(deadlinePhrase('appointment', 25)).toBe('Takes place in 25 days');
    expect(deadlinePhrase('appointment', 0)).toBe('Takes place today');
    expect(deadlinePhrase('appointment', -2)).toBe('Took place 2 days ago');
  });
});

describe('the words never promise, approve or use a dash', () => {
  const everything = [
    ...Object.values(DEADLINE_TONE_WORDS),
    CHECK_THIS_DATE,
    ...Object.values(CHECK_THIS_DATE_WHY),
    ...[-90, -1, 0, 1, 7, 30, 90, 800, 4000].flatMap((days) =>
      (['document_expires', 'task_due', 'request_due', 'appointment'] as const).map((kind) =>
        deadlinePhrase(kind, days),
      ),
    ),
  ];
  it('uses none of the decision words', () => {
    for (const line of everything) expect(line, line).not.toMatch(BANNED);
  });
  it('has no em dash', () => {
    for (const line of everything) expect(line).not.toContain(EM_DASH);
  });
  it('names the four tones and the unsure tag in Title Case', () => {
    expect(DEADLINE_TONE_WORDS).toEqual({
      overdue: 'Overdue',
      soon: 'Within a Week',
      month: 'Within a Month',
      later: 'Later',
    });
    expect(CHECK_THIS_DATE).toBe('Check This Date');
  });
});
