import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { aiConnectionTimeLeft } from '../lib/ai-connection-time-left';
import { axeViolations } from '../lib/axe.test-support';
import { textOf } from '../lib/next-mocks.test-support';
import { AiConnectionTile, type AiConnectionTileProps } from './ai-connection-tile';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date(Date.UTC(2030, 0, 15, 12, 0));
const at = (ms: number) => new Date(NOW.getTime() + ms);

function tile(overrides: Partial<AiConnectionTileProps> = {}): string {
  return renderToStaticMarkup(
    <ul>
      <li>
        <AiConnectionTile
          id="one"
          appName="Claude"
          appHost="claude.ai"
          readsTerm="Can Read"
          reads={[
            { key: 'identity', icon: 'user', label: 'Personal Details', note: 'Name and dates.' },
            {
              key: 'full',
              icon: 'lock',
              label: 'Full Document Numbers',
              value: 'No',
              note: 'Numbers show only their last three characters.',
            },
          ]}
          facts={[
            { key: 'connected', term: 'Connected', value: '14 Jan 2030' },
            { key: 'ends', term: 'Ends', value: '13 Feb 2030, 12:00' },
            { key: 'last', term: 'Last Used', value: 'Not Used Yet' },
          ]}
          timeLeft={aiConnectionTimeLeft({ start: at(-DAY), end: at(29 * DAY), now: NOW })}
          actions={<button type="button">Turn Off</button>}
          {...overrides}
        />
      </li>
    </ul>,
  );
}

describe('the AI connection tile (WAL5)', () => {
  it('shows who, what it reads as pictures that explain themselves, the time left and the actions', async () => {
    const html = tile();
    const text = textOf(html);
    expect(html).toMatch(
      /<h3 class="ai-tile-name" id="ai-tile-one">Claude <span[^>]*>claude\.ai<\/span><\/h3>/,
    );
    expect(html).toContain('aria-labelledby="ai-tile-one"');
    // Each picture is a 44 px Explain button named by the consent label (and its value).
    expect(html).toContain('<span class="sr-only">Personal Details</span></button>');
    expect(html).toContain('<span class="sr-only">Full Document Numbers: No</span></button>');
    expect(html).toMatch(/aria-describedby="[^"]+-text"/);
    expect(text).toContain('Numbers show only their last three characters.');
    // The visible words beside each button are for the eye only (the button carries the name).
    expect(html).toContain(
      '<span class="ai-tile-read-word" aria-hidden="true">Personal Details</span>',
    );
    expect(text).toContain('29 Days Left');
    expect(text).toMatch(/Connected\s*14 Jan 2030/);
    expect(text).toMatch(/Ends\s*13 Feb 2030, 12:00/);
    expect(text).toMatch(/Last Used\s*Not Used Yet/);
    expect(text).toContain('Turn Off');
    expect(await axeViolations(html)).toEqual([]);
  });

  it('draws the ring at its final state, flat, with nothing that moves', () => {
    const html = tile();
    // 29 of 30 days left: 97 of 100 drawn.
    expect(html).toContain('stroke-dasharray="97 3"');
    expect(html).toContain('data-state="running"');
    expect(html).not.toMatch(/style=|<animate|transition|@keyframes/);
    // The ring is a drawing beside words that say the same, so it is hidden from screen readers.
    expect(html).toMatch(/<span class="ai-tile-ring" data-state="running" aria-hidden="true">/);
  });

  it('says ending soon, in hours, when the end is close', () => {
    const html = tile({
      timeLeft: aiConnectionTimeLeft({ start: at(-20 * HOUR), end: at(4 * HOUR), now: NOW }),
    });
    expect(html).toContain('data-state="ending_soon"');
    expect(textOf(html)).toContain('4 Hours Left');
    expect(textOf(html)).toContain('Ending Soon');
    const lastHour = tile({
      timeLeft: aiConnectionTimeLeft({ start: at(-HOUR), end: at(10 * 60_000), now: NOW }),
    });
    expect(textOf(lastHour)).toContain('Less Than 1 Hour Left');
    const oneDay = tile({
      timeLeft: aiConnectionTimeLeft({ start: at(-29 * DAY), end: at(DAY + HOUR), now: NOW }),
    });
    expect(textOf(oneDay)).toContain('1 Day Left');
  });

  it('shows an ended connection with an empty ring, and an open one with a full ring and no count', () => {
    const ended = tile({
      timeLeft: aiConnectionTimeLeft({ start: at(-DAY), end: at(9 * DAY), now: NOW, live: false }),
    });
    expect(ended).toContain('data-state="ended"');
    expect(ended).not.toContain('ai-tile-ring-fill');
    expect(textOf(ended)).toContain('Ended');
    const open = tile({ timeLeft: aiConnectionTimeLeft({ start: at(-DAY), end: null, now: NOW }) });
    expect(open).toContain('data-state="open"');
    expect(open).toContain('stroke-dasharray="100 0"');
    expect(textOf(open)).not.toMatch(/Left|Ended|Ending Soon/);
  });

  it('never draws an empty ring while time is left', () => {
    const html = tile({
      timeLeft: aiConnectionTimeLeft({ start: at(-30 * DAY), end: at(60_000), now: NOW }),
    });
    expect(html).toContain('stroke-dasharray="2 98"');
  });

  it('says plainly when the app reads nothing from the record, and leaves out empty parts', async () => {
    const html = tile({ reads: [], readsEmpty: 'Nothing from this record', actions: undefined });
    expect(textOf(html)).toContain('Nothing from this record');
    expect(html).not.toContain('ai-tile-read-list');
    expect(html).not.toContain('ai-tile-actions');
    expect(await axeViolations(html)).toEqual([]);
  });
});
