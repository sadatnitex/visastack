import { referenceCheckCharacter } from '@visastack/core';
import { describe, expect, it } from 'vitest';
import {
  CHASE_AFTER_DAYS,
  CHASE_LABEL,
  type DoNextCase,
  type DoNextInput,
  type DoNextRequest,
  buildDoNext,
} from './do-next';

const NOW = new Date('2026-10-25T09:00:00.000Z');
const day = (offset: number) => new Date(Date.UTC(2026, 9, 25 + offset)).toISOString(); // a date-only value, UTC midnight

const caseRow = (overrides: Partial<DoNextCase> & Pick<DoNextCase, 'missionId'>): DoNextCase => ({
  applicantId: `ap-${overrides.missionId}`,
  applicantName: `Traveller ${overrides.missionId}`,
  title: `Case ${overrides.missionId}`,
  state: 'INTAKE',
  createdAt: '2026-09-01T00:00:00.000Z',
  assignments: [{ memberAccountId: 'acct-2', memberEmail: 'colleague@agency.test' }],
  tasks: [],
  ...overrides,
});

const requestRow = (
  overrides: Partial<DoNextRequest> & Pick<DoNextRequest, 'id'>,
): DoNextRequest => ({
  applicantId: 'ap-m1',
  applicantName: 'Traveller m1',
  missionId: 'm1',
  kind: 'DOCUMENT',
  docType: 'BANK_STATEMENT',
  fieldKey: null,
  message: null,
  status: 'OPEN',
  dueDate: null,
  respondedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  requestedByAccountId: 'acct-1',
  ...overrides,
});

const input = (overrides: Partial<DoNextInput>): DoNextInput => ({
  admin: true,
  viewerAccountId: 'acct-1',
  cases: [],
  requests: [],
  applicantWide: 'all',
  members: [
    { accountId: 'acct-1', email: 'me@agency.test' },
    { accountId: 'acct-2', email: 'colleague@agency.test' },
  ],
  organizationName: 'Harbor Travel Partners',
  base: '/app/agency/o1',
  now: NOW,
  ...overrides,
});

