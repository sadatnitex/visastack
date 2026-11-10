/**
 * One evidence request as a short conversation: the agency's ask on one side, the traveller's
 * replies on the other, each with a time and an honest state in WORDS (owner, 10 Nov 2026,
 * familiar pattern F3). This module is pure: it decides what is said, by whom, when, and in which
 * of four words. It draws nothing.
 *
 * The four words are all there is (`THREAD_WORDS`). There is no tick and no "delivered": a reply
 * that has only arrived reads Received, and it reads Reviewed only when the agency recorded an
 * acceptance. Received is never Reviewed.
 */

export const THREAD_WORDS = ['Sent', 'Received', 'Reviewed', 'Sent Back for a Fix'] as const;
export type ThreadWord = (typeof THREAD_WORDS)[number];

export type ThreadSide = 'agency' | 'traveller';

/** The five groups the agency's own summary uses (`evidenceRequestTriageGroup`), or null when closed. */
export type ThreadGroup =
  | 'MISSING'
  | 'PROCESSING'
  | 'RECEIVED'
  | 'NEEDS_CORRECTION'
  | 'REVIEWED'
  | null;

/** What a read produced. A read that failed is `unread`, never `none`: absence is not failure. */
export type ThreadRead<T> =
  | { readonly state: 'read'; readonly value: T }
  | { readonly state: 'unread' }
  | { readonly state: 'none' };

export type ThreadOutcome =
  | 'ACCEPTED'
  | 'NEEDS_REPLACEMENT'
  | 'CONTRADICTION'
  | 'CORRECTION_PROPOSED'
  | 'CANCELLED';

export interface ThreadDecision {
  readonly outcome: ThreadOutcome;
  readonly reason: string | null;
  readonly createdAt: Date;
}

export type ThreadSendState =
  | 'AWAITING_DECISION'
  | 'ACCEPTED'
  | 'NEEDS_REPLACEMENT'
  | 'CONTRADICTION'
  | 'CORRECTION_PROPOSED'
  | 'WITHDRAWN';

/** One exact send, from the list of sends of a document request (oldest first). */
export interface ThreadSend {
  readonly id: string;
  readonly title: string;
  readonly sentAt: Date;
  readonly state: ThreadSendState;
  readonly decidedAt: Date | null;
  readonly reason: string | null;
}

/** A send and decision recorded before exact copies were kept: its state and decision time, never its file. */
export interface ThreadLegacySend {
  readonly sentAt: Date | null;
  readonly state: Exclude<ThreadSendState, 'WITHDRAWN'>;
  readonly decidedAt: Date | null;
}

export interface ThreadSendList {
  /** False before the exact copies were kept: the sends below are then empty. */
  readonly available: boolean;
  readonly submissions: readonly ThreadSend[];
  readonly legacy: readonly ThreadLegacySend[];
  /** Sends before the ones listed, which were not read (the newest only are). */
  readonly older: number;
}

/** The list of sends the service returns, reduced to what a thread needs (no file or scan data). */
export function toThreadSendList(
  list: {
    readonly available: boolean;
    readonly submissions: readonly (ThreadSend & object)[];
    readonly legacy: readonly ThreadLegacySend[];
  },
  older = 0,
): ThreadSendList {
  return {
    older,
    available: list.available,
    submissions: list.submissions.map((s) => ({
      id: s.id,
      title: s.title,
      sentAt: s.sentAt,
      state: s.state,
      decidedAt: s.decidedAt,
      reason: s.reason,
    })),
    legacy: list.legacy.map((l) => ({ sentAt: l.sentAt, state: l.state, decidedAt: l.decidedAt })),
  };
}

export interface ThreadInput {
  /** Who is reading: their own words sit on the right. */
  readonly viewer: ThreadSide;
  /** How the agency refers to the traveller ("Karim"); the traveller's own view says "You". */
  readonly travellerName?: string;
  readonly request: {
    readonly kind: 'FIELD' | 'DOCUMENT';
    readonly status: string;
    readonly message: string | null;
    readonly createdAt: Date | null;
    readonly respondedAt: Date | null;
  };
  readonly group: ThreadGroup;
  readonly decisions: ThreadRead<readonly ThreadDecision[]>;
  readonly sends: ThreadRead<ThreadSendList>;
}

export interface ThreadMessage {
  readonly id: string;
  readonly side: ThreadSide;
  readonly text: string;
  /** When it was sent; null when the time was not kept. */
  readonly at: Date | null;
  readonly word: ThreadWord;
  /** When the state was reached (the review), when that is a different moment from `at`. */
  readonly wordAt: Date | null;
}

