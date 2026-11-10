import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { labelledAccessLogEventTypes } from './access-log-labels';
import {
  ACCESS_LOG_ANCHOR,
  RECENT_ACTIVITY_LIMIT,
  type RecentActivityEvent,
  activityPerson,
  recentActivityEntries,
  seeAllActivityHref,
} from './recent-activity';

const event = (seq: number, patch: Partial<RecentActivityEvent> = {}): RecentActivityEvent => ({
  seq,
  eventType: 'DOCUMENT_UPLOADED',
  actorEmail: 'me@example.com',
  result: 'ALLOWED',
  occurredAt: new Date(Date.UTC(2026, 10, 10, 8, seq)),
  agencyAi: null,
  ...patch,
});

describe('recentActivityEntries', () => {
  it('shows at most five events, newest first as given', () => {
    const events = Array.from({ length: 9 }, (_, index) => event(9 - index));
    const entries = recentActivityEntries(events, 'me@example.com');
    expect(entries).toHaveLength(RECENT_ACTIVITY_LIMIT);
    expect(RECENT_ACTIVITY_LIMIT).toBe(5);
    expect(entries.map((entry) => entry.id)).toEqual(['9', '8', '7', '6', '5']);
  });

  it('uses the Access Log words, never a raw code', () => {
    const [first] = recentActivityEntries([event(1)], 'me@example.com');
    expect(first?.what).toBe('File Uploaded');
    const [unknown] = recentActivityEntries(
      [event(2, { eventType: 'SOMETHING_NEW_HAPPENED' })],
      'me@example.com',
    );
    expect(unknown?.what).not.toMatch(/_/);
    for (const type of labelledAccessLogEventTypes()) {
      const [entry] = recentActivityEntries([event(3, { eventType: type })], 'me@example.com');
      expect(entry?.what, type).not.toMatch(/_/);
    }
  });

  it('says You for the person, names someone else, and System when nobody is recorded', () => {
    const [mine, other, system] = recentActivityEntries(
      [event(1), event(2, { actorEmail: 'agent@agency.example' }), event(3, { actorEmail: null })],
      'ME@example.com',
    );
    expect(mine?.who).toBe('You');
    expect(other?.who).toBe('agent@agency.example');
    expect(system?.who).toBe('System');
  });

  it('marks a refused attempt as blocked and words an agency AI read with the agency', () => {
    const [blocked, ai] = recentActivityEntries(
      [
        event(1, { result: 'DENIED' }),
        event(2, { agencyAi: { agencyName: 'Blue Door Travel', appHost: 'chat.example.com' } }),
      ],
      'me@example.com',
    );
    expect(blocked?.blocked).toBe(true);
    expect(ai?.what).toContain('Blue Door Travel');
  });

  it('gives each entry a machine-readable time and a human one', () => {
    const [entry] = recentActivityEntries([event(1)], 'me@example.com');
    expect(entry?.at).toBe('2026-11-10T08:01:00.000Z');
    expect(entry?.when).toMatch(/2026/);
  });
});

describe('whose activity Home shows', () => {
  it("prefers the person's own record, else the first person", () => {
    const people = [
      { id: 'a', relationship: 'CHILD' },
      { id: 'b', relationship: 'SELF' },
    ];
    expect(activityPerson(people)?.id).toBe('b');
    expect(activityPerson(people.slice(0, 1))?.id).toBe('a');
    expect(activityPerson([])).toBeUndefined();
  });
});

describe('See All', () => {
  it('leads to the Access Log section of the Sharing page, and that section has the anchor', () => {
    expect(seeAllActivityHref('p1')).toBe('/app/applicant/p1/sharing#access-log');
    const sharing = readFileSync(
      resolve(__dirname, '../app/app/applicant/[id]/sharing/page.tsx'),
      'utf8',
    );
    expect(sharing).toContain(`const LOG_ANCHOR = '${ACCESS_LOG_ANCHOR}'`);
    expect(sharing).toContain('id={LOG_ANCHOR}');
  });
});
