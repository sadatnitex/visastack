import { describe, expect, it } from 'vitest';
import {
  THREAD_WORDS,
  type ThreadDecision,
  type ThreadGroup,
  type ThreadInput,
  type ThreadSend,
  buildThread,
} from './thread-model';

const at = (day: number, hour = 10) => new Date(Date.UTC(2027, 0, day, hour));

const base = (over: Partial<ThreadInput> = {}): ThreadInput => ({
  viewer: 'traveller',
  request: {
    kind: 'DOCUMENT',
    status: 'OPEN',
    message: 'Please send your latest bank statement.',
    createdAt: at(1),
    respondedAt: null,
  },
  group: 'MISSING',
  decisions: { state: 'none' },
  sends: { state: 'none' },
  ...over,
});

const send = (over: Partial<ThreadSend> = {}): ThreadSend => ({
  id: 's1',
  title: 'statement.pdf',
  sentAt: at(2),
  state: 'AWAITING_DECISION',
  decidedAt: null,
  reason: null,
  ...over,
});

const sends = (...list: ThreadSend[]) =>
  ({ state: 'read', value: { available: true, submissions: list, legacy: [], older: 0 } }) as const;

describe('the words a request thread may use', () => {
  it('are exactly four, and none is a tick or a delivery mark', () => {
    expect([...THREAD_WORDS]).toEqual(['Sent', 'Received', 'Reviewed', 'Sent Back for a Fix']);
    for (const word of THREAD_WORDS) expect(word).not.toMatch(/[✓✔✅☑]|deliver|read/i);
  });
});

describe('the agency ask', () => {
  it('opens every thread, on the agency side, as Sent with its own time', () => {
    const [ask, ...rest] = buildThread(base()).messages;
    expect(ask).toMatchObject({ side: 'agency', word: 'Sent', at: at(1) });
    expect(ask?.text).toBe('Please send your latest bank statement.');
    expect(rest).toEqual([]);
  });

  it('says so plainly when the agency gave no reason', () => {
    const thread = buildThread(base({ request: { ...base().request, message: null } }));
    expect(thread.messages[0]?.text).toBe('The agency asked for this item.');
  });
});

describe('a reply that has only arrived is Received, never Reviewed', () => {
  it('reads Received for a send waiting for the agency', () => {
    const thread = buildThread(
      base({
        group: 'RECEIVED',
        request: { ...base().request, status: 'RECEIVED' },
        sends: sends(send()),
      }),
    );
    const reply = thread.messages[1];
    expect(reply).toMatchObject({ side: 'traveller', word: 'Received', at: at(2) });
    expect(reply?.text).toBe('You sent statement.pdf');
  });

  it('reads Sent while the file is still being checked', () => {
    const thread = buildThread(base({ group: 'PROCESSING', sends: sends(send()) }));
    expect(thread.messages[1]?.word).toBe('Sent');
  });

  it('never reads Reviewed for any status or group that is not an acceptance', () => {
    const groups: ThreadGroup[] = ['MISSING', 'PROCESSING', 'RECEIVED', 'NEEDS_CORRECTION', null];
    const statuses = ['OPEN', 'RECEIVED', 'UNDER_REVIEW', 'NEEDS_REPLACEMENT', 'CANCELLED'];
    for (const group of groups) {
      for (const status of statuses) {
        for (const kind of ['FIELD', 'DOCUMENT'] as const) {
          const input = base({
            group,
            request: { ...base().request, kind, status, respondedAt: at(2) },
            sends: sends(send()),
          });
          for (const m of buildThread(input).messages) {
            expect(m.word, `${group}/${status}/${kind}`).not.toBe('Reviewed');
          }
          const fallback = buildThread({ ...input, sends: { state: 'none' } });
          for (const m of fallback.messages) expect(m.word).not.toBe('Reviewed');
        }
      }
    }
  });
});

describe('a reviewed reply', () => {
  it('reads Reviewed, with the time of the review, only after an acceptance', () => {
    const thread = buildThread(
      base({
        group: 'REVIEWED',
        request: { ...base().request, status: 'ACCEPTED' },
        sends: sends(send({ state: 'ACCEPTED', decidedAt: at(3) })),
      }),
    );
    expect(thread.messages[1]).toMatchObject({ word: 'Reviewed', at: at(2), wordAt: at(3) });
  });
});