describe('Do next ranking (ADR-0015)', () => {
  const cases = [
    caseRow({ missionId: 'm1' }),
    caseRow({
      missionId: 'm2',
      tasks: [{ status: 'OPEN', dueDate: day(-2), assigneeAccountId: 'acct-1' }],
    }),
    caseRow({
      missionId: 'm3',
      tasks: [
        { status: 'IN_PROGRESS', dueDate: day(-9), assigneeAccountId: null },
        { status: 'OPEN', dueDate: day(-1), assigneeAccountId: null },
      ],
    }),
    caseRow({ missionId: 'm4', assignments: [], createdAt: '2026-08-01T00:00:00.000Z' }),
    caseRow({ missionId: 'm5', assignments: [], createdAt: '2026-07-01T00:00:00.000Z' }),
  ];
  const requests = [
    requestRow({ id: 'r-due-late', dueDate: day(-3) }),
    requestRow({ id: 'r-due-early', dueDate: day(-10), status: 'NEEDS_REPLACEMENT' }),
    requestRow({ id: 'r-not-yet', dueDate: day(4) }),
    requestRow({ id: 'r-today', dueDate: day(0) }),
    requestRow({ id: 'r-no-date' }),
    requestRow({ id: 'r-received', status: 'RECEIVED', respondedAt: '2026-10-20T10:00:00.000Z' }),
    requestRow({ id: 'r-review', status: 'UNDER_REVIEW', createdAt: '2026-09-15T00:00:00.000Z' }),
    requestRow({ id: 'r-accepted', status: 'ACCEPTED' }),
    requestRow({ id: 'r-cancelled', status: 'CANCELLED', dueDate: day(-30) }),
    requestRow({ id: 'r-legacy', status: 'DECLINED', dueDate: day(-30) }),
  ];

  it('orders the four rows as approved: past due then long-quiet with no due date, waiting for review, overdue tasks, no owner', () => {
    const items = buildDoNext(input({ cases, requests }));
    expect(items.map((item) => [item.tier, item.key])).toEqual([
      [1, 'request:r-due-early'],
      [1, 'request:r-due-late'],
      [1, 'request:r-no-date'],
      [2, 'request:r-review'],
      [2, 'request:r-received'],
      [3, 'case:m3'],
      [3, 'case:m2'],
      [4, 'case:m5'],
      [4, 'case:m4'],
    ]);
  });

  it('gives each item an owner, a reason and exactly one action', () => {
    const items = buildDoNext(input({ cases, requests }));
    const byKey = new Map(items.map((item) => [item.key, item]));
    const early = byKey.get('request:r-due-early');
    expect(early?.owner).toBe('colleague@agency.test');
    expect(early?.reason).toMatch(/^Sent back for a fix and was due .+\. No new version yet\.$/);
    expect(early?.action.kind).toBe('follow-up');
    expect(early?.action.label).toBe('Review Follow-Up Message');
    expect(byKey.get('request:r-due-late')?.reason).toMatch(/^Was due .+ and has not arrived\.$/);
    const received = byKey.get('request:r-received');
    expect(received?.reason).toMatch(/^Received .+ and waiting for review\.$/);
    expect(received?.action).toEqual({
      kind: 'link',
      label: 'Review Item',
      href: '/app/agency/o1/clients#request-r-received',
    });
    expect(byKey.get('case:m2')?.owner).toBe('You');
    expect(byKey.get('case:m3')?.owner).toBe('colleague@agency.test');
    expect(byKey.get('case:m3')?.reason).toMatch(/^2 tasks are past due\. The oldest was due /);
    expect(byKey.get('case:m3')?.action).toEqual({
      kind: 'link',
      label: 'Open Case',
      href: '/app/agency/o1/cases#mission-m3',
    });
    expect(byKey.get('case:m4')?.owner).toBe('Nobody assigned');
    expect(byKey.get('case:m4')?.action.label).toBe('Assign Someone');
  });

  it('breaks ties by oldest created, then by title, and gives the same order for any input order', () => {
    const tied = [
      requestRow({
        id: 'r-b',
        dueDate: day(-5),
        docType: 'PASSPORT',
        createdAt: '2026-10-02T00:00:00.000Z',
      }),
      requestRow({
        id: 'r-a',
        dueDate: day(-5),
        docType: 'PASSPORT',
        createdAt: '2026-10-03T00:00:00.000Z',
      }),
      requestRow({
        id: 'r-c',
        dueDate: day(-5),
        docType: 'BANK_STATEMENT',
        createdAt: '2026-10-03T00:00:00.000Z',
      }),
    ];
    const order = (list: readonly DoNextRequest[]) =>
      buildDoNext(input({ cases: [caseRow({ missionId: 'm1' })], requests: list })).map(
        (i) => i.key,
      );
    expect(order(tied)).toEqual(['request:r-b', 'request:r-c', 'request:r-a']);
    expect(order([...tied].reverse())).toEqual(order(tied));
    expect(order([tied[2], tied[0], tied[1]].filter((r) => r !== undefined))).toEqual(order(tied));
    const sameDayCases = [
      caseRow({ missionId: 'mb', title: 'Beta', assignments: [] }),
      caseRow({ missionId: 'ma', title: 'Alpha', assignments: [] }),
    ];
    expect(buildDoNext(input({ cases: sameDayCases })).map((i) => i.heading)).toEqual([
      'Alpha',
      'Beta',
    ]);
  });

  it('gives a member who is not an administrator no request items and no unassigned rows, without an error', () => {
    const items = buildDoNext(input({ admin: false, cases, requests }));
    expect(items.every((item) => item.tier === 3)).toBe(true);
    expect(items.map((item) => item.key)).toEqual(['case:m3', 'case:m2']);
    expect(buildDoNext(input({ admin: false, cases: [], requests: [] }))).toEqual([]);
  });

  it('never shows an item for a case that is not in view, and leaves out closed cases', () => {
    const items = buildDoNext(
      input({
        cases: [
          caseRow({ missionId: 'm1', state: 'SUBMITTED', assignments: [] }),
          caseRow({
            missionId: 'm2',
            state: 'CLOSED',
            tasks: [{ status: 'OPEN', dueDate: day(-3) }],
          }),
        ],
        requests: [
          requestRow({ id: 'r-closed-case', missionId: 'm1', dueDate: day(-3) }),
          requestRow({ id: 'r-hidden-case', missionId: 'm-other', dueDate: day(-3) }),
        ],
      }),
    );
    expect(items).toEqual([]);
  });

  it('shows a request made for the traveller in general once, and only for a traveller in view when the page is narrowed', () => {
    const wide = requestRow({
      id: 'r-wide',
      missionId: null,
      applicantId: 'ap-x',
      applicantName: 'Nusrat Jahan',
      dueDate: day(-2),
    });
    const all = buildDoNext(input({ cases: [caseRow({ missionId: 'm1' })], requests: [wide] }));
    expect(all.map((i) => [i.key, i.caseTitle, i.traveller, i.owner])).toEqual([
      ['request:r-wide', null, 'Nusrat Jahan', 'You'],
    ]);
    expect(
      buildDoNext(
        input({
          cases: [caseRow({ missionId: 'm1' })],
          requests: [wide],
          applicantWide: 'travellers-in-view',
        }),
      ),
    ).toEqual([]);
  });

  it('builds the follow-up message from the request with no ids or links in it', () => {
    const [item] = buildDoNext(
      input({
        cases: [
          caseRow({ missionId: 'm1', applicantName: 'Rahim Uddin', title: 'UK Standard Visitor' }),
        ],
        requests: [
          requestRow({
            id: 'r1',
            applicantName: 'Rahim Uddin',
            dueDate: day(-3),
            message: 'Use https://x.test/u?t=1',
          }),
        ],
      }),
    );
    if (item?.action.kind !== 'follow-up') throw new Error('expected a follow-up action');
    expect(item.action.message.agencyNoteLeftOut).toBe(true);
    expect(item.action.message.text).not.toMatch(/r1|m1|ap-m1|https?:|@/);
    expect(item.action.message.text).toContain('What we need: Bank Statement');
  });

  it('names the request by its visible code when it has one (ADR 0018)', () => {
    const build = (referenceCode?: string) => {
      const [item] = buildDoNext(
        input({
          cases: [caseRow({ missionId: 'm1', applicantName: 'Rahim Uddin' })],
          requests: [
            requestRow({
              id: 'r1',
              applicantName: 'Rahim Uddin',
              dueDate: day(-3),
              ...(referenceCode ? { referenceCode } : {}),
            }),
          ],
        }),
      );
      if (item?.action.kind !== 'follow-up') throw new Error('expected a follow-up action');
      return item.action.message.text;
    };
    // 00 is never issued, so this example can never name a real request.
    const code = `R-00K2Q${referenceCheckCharacter('R', '00K2Q')}`;
    expect(build(code)).toContain(`Request reference: ${code}`);
    expect(build()).not.toContain('Request reference');
  });
});

