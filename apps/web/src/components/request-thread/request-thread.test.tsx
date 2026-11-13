import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { renderServer } from '../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
vi.mock('../../lib/locale', () => ({ getLocale: async () => 'en' }));

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

const draw = async (thread: Thread, viewer: 'agency' | 'traveller', showHeading = true) =>
  new JSDOM(
    await renderServer(
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
  olderSends: 0,
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
  it('puts the reader on the right and the other side on the left, in both views', async () => {
    const traveller = await draw(thread, 'traveller');
    expect(traveller.querySelector('[data-side="agency"]')?.className).toContain('rt-msg-other');
    expect(traveller.querySelector('[data-side="traveller"]')?.className).toContain('rt-msg-own');
    const agency = await draw(thread, 'agency');
    expect(agency.querySelector('[data-side="agency"]')?.className).toContain('rt-msg-own');
    expect(agency.querySelector('[data-side="traveller"]')?.className).toContain('rt-msg-other');
  });

  it('gives every message its time and one state word from the closed set', async () => {
    const doc = await draw(thread, 'traveller');
    const messages = [...doc.querySelectorAll('.rt-msg')];
    expect(messages).toHaveLength(3);
    for (const el of messages) {
      const word = el.querySelector('.rt-word')?.textContent ?? '';
      expect(THREAD_WORDS as readonly string[]).toContain(word);
      expect(el.querySelector('time')?.getAttribute('datetime')).toMatch(/^2027-01-/);
    }
    expect(messages[1]?.querySelector('time')?.textContent).toBe('2 Jan 2027, 16:00 GMT+6');
  });

  it('shows when a review happened, apart from when the reply was sent', async () => {
    const doc = await draw(thread, 'traveller');
    const last = doc.querySelectorAll('.rt-msg')[2];
    expect(last?.querySelectorAll('time')).toHaveLength(2);
    expect(last?.textContent).toContain('Reviewed ');
  });

  it('never draws a tick, a delivery mark or a picture: words and time only', async () => {
    const html = await renderServer(
      <RequestThread thread={thread} viewer="traveller" timeZone="Asia/Dhaka" />,
    );
    expect(html).not.toMatch(/[✓✔✅☑]/);
    expect(html).not.toMatch(/<svg|<img|<use|data:image|class="[^"]*(?:tick|check|delivered)/i);
  });

  it('refuses a state that is not one of the four words, so a tick cannot be added by accident', async () => {
    const bad: Thread = {
      note: null,
      olderSends: 0,
      messages: [message({ word: 'Delivered' as unknown as ThreadMessage['word'] })],
    };
    await expect(draw(bad, 'traveller')).rejects.toThrow(/Not a thread word/);
  });

  it('says a send had no time kept instead of guessing one, and shows no time for an agency line that was not read', async () => {
    const doc = await draw(
      {
        note: 'times-not-kept',
        olderSends: 0,
        messages: [message({ side: 'traveller', at: null }), message({ id: 'x', at: null })],
      },
      'traveller',
    );
    const meta = [...doc.querySelectorAll('.rt-meta')].map((m) => m.textContent);
    expect(meta[0]).toContain('Time not kept');
    expect(meta[1]).not.toContain('Time not kept');
    expect(doc.querySelector('.rt-note')?.textContent).toBe(
      'Some earlier sends have no time on record.',
    );
  });

  it('says earlier history could not be loaded, never that there is none', async () => {
    const doc = await draw({ note: 'unread', olderSends: 0, messages: [message({})] }, 'agency');
    expect(doc.querySelector('.rt-note')?.textContent).toBe(
      'Earlier history could not be loaded. Refresh to try again.',
    );
  });

  it('says older sends are not shown when the newest only were read', async () => {
    const doc = await draw({ ...thread, olderSends: 2 }, 'traveller');
    expect(doc.querySelector('.rt-note')?.textContent).toBe('Older sends are not shown here.');
    expect((await draw(thread, 'traveller')).querySelector('.rt-note')).toBeNull();
  });

  it('says only the latest reply is shown where no earlier rounds were read', async () => {
    const doc = await draw({ ...thread, note: 'latest-only' }, 'agency');
    expect(doc.querySelector('.rt-note')?.textContent).toBe('Only the latest reply is shown here.');
  });

  it('adds no heading where a fold already names it', async () => {
    expect((await draw(thread, 'agency', false)).querySelector('h4')).toBeNull();
    expect((await draw(thread, 'traveller')).querySelector('h4')?.textContent).toBe('Conversation');
  });
});
