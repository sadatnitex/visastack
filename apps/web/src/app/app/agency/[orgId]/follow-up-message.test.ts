import { describe, expect, it } from 'vitest';
import {
  type FollowUpInput,
  buildFollowUpMessage,
  containsUnsafeDetail,
} from './follow-up-message';

const NOW = new Date('2026-10-25T09:00:00.000Z');
const LONG_DASH = String.fromCodePoint(0x2014);
const EN_DASH = String.fromCodePoint(0x2013);

const base: FollowUpInput = {
  travellerName: 'Rahim Uddin',
  itemLabel: 'Bank Statement',
  kind: 'DOCUMENT',
  status: 'OPEN',
  dueDate: '2026-10-20T00:00:00.000Z',
  caseTitle: 'UK Standard Visitor',
  agencyNote: null,
  organizationName: 'Harbor Travel Partners',
  now: NOW,
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function expectClean(text: string) {
  expect(text).not.toMatch(UUID);
  expect(text).not.toMatch(/https?:|www\.|:\/\//i);
  expect(text).not.toContain('@');
  expect(text).not.toMatch(/\d{6,}/);
  expect(text).not.toContain(LONG_DASH);
  expect(text).not.toContain(EN_DASH);
  expect(containsUnsafeDetail(text)).toBe(false);
}

describe('follow-up message', () => {
  it('names what is needed, the case and the passed due date in plain words, with the standard body', () => {
    const message = buildFollowUpMessage(base);
    expect(message.text).toBe(
      [
        'Hello Rahim Uddin,',
        'We are still waiting for one document we asked you for.',
        'What we need: Bank Statement\nCase: UK Standard Visitor\nDue: 20 October 2026 (this date has passed)',
        'Please sign in to your account and add this document when you can. If something is stopping you, reply to this message and we will help.',
        'Thank you,\nHarbor Travel Partners',
      ].join('\n\n'),
    );
    expect(message.usedAgencyNote).toBe(false);
    expect(message.agencyNoteLeftOut).toBe(false);
    expectClean(message.text);
  });

  it('asks for a new version when the item was sent back, and for a detail when it is a field', () => {
    const sentBack = buildFollowUpMessage({ ...base, status: 'NEEDS_REPLACEMENT' });
    expect(sentBack.text).toContain(
      'One document you sent needs a new version before we can use it.',
    );
    expect(sentBack.text).toContain('What we need: Bank Statement (a new version)');
    const field = buildFollowUpMessage({ ...base, kind: 'FIELD', itemLabel: 'Home Address' });
    expect(field.text).toContain('one detail we asked you for');
    expect(field.text).toContain('fill in this detail');
  });

  it('uses the agency note as the body when it is safe, keeping its lines and swapping long dashes', () => {
    const message = buildFollowUpMessage({
      ...base,
      agencyNote: `Please send the last 6 months ${LONG_DASH} stamped by the bank.\n\nThanks for your patience.`,
    });
    expect(message.usedAgencyNote).toBe(true);
    expect(message.text).toContain(
      'Please send the last 6 months - stamped by the bank.\n\nThanks for your patience.',
    );
    expect(message.text).not.toContain('Please sign in to your account');
    expectClean(message.text);
  });

  it('leaves out a note that holds a link, an email address, an id or a long number, and says so', () => {
    for (const note of [
      'Upload here: https://vs.example.test/upload?token=abc',
      'See www.example.test for the form',
      'Use the form on example.com/form',
      'Email me at agent@example.test',
      'Your passport A12345678 expires soon',
      'Account 0123456789 statement please',
      'Call +880 1712 345678',
      'IBAN GB29 NWBK 6016 1331 9268 19',
      'Reference 3f2a1b9c-1d2e-4f50-8a6b-7c8d9e0f1a2b',
      // WP-V4 review cases: other digit forms, split numbers, and spelled-out emails.
      'Bangla digits \u09e6\u09e7\u09ed\u09e7\u09e8\u09e9\u09ea\u09eb\u09ec\u09ed\u09ee',
      'Full-width \uff10\uff11\uff17\uff11\uff12\uff13\uff14\uff15',
      'Passport A0123 4567 please',
      'Call (017) 1234 5678 today',
      'Account 0123/4567/89',
      'Account 0123_4567_89',
      'Account 01.23.45.67.89',
      'Account [0123] [4567] 89',
      'Card 1234 5678 9012 3456',
      'Write to rahim at gmail dot com',
      'Write to rahim(at)gmail(dot)com',
      'Write to rahim [at] mail [dot] org',
      'Write to rahim\uff20example.test',
      'See \uff57\uff57\uff57\uff0eexample\uff0etest',
    ]) {
      const message = buildFollowUpMessage({ ...base, agencyNote: note });
      expect(message.usedAgencyNote, note).toBe(false);
      expect(message.agencyNoteLeftOut, note).toBe(true);
      expect(message.text, note).toContain('Please sign in to your account');
      expectClean(message.text);
    }
  });

  it('keeps ordinary dates and small numbers in a note', () => {
    const message = buildFollowUpMessage({
      ...base,
      agencyNote: 'Bring 2 copies and the letter dated 10 December 2026, e.g. the signed one.',
    });
    expect(message.usedAgencyNote).toBe(true);
    // Eight digits close together are treated as a long number, even a date: the safe side.
    expect(containsUnsafeDetail('dated 10/12/2026')).toBe(true);
  });

  it('drops any other field holding an unsafe detail for a plain stand-in', () => {
    const message = buildFollowUpMessage({
      ...base,
      travellerName: 'rahim@example.test',
      itemLabel: 'Passport A12345678',
      caseTitle: 'Case 3f2a1b9c-1d2e-4f50-8a6b-7c8d9e0f1a2b',
      organizationName: 'agency.example.test',
    });
    expect(message.text.startsWith('Hello,\n\n')).toBe(true);
    expect(message.text).toContain('What we need: The document we asked for');
    expect(message.text).not.toContain('Case:');
    expect(message.text).toContain('Thank you,\nYour agency team');
    expectClean(message.text);
  });

  it('says today, a future date, or nothing at all when no due date was set', () => {
    expect(buildFollowUpMessage({ ...base, dueDate: '2026-10-25T00:00:00.000Z' }).text).toContain(
      'Due: today, 25 October 2026',
    );
    expect(buildFollowUpMessage({ ...base, dueDate: '2026-11-02T00:00:00.000Z' }).text).toContain(
      'Due: 2 November 2026\n',
    );
    expect(buildFollowUpMessage({ ...base, dueDate: null }).text).not.toContain('Due:');
  });

  it('swaps every long dash form for a hyphen', () => {
    for (const code of [0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0x2e3a, 0x2e3b, 0xfe58]) {
      const dash = String.fromCodePoint(code);
      const message = buildFollowUpMessage({
        ...base,
        caseTitle: `UK ${dash} Visitor`,
        agencyNote: `Six months ${dash} stamped.`,
      });
      expect(message.text, code.toString(16)).toContain('Case: UK - Visitor');
      expect(message.text, code.toString(16)).toContain('Six months - stamped.');
      expect(message.text, code.toString(16)).not.toContain(dash);
    }
  });

  it('swaps long dashes for hyphens in every field, not only in the note', () => {
    const message = buildFollowUpMessage({
      ...base,
      caseTitle: `UK ${LONG_DASH} Standard Visitor`,
      organizationName: `Harbor ${EN_DASH} Travel`,
      itemLabel: `Bank ${LONG_DASH} Statement`,
    });
    expect(message.text).toContain('Case: UK - Standard Visitor');
    expect(message.text).toContain('Harbor - Travel');
    expect(message.text).toContain('What we need: Bank - Statement');
    expectClean(message.text);
  });

  it('gives the same text for the same input', () => {
    expect(buildFollowUpMessage(base)).toEqual(buildFollowUpMessage({ ...base }));
  });
});