export interface Thread {
  readonly messages: readonly ThreadMessage[];
  /** How many older sends are not shown here (only the newest sends are read). */
  readonly olderSends: number;
  /**
   * `unread`: the earlier history could not be loaded (never "there is none").
   * `times-not-kept`: some sends were made before their times were recorded.
   * `latest-only`: nothing but the current state of the request was read, so earlier rounds
   * (and the reasons the agency gave) are not shown.
   */
  readonly note: 'unread' | 'times-not-kept' | 'latest-only' | null;
}

/** The prefix that tells which of the review outcomes a reason belongs to. */
const REASON_PREFIX: Readonly<Record<ThreadSide, Readonly<Record<string, string>>>> = {
  traveller: {
    NEEDS_REPLACEMENT: 'Replacement needed: ',
    CONTRADICTION: 'Contradicts your profile: ',
    CORRECTION_PROPOSED: 'Suggested correction: ',
  },
  agency: {
    NEEDS_REPLACEMENT: 'Replacement needed: ',
    CONTRADICTION: 'Contradicts the profile: ',
    CORRECTION_PROPOSED: 'Suggested correction: ',
  },
};

const SENT_BACK: ReadonlySet<string> = new Set([
  'NEEDS_REPLACEMENT',
  'CONTRADICTION',
  'CORRECTION_PROPOSED',
]);

/** The word of a reply that has no recorded decision, from where the request stands now. */
function openWord(group: ThreadGroup): ThreadWord {
  // A file still being checked has only been sent. Once it is in the agency's hands it is Received.
  return group === 'PROCESSING' ? 'Sent' : 'Received';
}

function decidedWord(outcome: string): ThreadWord {
  if (outcome === 'ACCEPTED') return 'Reviewed';
  return SENT_BACK.has(outcome) ? 'Sent Back for a Fix' : 'Received';
}

