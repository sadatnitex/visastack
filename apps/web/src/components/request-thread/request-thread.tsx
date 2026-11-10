import { formatMoment } from '../../lib/save-status';
import { THREAD_WORDS, type Thread, type ThreadMessage, type ThreadWord } from './thread-model';

const WORD_CLASS: Readonly<Record<ThreadWord, string>> = {
  Sent: 'rt-word-sent',
  Received: 'rt-word-received',
  Reviewed: 'rt-word-reviewed',
  'Sent Back for a Fix': 'rt-word-fix',
};

const NOTE: Readonly<Record<'unread' | 'times-not-kept', string>> = {
  unread: 'Earlier history could not be loaded. Refresh to try again.',
  'times-not-kept': 'Some earlier sends have no time on record.',
};

/** The state is always a word from the closed set; anything else is a bug, not a new chip. */
function wordFor(word: ThreadWord): ThreadWord {
  if (!THREAD_WORDS.includes(word)) throw new Error(`Not a thread word: ${String(word)}`);
  return word;
}

function Message({
  message,
  viewer,
  timeZone,
}: {
  readonly message: ThreadMessage;
  readonly viewer: 'agency' | 'traveller';
  readonly timeZone: string | null;
}) {
  const word = wordFor(message.word);
  const when = (value: Date) => formatMoment(value, timeZone);
  return (
    <li
      className={`rt-msg ${message.side === viewer ? 'rt-msg-own' : 'rt-msg-other'}`}
      data-side={message.side}
      data-word={word}
    >
      <p className="rt-text">{message.text}</p>
      <p className="rt-meta">
        <span className={`rt-word ${WORD_CLASS[word]}`}>{word}</span>
        {message.at ? (
          <time dateTime={message.at.toISOString()}>{when(message.at)}</time>
        ) : message.side === 'traveller' ? (
          // A send whose time was never recorded says so. An agency line with no time shows none:
          // it may simply not have been read, which is not the same as not kept.
          <span>Time not kept</span>
        ) : null}
        {message.wordAt && message.wordAt.getTime() !== message.at?.getTime() ? (
          <span>
            {word === 'Reviewed' ? 'Reviewed ' : 'Sent back '}
            <time dateTime={message.wordAt.toISOString()}>{when(message.wordAt)}</time>
          </span>
        ) : null}
      </p>
    </li>
  );
}

/**
 * One request as a conversation (familiar pattern F3): the agency's ask on one side, the
 * traveller's replies on the other, the reader's own words on the right. Every message carries its
 * time and one state word (Sent, Received, Reviewed, Sent Back for a Fix), never a tick: Received
 * is not Reviewed. Flat tone fills only. Replying is not here: the form that sends stays a
 * deliberate button of its own.
 */
export function RequestThread({
  thread,
  viewer,
  timeZone,
  heading = 'Conversation',
  showHeading = true,
}: {
  readonly thread: Thread;
  readonly viewer: 'agency' | 'traveller';
  /** The traveller's time zone, so both sides read the same moment. */
  readonly timeZone: string | null;
  readonly heading?: string;
  /** False where a fold already names the conversation, so no heading level is added. */
  readonly showHeading?: boolean;
}) {
  return (
    <section className="rt" data-pattern="request-thread" aria-label={heading}>
      {showHeading ? <h4 className="rt-title">{heading}</h4> : null}
      <ol className="rt-list">
        {thread.messages.map((message) => (
          <Message key={message.id} message={message} viewer={viewer} timeZone={timeZone} />
        ))}
      </ol>
      {thread.olderSends > 0 ? <p className="rt-note">Older sends are not shown here.</p> : null}
      {thread.note ? <p className="rt-note">{NOTE[thread.note]}</p> : null}
    </section>
  );
}