describe('Do next uses the answered file and the calendar-day rule (WP-V4 review)', () => {
  const cases = [caseRow({ missionId: 'm1' })];

  it('keeps a received item whose newest file is unsafe, gone or still being checked out of the review row', () => {
    const items = buildDoNext(
      input({
        cases,
        requests: [
          requestRow({
            id: 'r-quarantined',
            status: 'RECEIVED',
            respondingDocumentState: {
              processingStatus: 'NEEDS_ATTENTION',
              safetyStatus: 'QUARANTINED',
            },
          }),
          requestRow({ id: 'r-erased', status: 'UNDER_REVIEW', respondingDocumentState: null }),
          requestRow({
            id: 'r-processing',
            status: 'RECEIVED',
            respondingDocumentState: { processingStatus: 'SCANNING', safetyStatus: 'PENDING' },
          }),
          requestRow({
            id: 'r-clean',
            status: 'RECEIVED',
            respondingDocumentState: { processingStatus: 'AWAITING_REVIEW', safetyStatus: 'CLEAN' },
          }),
        ],
      }),
    );
    expect(items.map((item) => item.key)).toEqual(['request:r-clean']);
  });

  it('lists an unusable file that is past due as a past-due item asking for a new version', () => {
    const [item] = buildDoNext(
      input({
        cases,
        requests: [
          requestRow({
            id: 'r-bad',
            status: 'RECEIVED',
            dueDate: day(-2),
            respondingDocumentState: null,
          }),
        ],
      }),
    );
    expect(item?.tier).toBe(1);
    expect(item?.reason).toMatch(/^The file sent could not be used and it was due /);
    if (item?.action.kind !== 'follow-up') throw new Error('expected a follow-up action');
    expect(item.action.message.text).toContain('needs a new version');
  });

  it('puts one request in every real status where the shared groups say: traveller group in row 1, agency group in row 2, closed ones nowhere (owner decision D4)', () => {
    const statuses: DoNextRequest['status'][] = [
      'OPEN',
      'RECEIVED',
      'UNDER_REVIEW',
      'ACCEPTED',
      'NEEDS_REPLACEMENT',
      'CANCELLED',
      'FULFILLED',
      'DECLINED',
    ];
    const items = buildDoNext(
      input({
        cases: [caseRow({ missionId: 'm1' })],
        requests: statuses.map((status) =>
          requestRow({ id: `r-${status}`, status, dueDate: day(-3) }),
        ),
      }),
    );
    const keysIn = (tier: number) =>
      items
        .filter((item) => item.tier === tier)
        .map((item) => item.key)
        .sort();
    expect(keysIn(1)).toEqual(['request:r-NEEDS_REPLACEMENT', 'request:r-OPEN']);
    expect(keysIn(2)).toEqual(['request:r-RECEIVED', 'request:r-UNDER_REVIEW']);
    expect(items).toHaveLength(4);
  });

  it('does not list a task due today as overdue, and lists it the day after', () => {
    const dueToday = [caseRow({ missionId: 'm1', tasks: [{ status: 'OPEN', dueDate: day(0) }] })];
    expect(buildDoNext(input({ cases: dueToday }))).toEqual([]);
    expect(
      buildDoNext(input({ cases: dueToday, now: new Date('2026-10-26T00:30:00.000Z') })).map(
        (item) => item.key,
      ),
    ).toEqual(['case:m1']);
  });
});

