import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RequestThread } from './request-thread';
import { THREAD_WORDS, type Thread, type ThreadMessage } from './thread-model';

const at = (day: number) => new Date(Date.UTC(2027, 0, day, 10));
const message = (over: Partial<ThreadMessage>): ThreadMessage => ({
  id: 'm',
  side: 'agency',
  text: 'Please send your bank statement.',
  at: at(1),
  word: 'Sent',
  wordAt: null,
  ...over,
});

const draw = (thread: Thread, viewer: 'agency' | 'traveller', showHeading = true) =>
  new JSDOM(
    renderToStaticMarkup(
      <RequestThread
        thread={thread}
        viewer={viewer}
        timeZone="Asia/Dhaka"
        showHeading={showHeading}
      />,
    ),
  ).window.document;

const thread: Thread = {
  note: null,
  messages: [
    message({ id: 'ask' }),
    message({
      id: 'r1',
      side: 'traveller',
      text: 'You sent statement.pdf',
      word: 'Received',
      at: at(2),
    }),
    message({
      id: 'r2',
      side: 'traveller',
      text: 'You sent clear.pdf',
      word: 'Reviewed',
      at: at(3),
      wordAt: at(4),
    }),
  ],
};

describe('the request conversation', () => {
  it('puts the reader on the right and the other side on the left, in both views', () => {
    const traveller = draw(thread, 'traveller');
    expect(traveller.querySelector('[data-side="agency"]')?.className).toContain('rt-msg-other');
    expect(traveller.querySelector('[data-side="traveller"]')?.className).toContain('rt-msg-own');
    const agency = draw(thread, 'agency');
    expect(agency.querySelector('[data-side="agency"]')?.className).toContain('rt-msg-own');
    expect(agency.querySelector('[data-side="traveller"]')?.className).toContain('rt-msg-other');
  });

  it('gives every message its time and one state word from the closed set', () => {
    const doc = draw(thread, 'traveller');
    const messages = [...doc.querySelectorAll('.rt-msg')];
    expect(messages).toHaveLength(3);
    for (const el of messages) {
      const word = el.querySelector('.rt-word')?.textContent ?? '';
      expect(THREAD_WORDS as readonly string[]).toContain(word);
      expect(el.querySelector('time')?.getAttribute('datetime')).toMatch(/^2027-01-/);
    }
    expect(messages[1]?.querySelector('time')?.textContent).toBe('2 Jan 2027, 16:00 GMT+6');
  });

  it('shows when a review happened, apart from when the reply was sent', () => {
    const doc = draw(thread, 'traveller');
    const last = doc.querySelectorAll('.rt-msg')[2];
    expect(last?.querySelectorAll('time')).toHaveLength(2);
    expect(last?.textContent).toContain('Reviewed ');
  });

  it('never draws a tick, a delivery mark or a picture: words and time only', () => {
    const html = renderToStaticMarkup(
      <RequestThread thread={thread} viewer="traveller" timeZone="Asia/Dhaka" />,
    );
    expect(html).not.toMatch(/[✓✔✅☑]/);
    expect(html).not.toMatch(/<svg|<img|<use|data:image|class="[^"]*(?:tick|check|delivered)/i);
  });

  it('refuses a state that is not one of the four words, so a tick cannot be added by accident', () => {
    const bad: Thread = {
      note: null,
      messages: [message({ word: 'Delivered' as unknown as ThreadMessage['word'] })],
    };
    expect(() => draw(bad, 'traveller')).toThrow(/Not a thread word/);
  });

  it('says a time was not kept instead of guessing one', () => {
    const doc = draw({ note: 'times-not-kept', messages: [message({ at: null })] }, 'traveller');
    expect(doc.querySelector('.rt-meta')?.textContent).toContain('Time not kept');
    expect(doc.querySelector('.rt-note')?.textContent).toBe(
      'Some earlier sends have no time on record.',
    );
  });

  it('says earlier history could not be loaded, never that there is none', () => {
    const doc = draw({ note: 'unread', messages: [message({})] }, 'agency');
    expect(doc.querySelector('.rt-note')?.textContent).toBe(
      'Earlier history could not be loaded. Refresh to try again.',
    );
  });

  it('adds no heading where a fold already names it', () => {
    expect(draw(thread, 'agency', false).querySelector('h4')).toBeNull();
    expect(draw(thread, 'traveller').querySelector('h4')?.textContent).toBe('Conversation');
  });
});