describe('a reply sent back for a fix', () => {
  const sentBack = send({
    state: 'NEEDS_REPLACEMENT',
    decidedAt: at(3),
    reason: 'The photo is blurred.',
  });

  it('reads Sent Back for a Fix and carries the reason as the agency speaking', () => {
    const thread = buildThread(
      base({
        group: 'NEEDS_CORRECTION',
        request: { ...base().request, status: 'NEEDS_REPLACEMENT' },
        sends: sends(sentBack),
      }),
    );
    expect(thread.messages.map((m) => [m.side, m.word])).toEqual([
      ['agency', 'Sent'],
      ['traveller', 'Sent Back for a Fix'],
      ['agency', 'Sent'],
    ]);
    expect(thread.messages[2]?.text).toBe('Replacement needed: The photo is blurred.');
    expect(thread.messages[2]?.at).toEqual(at(3));
  });

  it('keeps every round in order with its own time', () => {
    const thread = buildThread(
      base({
        group: 'RECEIVED',
        request: { ...base().request, status: 'RECEIVED' },
        sends: sends(sentBack, send({ id: 's2', title: 'clear.pdf', sentAt: at(4) })),
      }),
    );
    expect(thread.messages.map((m) => m.id)).toEqual(['ask', 'send-s1', 'reason-s1', 'send-s2']);
    expect(thread.messages[3]).toMatchObject({ word: 'Received', at: at(4) });
  });

  it('says so when the agency gave no reason', () => {
    const thread = buildThread(
      base({
        group: 'NEEDS_CORRECTION',
        sends: sends(send({ state: 'CORRECTION_PROPOSED', decidedAt: at(3), reason: null })),
      }),
    );
    expect(thread.messages[2]?.text).toBe('The agency sent this back. No reason was given.');
  });
});

describe('rounds decided before exact copies were kept', () => {
  it('stay in the conversation, before the exact sends, with the reason recorded at the time', () => {
    const thread = buildThread(
      base({
        group: 'RECEIVED',
        request: { ...base().request, status: 'RECEIVED' },
        decisions: {
          state: 'read',
          value: [{ outcome: 'NEEDS_REPLACEMENT', reason: 'Too old.', createdAt: at(3) }],
        },
        sends: {
          state: 'read',
          value: {
            available: true,
            submissions: [send({ id: 's2', sentAt: at(5) })],
            legacy: [{ sentAt: null, state: 'NEEDS_REPLACEMENT', decidedAt: at(3) }],
            older: 0,
          },
        },
      }),
    );
    expect(thread.messages.map((m) => [m.id, m.word])).toEqual([
      ['ask', 'Sent'],
      ['legacy-0', 'Sent Back for a Fix'],
      ['legacy-reason-0', 'Sent'],
      ['send-s2', 'Received'],
    ]);
    expect(thread.messages[2]?.text).toBe('Replacement needed: Too old.');
    expect(thread.note).toBe('times-not-kept');
  });
});

describe('when no exact send times exist', () => {
  const decision = (over: Partial<ThreadDecision>): ThreadDecision => ({
    outcome: 'NEEDS_REPLACEMENT',
    reason: 'Too old.',
    createdAt: at(3),
    ...over,
  });

  it('builds a detail request from its decisions and the current reply', () => {
    const thread = buildThread(
      base({
        request: { ...base().request, kind: 'FIELD', status: 'RECEIVED', respondedAt: at(5) },
        group: 'RECEIVED',
        decisions: { state: 'read', value: [decision({})] },
      }),
    );
    expect(thread.messages.map((m) => [m.id, m.word])).toEqual([
      ['ask', 'Sent'],
      ['reply-0', 'Sent Back for a Fix'],
      ['reason-0', 'Sent'],
      ['reply-current', 'Received'],
    ]);
    expect(thread.messages[1]?.text).toBe('You sent a detail');
    expect(thread.note).toBe('times-not-kept');
  });

  it('does not repeat a reply that a later decision already covers', () => {
    const thread = buildThread(
      base({
        request: { ...base().request, status: 'ACCEPTED', respondedAt: at(2) },
        group: 'REVIEWED',
        decisions: { state: 'read', value: [decision({ outcome: 'ACCEPTED', reason: null })] },
      }),
    );
    expect(thread.messages.filter((m) => m.side === 'traveller')).toHaveLength(1);
    expect(thread.messages[1]).toMatchObject({ word: 'Reviewed', wordAt: at(3) });
  });

  it('says the history could not be loaded, never that there is none', () => {
    const thread = buildThread(
      base({
        group: 'RECEIVED',
        request: { ...base().request, status: 'RECEIVED', respondedAt: at(2) },
        decisions: { state: 'unread' },
        sends: { state: 'unread' },
      }),
    );
    expect(thread.note).toBe('unread');
    expect(thread.messages[1]).toMatchObject({ word: 'Received', at: at(2) });
  });

  it('reads a request marked sent back as Sent Back for a Fix even when its decision was not read', () => {
    const thread = buildThread(
      base({
        group: 'NEEDS_CORRECTION',
        request: {
          ...base().request,
          kind: 'FIELD',
          status: 'NEEDS_REPLACEMENT',
          respondedAt: at(4),
        },
      }),
    );
    const reply = thread.messages.find((m) => m.side === 'traveller');
    expect(reply).toMatchObject({ word: 'Sent Back for a Fix', at: at(4) });
  });

  it('keeps a sent file the agency has only received as Received even when the file failed its checks', () => {
    const thread = buildThread(
      base({
        group: 'NEEDS_CORRECTION',
        request: { ...base().request, status: 'RECEIVED', respondedAt: at(4) },
      }),
    );
    expect(thread.messages.find((m) => m.side === 'traveller')?.word).toBe('Received');
  });

  it('adds no note to a request nothing was read for', () => {
    expect(buildThread(base()).note).toBeNull();
  });
});

