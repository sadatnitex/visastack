import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../../lib/axe.test-support';

const forced = vi.hoisted(() => ({ state: undefined as unknown }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: ((...args: Parameters<typeof actual.useActionState>) =>
      forced.state
        ? [forced.state, () => undefined, false]
        : actual.useActionState(...args)) as typeof actual.useActionState,
  };
});
vi.mock('./feed-actions', () => ({ calendarFeedAction: async () => ({ ok: true, message: '' }) }));

const { CalendarFeedPanel } = await import('./calendar-feed-panel');

const HTTPS = `https://vs.example.test/api/calendar-feed/${'z'.repeat(43)}.ics`;
const WEBCAL = HTTPS.replace('https://', 'webcal://');

describe('the calendar link panel', () => {
  it('shows a new link once, labelled, with copy and calendar app hand-off, and accessible', async () => {
    forced.state = {
      ok: true,
      message: 'Your calendar link is on.',
      feed: 'on',
      link: { https: HTTPS, webcal: WEBCAL },
    };
    const html = renderToStaticMarkup(
      <CalendarFeedPanel applicantId="a1" status={{ state: 'off' }} />,
    );
    expect(html).toContain(`value="${HTTPS}"`);
    expect(html).toContain('readOnly=""');
    expect(html).toContain(`href="${WEBCAL}"`);
    expect(html).toContain('Your Private Calendar Link');
    expect(html).toContain('Copy Link');
    expect(html).toContain('This link is shown only now.');
    // Now on: the next choices are a new link or stopping it, never turning it on again.
    expect(html).toContain('Make a New Link');
    expect(html).toContain('Stop Sharing');
    expect(html).not.toContain('Turn On Calendar Link');
    expect(await axeViolations(html)).toEqual([]);
  });

  it('after stopping, offers to turn a link on again and shows no link', () => {
    forced.state = { ok: true, message: 'Your calendar link has stopped working.', feed: 'off' };
    const html = renderToStaticMarkup(
      <CalendarFeedPanel applicantId="a1" status={{ state: 'on', linkMadeOn: '20 Oct 2026' }} />,
    );
    expect(html).toContain('Turn On Calendar Link');
    expect(html).not.toContain('/api/calendar-feed/');
    expect(html).not.toContain('made on 20 Oct 2026');
  });
});
