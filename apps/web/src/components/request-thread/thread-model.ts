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

export interface ThreadSendList {
  /** False before the exact copies were kept: the sends below are then empty. */
  readonly available: boolean;
  readonly submissions: readonly ThreadSend[];
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
  /**
   * `unread`: the earlier history could not be loaded (never "there is none").
   * `times-not-kept`: some sends were made before their times were recorded.
   */
  readonly note: 'unread' | 'times-not-kept' | null;
}

/** The prefix that tells which of the review outcomes a reason belongs to. */
const REASON_PREFIX: Readonly<Record<string, string>> = {
  NEEDS_REPLACEMENT: 'Replacement needed: ',
  CONTRADICTION: 'Contradicts the profile: ',
  CORRECTION_PROPOSED: 'Suggested correction: ',
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
      ? `${REASON_PREFIX[outcome] ?? ''}${text}`
      : 'The agency sent this back. No reason was given.';

  if (exact && exact.length > 0) {
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
  } else {
    // No exact copies (a detail, an older send, or the read failed): decisions plus the current reply.
    historyUnread =
      input.decisions.state === 'unread' ||
      (input.sends.state === 'unread' && input.decisions.state !== 'read');
    decided.forEach((d, index) => {
      add({
        id: `reply-${index}`,
        side: 'traveller',
        text: `${who === 'You' ? 'You sent' : `${who} sent`} ${noun}`,
        at: null,
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
  return {
    messages,
    note: historyUnread ? 'unread' : timesMissing ? 'times-not-kept' : null,
  };
}