describe('review fixes', () => {
  const decision = (over: Partial<ThreadDecision>): ThreadDecision => ({
    outcome: 'ACCEPTED',
    reason: null,
    createdAt: at(3),
    ...over,
  });

  it('gives the decided reply the time the request kept for it', () => {
    const thread = buildThread(
      base({
        group: 'REVIEWED',
        request: { ...base().request, kind: 'FIELD', status: 'ACCEPTED', respondedAt: at(2) },
        decisions: { state: 'read', value: [decision({})] },
      }),
    );
    expect(thread.messages[1]).toMatchObject({ word: 'Reviewed', at: at(2), wordAt: at(3) });
    expect(thread.note).toBeNull();
  });

  it('does not give an older decided round a time that belongs to a later reply', () => {
    const thread = buildThread(
      base({
        group: 'RECEIVED',
        request: { ...base().request, kind: 'FIELD', status: 'RECEIVED', respondedAt: at(5) },
        decisions: {
          state: 'read',
          value: [decision({ outcome: 'NEEDS_REPLACEMENT', reason: 'No.' })],
        },
      }),
    );
    expect(thread.messages.find((m) => m.id === 'reply-0')?.at).toBeNull();
    expect(thread.messages.find((m) => m.id === 'reply-current')?.at).toEqual(at(5));
  });

  it('words a contradiction for the traveller as their profile, and for the agency as the profile', () => {
    const input = (viewer: 'traveller' | 'agency') =>
      buildThread(
        base({
          viewer,
          group: 'NEEDS_CORRECTION',
          request: {
            ...base().request,
            kind: 'FIELD',
            status: 'NEEDS_REPLACEMENT',
            respondedAt: at(2),
          },
          decisions: {
            state: 'read',
            value: [decision({ outcome: 'CONTRADICTION', reason: 'Name differs.' })],
          },
        }),
      ).messages.find((m) => m.id === 'reason-0')?.text;
    expect(input('traveller')).toBe('Contradicts your profile: Name differs.');
    expect(input('agency')).toBe('Contradicts the profile: Name differs.');
  });

  it('puts a waiting send that was never pinned after the exact sends, not before them', () => {
    const thread = buildThread(
      base({
        group: 'RECEIVED',
        request: { ...base().request, status: 'RECEIVED' },
        sends: {
          state: 'read',
          value: {
            available: true,
            submissions: [
              send({ state: 'NEEDS_REPLACEMENT', decidedAt: at(3), reason: 'Blurred.' }),
            ],
            legacy: [{ sentAt: at(5), state: 'AWAITING_DECISION', decidedAt: null }],
            older: 0,
          },
        },
      }),
    );
    expect(thread.messages.map((m) => m.id)).toEqual([
      'ask',
      'send-s1',
      'reason-s1',
      'legacy-waiting-0',
    ]);
    expect(thread.messages[3]).toMatchObject({ word: 'Received', at: at(5) });
  });

  it('says only the latest reply is shown when no history was asked for on an answered request', () => {
    const thread = buildThread(
      base({
        viewer: 'agency',
        group: 'RECEIVED',
        request: { ...base().request, kind: 'FIELD', status: 'RECEIVED', respondedAt: at(4) },
      }),
    );
    expect(thread.note).toBe('latest-only');
    expect(buildThread(base()).note).toBeNull();
  });
});

describe('older sends that were not read', () => {
  it('says how many are left out and never pretends the list is whole', () => {
    const thread = buildThread(
      base({
        group: 'RECEIVED',
        sends: {
          state: 'read',
          value: { available: true, submissions: [send()], legacy: [], older: 3 },
        },
      }),
    );
    expect(thread.olderSends).toBe(3);
    expect(buildThread(base()).olderSends).toBe(0);
  });
});

describe('the agency view', () => {
  it('names the traveller instead of saying You', () => {
    const thread = buildThread(
      base({
        viewer: 'agency',
        travellerName: 'Karim',
        group: 'RECEIVED',
        sends: sends(send()),
      }),
    );
    expect(thread.messages[1]?.text).toBe('Karim sent statement.pdf');
  });
});

describe('a cancelled request', () => {
  it('ends with the agency saying so, at the time of the cancellation when it is known', () => {
    const thread = buildThread(
      base({
        group: null,
        request: { ...base().request, status: 'CANCELLED' },
        decisions: {
          state: 'read',
          value: [{ outcome: 'CANCELLED', reason: null, createdAt: at(6) }],
        },
      }),
    );
    const last = thread.messages[thread.messages.length - 1];
    expect(last).toMatchObject({ side: 'agency', word: 'Sent', at: at(6) });
    expect(last?.text).toBe('The agency cancelled this request. Nothing is needed.');
  });
});
