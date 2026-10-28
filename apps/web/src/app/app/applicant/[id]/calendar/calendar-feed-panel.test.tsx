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

const { CalendarFeedPanel, nextPanelResult } = await import('./calendar-feed-panel');

const LINK = `https://vs.example.test/api/calendar-feed/${'z'.repeat(43)}.ics`;
const render = (status: Parameters<typeof CalendarFeedPanel>[0]['status']) =>
  renderToStaticMarkup(<CalendarFeedPanel applicantId="a1" status={status} />);

describe('the calendar link panel', () => {
  it('shows a new link once, labelled, https only, with short steps per app, and accessible', async () => {
    forced.state = {
      ok: true,
      message: 'Your calendar link is on.',
      feed: 'on',
      known: 'on',
      link: LINK,
    };
    const html = render({ state: 'off' });
    expect(html).toContain(`value="${LINK}"`);
    expect(html).toContain('Your Private Calendar Link');
    expect(html).toContain('Copy Link');
    expect(html).not.toContain('webcal');
    expect(html).not.toContain('Open in Calendar App');
    for (const app of ['Google Calendar', 'iPhone or iPad', 'Calendar on a Mac', 'Outlook']) {
      expect(html).toContain(app);
    }
    expect(html).toContain('This link is shown only now.');
    expect(html).toContain('first name');
    expect(html).toContain('Make a New Link');
    expect(html).toContain('Stop Sharing');
    expect(html).not.toContain('Turn On Calendar Link');
    expect(await axeViolations(html)).toEqual([]);
  });

  it('after stopping, offers to turn a link on again and shows no link', () => {
    forced.state = { ok: true, message: 'Stopped.', feed: 'off', known: 'off' };
    const html = render({ state: 'on', linkMadeOn: '20 Oct 2026, 14:00 GMT+6' });
    expect(html).toContain('Turn On Calendar Link');
    expect(html).not.toContain('/api/calendar-feed/');
    expect(html).not.toContain('made on');
  });

  it('when the state could not be read, says so and still offers Stop Sharing', async () => {
    forced.state = undefined;
    const html = render({ state: 'unknown' });
    expect(html).toContain('We could not check your calendar link just now.');
    expect(html).toContain('Stop Sharing');
    expect(html).not.toContain('Make a New Link');
    expect(html).not.toContain('Turn On Calendar Link');
    expect(await axeViolations(html)).toEqual([]);
  });
});

describe('the state the panel keeps between answers', () => {
  it('keeps the last state the server reported when a change fails without one', () => {
    const on = nextPanelResult(
      { ok: true, message: '', known: 'off' },
      {
        ok: true,
        message: 'On.',
        feed: 'on',
        link: LINK,
      },
    );
    expect(on).toMatchObject({ known: 'on', link: LINK });
    // A failed stop that could not read the state: still on, link still shown, never "off".
    const failed = nextPanelResult(on, { ok: false, message: 'Try again.' });
    expect(failed).toMatchObject({ ok: false, known: 'on', link: LINK });
    // A failed change that did read the state takes it.
    const refreshed = nextPanelResult(failed, { ok: false, message: 'Try again.', feed: 'off' });
    expect(refreshed.known).toBe('off');
    expect(refreshed.link).toBeUndefined();
    // A new link replaces the old one; stopping drops it.
    const other = `${LINK.slice(0, -5)}y.ics`;
    expect(nextPanelResult(failed, { ok: true, message: '', feed: 'on', link: other }).link).toBe(
      other,
    );
    expect(nextPanelResult(failed, { ok: true, message: '', feed: 'off' }).link).toBeUndefined();
  });
});