export function buildThread(input: ThreadInput): Thread {
  const { request, viewer } = input;
  const who = viewer === 'traveller' ? 'You' : (input.travellerName ?? 'The traveller');
  const noun = request.kind === 'FIELD' ? 'a detail' : 'a file';
  const messages: ThreadMessage[] = [];
  const add = (message: ThreadMessage) => messages.push(message);

  add({
    id: 'ask',
    side: 'agency',
    text: request.message?.trim() || 'The agency asked for this item.',
    at: request.createdAt,
    word: 'Sent',
    wordAt: null,
  });

  const decisions: readonly ThreadDecision[] =
    input.decisions.state === 'read'
      ? [...input.decisions.value].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      : [];
  const decided = decisions.filter((d) => d.outcome !== 'CANCELLED');
  const cancelled = decisions.find((d) => d.outcome === 'CANCELLED');

  const exact =
    input.sends.state === 'read' && input.sends.value.available
      ? input.sends.value.submissions
      : null;
  let historyUnread = false;

  const reason = (outcome: string, text: string | null) =>
    text
      ? `${REASON_PREFIX[viewer][outcome] ?? ''}${text}`
      : 'The agency sent this back. No reason was given.';

  if (exact && exact.length > 0) {
    // Rounds decided before exact copies were kept come first: their send time was not recorded,
    // their decision time was, and the reason is the one on the decision made at that moment.
    const allLegacy =
      input.sends.state === 'read'
        ? [...input.sends.value.legacy].sort(
            (a, b) => (a.decidedAt?.getTime() ?? 0) - (b.decidedAt?.getTime() ?? 0),
          )
        : [];
    // A send still waiting that was never pinned is the newest send: it follows the exact ones.
    const legacy = allLegacy.filter((old) => old.state !== 'AWAITING_DECISION');
    const legacyWaiting = allLegacy.filter((old) => old.state === 'AWAITING_DECISION');
    legacy.forEach((old, index) => {
      add({
        id: `legacy-${index}`,
        side: 'traveller',
        text: `${who === 'You' ? 'You sent' : `${who} sent`} ${noun}`,
        at: old.sentAt,
        word: old.state === 'AWAITING_DECISION' ? openWord(input.group) : decidedWord(old.state),
        wordAt: old.state === 'AWAITING_DECISION' ? null : old.decidedAt,
      });
      const recorded = decisions.find((d) => d.createdAt.getTime() === old.decidedAt?.getTime());
      if (SENT_BACK.has(old.state) && recorded) {
        add({
          id: `legacy-reason-${index}`,
          side: 'agency',
          text: reason(old.state, recorded.reason),
          at: old.decidedAt,
          word: 'Sent',
          wordAt: null,
        });
      }
    });
    // Every send, with its own time and its own decision.
    for (const send of exact) {
      const word =
        send.state === 'AWAITING_DECISION' ? openWord(input.group) : decidedWord(send.state);
      add({
        id: `send-${send.id}`,
        side: 'traveller',
        text: `${who === 'You' ? 'You sent' : `${who} sent`} ${send.title}`,
        at: send.sentAt,
        word,
        wordAt: word === 'Reviewed' || word === 'Sent Back for a Fix' ? send.decidedAt : null,
      });
      if (SENT_BACK.has(send.state)) {
        add({
          id: `reason-${send.id}`,
          side: 'agency',
          text: reason(send.state, send.reason),
          at: send.decidedAt,
          word: 'Sent',
          wordAt: null,
        });
      }
    }
    legacyWaiting.forEach((old, index) => {
      add({
        id: `legacy-waiting-${index}`,
        side: 'traveller',
        text: `${who === 'You' ? 'You sent' : `${who} sent`} ${noun}`,
        at: old.sentAt,
        word: openWord(input.group),
        wordAt: null,
      });
    });
  } else {
    // No exact copies (a detail, an older send, or the read failed): decisions plus the current reply.
    historyUnread =
      input.decisions.state === 'unread' ||
      (input.sends.state === 'unread' && input.decisions.state !== 'read');
    decided.forEach((d, index) => {
      // The request keeps the time of the newest reply only: it belongs to the last decided round
      // when no later reply has been made since that decision.
      const isLast = index === decided.length - 1;
      const covered =
        isLast &&
        request.respondedAt !== null &&
        request.respondedAt.getTime() <= d.createdAt.getTime();
      add({
        id: `reply-${index}`,
        side: 'traveller',
        text: `${who === 'You' ? 'You sent' : `${who} sent`} ${noun}`,
        at: covered ? request.respondedAt : null,
        word: decidedWord(d.outcome),
        wordAt: d.createdAt,
      });
      if (SENT_BACK.has(d.outcome)) {
        add({
          id: `reason-${index}`,
          side: 'agency',
          text: reason(d.outcome, d.reason),
          at: d.createdAt,
          word: 'Sent',
          wordAt: null,
        });
      }
    });
    const last = decided[decided.length - 1];
    const answeredAfter =
      request.respondedAt !== null &&
      (last === undefined || request.respondedAt.getTime() > last.createdAt.getTime());
    // The newest reply, when no decision covers it yet.
    if (answeredAfter && request.respondedAt && request.status !== 'NEEDS_REPLACEMENT') {
      add({
        id: 'reply-current',
        side: 'traveller',
        text: `${who === 'You' ? 'You sent' : `${who} sent`} ${noun}`,
        at: request.respondedAt,
        word: input.group === 'REVIEWED' ? 'Reviewed' : openWord(input.group),
        wordAt: null,
      });
    } else if (decided.length === 0 && request.status === 'NEEDS_REPLACEMENT') {
      // Sent back, but the decision itself is not in what was read: the state is known, the reason is not.
      add({
        id: 'reply-sent-back',
        side: 'traveller',
        text: `${who === 'You' ? 'You sent' : `${who} sent`} ${noun}`,
        at: request.respondedAt,
        word: 'Sent Back for a Fix',
        wordAt: null,
      });
    } else if (decided.length === 0 && request.respondedAt === null && input.group === 'REVIEWED') {
      // Accepted with no reply time on the request: the acceptance itself is all that is known.
      add({
        id: 'reply-accepted',
        side: 'traveller',
        text: `${who === 'You' ? 'You sent' : `${who} sent`} ${noun}`,
        at: null,
        word: 'Reviewed',
        wordAt: null,
      });
    }
  }

  if (request.status === 'CANCELLED') {
    add({
      id: 'cancelled',
      side: 'agency',
      text: 'The agency cancelled this request. Nothing is needed.',
      at: cancelled?.createdAt ?? null,
      word: 'Sent',
      wordAt: null,
    });
  }

  const timesMissing = messages.some((m) => m.side === 'traveller' && m.at === null);
  // Nothing about earlier rounds was asked for, yet the request has been answered: say that only
  // its latest state is shown, rather than let one round look like the whole story.
  const latestOnly =
    !exact &&
    input.decisions.state === 'none' &&
    input.sends.state !== 'read' &&
    input.sends.state !== 'unread' &&
    request.status !== 'OPEN';
  return {
    messages,
    olderSends: input.sends.state === 'read' ? input.sends.value.older : 0,
    note: historyUnread
      ? 'unread'
      : latestOnly
        ? 'latest-only'
        : timesMissing
          ? 'times-not-kept'
          : null,
  };
}