describe('Do next chases requests with no due date (owner decision, 10 Nov 2026)', () => {
  // The real clock, with sent times built from it, so no fixed calendar date can go stale.
  const clock = new Date();
  const DAY = 24 * 60 * 60 * 1000;
  const sentDaysAgo = (days: number): string =>
    new Date(clock.getTime() - days * DAY).toISOString();
  const open = (id: string, extra: Partial<DoNextRequest> = {}): DoNextRequest =>
    requestRow({ id, ...extra });
  const run = (requests: DoNextRequest[], extra: Partial<DoNextInput> = {}) =>
    buildDoNext(input({ cases: [caseRow({ missionId: 'm1' })], requests, now: clock, ...extra }));

  it('names the owner decision as one constant of three days', () => {
    expect(CHASE_AFTER_DAYS).toBe(3);
  });

  it('leaves a request with no due date alone at 2 days and lists it at 3', () => {
    expect(run([open('r-2', { createdAt: sentDaysAgo(CHASE_AFTER_DAYS - 1) })])).toEqual([]);
    const items = run([open('r-3', { createdAt: sentDaysAgo(CHASE_AFTER_DAYS) })]);
    expect(items).toHaveLength(1);
    expect(items[0]?.tier).toBe(1);
    expect(items[0]?.tierLabel).toBe(CHASE_LABEL);
    expect(items[0]?.reason).toBe('Sent 3 days ago with no due date. No reply yet.');
    expect(items[0]?.action.kind).toBe('follow-up');
  });

  it('puts chased requests after every overdue one, oldest sent first', () => {
    const items = run([
      open('r-chase-new', { createdAt: sentDaysAgo(4) }),
      open('r-chase-old', { createdAt: sentDaysAgo(20) }),
      open('r-overdue-recent', {
        createdAt: sentDaysAgo(30),
        dueDate: new Date(clock.getTime() - 2 * DAY).toISOString(),
      }),
      open('r-overdue-old', {
        createdAt: sentDaysAgo(1),
        dueDate: new Date(clock.getTime() - 9 * DAY).toISOString(),
      }),
      open('r-review', { status: 'RECEIVED', createdAt: sentDaysAgo(40) }),
    ]);
    expect(items.map((item) => [item.tier, item.key])).toEqual([
      [1, 'request:r-overdue-old'],
      [1, 'request:r-overdue-recent'],
      [1, 'request:r-chase-old'],
      [1, 'request:r-chase-new'],
      [2, 'request:r-review'],
    ]);
  });

  it('still follows the old rule for a request that has a due date', () => {
    const future = new Date(clock.getTime() + 5 * DAY).toISOString();
    expect(run([open('r-future', { dueDate: future, createdAt: sentDaysAgo(60) })])).toEqual([]);
    const past = new Date(clock.getTime() - 3 * DAY).toISOString();
    const items = run([open('r-past', { dueDate: past, createdAt: sentDaysAgo(1) })]);
    expect(items.map((item) => item.reason)).toEqual([
      expect.stringMatching(/^Was due .+ and has not arrived\.$/),
    ]);
  });

  it('does not chase a received, accepted, sent-back or closed request this way', () => {
    const old = sentDaysAgo(30);
    const statuses: DoNextRequest['status'][] = [
      'RECEIVED',
      'UNDER_REVIEW',
      'ACCEPTED',
      'NEEDS_REPLACEMENT',
      'CANCELLED',
    ];
    const items = run(statuses.map((status) => open(`r-${status}`, { status, createdAt: old })));
    expect(items.map((item) => [item.tier, item.key]).sort()).toEqual([
      [2, 'request:r-RECEIVED'],
      [2, 'request:r-UNDER_REVIEW'],
    ]);
    for (const item of items) expect(item.reason).not.toMatch(/no due date/);
  });

  it('counts whole days in the traveller time zone, not UTC', () => {
    // Sent 3 days back at 20:00 UTC, checked at 01:00 UTC: 3 whole days in UTC. In a zone 6 hours
    // ahead the sent moment is already 02:00 the next day, so only 2 days have passed there.
    const now = new Date(Date.UTC(2027, 5, 10, 1, 0));
    const sent = new Date(Date.UTC(2027, 5, 7, 20, 0)).toISOString();
    const at = (applicantTimezone: string) =>
      buildDoNext(
        input({
          cases: [caseRow({ missionId: 'm1' })],
          requests: [open('r-zone', { createdAt: sent, applicantTimezone })],
          now,
        }),
      ).length;
    expect(at('UTC')).toBe(1);
    expect(at('Asia/Dhaka')).toBe(0);
  });

  it('builds the same scrubbed follow-up message, with no due line', () => {
    const [item] = run([
      open('r-msg', {
        createdAt: sentDaysAgo(5),
        message: 'Please write to me at someone@example.com',
      }),
    ]);
    expect(item?.action.kind).toBe('follow-up');
    if (item?.action.kind !== 'follow-up') return;
    expect(item.action.message.agencyNoteLeftOut).toBe(true);
    expect(item.action.message.text).not.toContain('Due:');
    expect(item.action.message.text).not.toContain('@');
  });

  it('gives a non-administrator no chased items', () => {
    expect(run([open('r-3', { createdAt: sentDaysAgo(9) })], { admin: false })).toEqual([]);
  });
});
