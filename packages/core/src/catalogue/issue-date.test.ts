import { describe, expect, it } from 'vitest';
import { issueDateKeysFor, realIsoDay, resolveIssueDate } from './issue-date';

const NOW = new Date('2026-11-14T10:00:00Z');

describe('which issue date backs a detail', () => {
  it('is the passport issue date for a detail a passport carries', () => {
    expect(issueDateKeysFor('passport_number')).toEqual(['passport_issue_date']);
    expect(issueDateKeysFor('passport_expiry')).toEqual(['passport_issue_date']);
    expect(issueDateKeysFor('passport_issue_date')).toEqual(['passport_issue_date']);
  });

  it('is nothing for a detail no document type with an issue date carries', () => {
    expect(issueDateKeysFor('occupation')).toEqual([]);
    expect(issueDateKeysFor('nid_number')).toEqual([]);
    expect(issueDateKeysFor('not_a_field')).toEqual([]);
  });

  it('never points at an earlier passport or a repeating record', () => {
    for (const field of ['passport_number', 'given_name', 'nid_number']) {
      for (const key of issueDateKeysFor(field)) {
        expect(key.startsWith('historical_')).toBe(false);
      }
    }
  });
});

describe('real calendar days', () => {
  it('accepts only year-month-day that exists', () => {
    expect(realIsoDay('2024-03-12')).toBe('2024-03-12');
    expect(realIsoDay('2024-02-30')).toBeNull();
    expect(realIsoDay('12 MAR 2024')).toBeNull();
    expect(realIsoDay('2024-3-1')).toBeNull();
    expect(realIsoDay('')).toBeNull();
    expect(realIsoDay(null)).toBeNull();
  });
});

describe('what a document supports as its issue date', () => {
  it('is the one readable day', () => {
    expect(resolveIssueDate(['2024-03-12'], NOW)).toEqual({ status: 'found', date: '2024-03-12' });
  });

  it('counts the same day read twice once', () => {
    expect(resolveIssueDate(['2024-03-12', '2024-03-12'], NOW)).toEqual({
      status: 'found',
      date: '2024-03-12',
    });
  });

  it('says none when nothing or only blanks were read', () => {
    expect(resolveIssueDate([], NOW)).toEqual({ status: 'none' });
    expect(resolveIssueDate(['', null, '  '], NOW)).toEqual({ status: 'none' });
  });

  it('chooses none of two different days', () => {
    expect(resolveIssueDate(['2024-03-12', '2021-05-02'], NOW)).toEqual({ status: 'conflict' });
  });

  it('does not set aside an unreadable reading next to a readable one', () => {
    expect(resolveIssueDate(['2024-03-12', '12 MAR 2025'], NOW)).toEqual({ status: 'conflict' });
  });

  it('says unreadable for a date in words or a day that does not exist', () => {
    expect(resolveIssueDate(['12 MAR 2024'], NOW)).toEqual({ status: 'unreadable' });
    expect(resolveIssueDate(['2024-02-31'], NOW)).toEqual({ status: 'unreadable' });
  });

  it('refuses a day after today and accepts today', () => {
    expect(resolveIssueDate(['2026-11-15'], NOW)).toEqual({ status: 'future' });
    expect(resolveIssueDate(['2026-11-14'], NOW)).toEqual({ status: 'found', date: '2026-11-14' });
  });
});
