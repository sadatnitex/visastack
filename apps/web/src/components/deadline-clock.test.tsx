import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CLOCK_EMPTY_BODY,
  CLOCK_EMPTY_TITLE,
  CLOCK_UNAVAILABLE_LINE,
  DeadlineClock,
  type DeadlineLine,
} from './deadline-clock';

const BANNED = /\b(ensure[sd]?|guarantee[ds]?|approved|approval|cleared|accepted|promise[sd]?)\b/i;

const add = { href: '/app/applicant/p1/documents', label: 'Add a Document' } as const;

function line(overrides: Partial<DeadlineLine> & Pick<DeadlineLine, 'key'>): DeadlineLine {
  return {
    label: 'Passport',
    phrase: 'Expires in 12 days',
    dateText: '7 Nov 2026',
    isoDate: '2026-11-07',
    person: null,
    urgency: 'month',
    toneWord: 'Within a Month',
    href: '/app/applicant/p1/expiry',
    check: null,
    ...overrides,
  };
}

const render = (props: Partial<React.ComponentProps<typeof DeadlineClock>> = {}) =>
  renderToStaticMarkup(
    <DeadlineClock heading="Coming Up" headingId="clock-h" addAction={add} lines={[]} {...props} />,
  );

describe('DeadlineClock with dates', () => {
  const html = render({
    lines: [
      line({
        key: 'a',
        label: 'Bank Statement',
        phrase: 'Was due 3 days ago',
        dateText: '23 Oct 2026',
        isoDate: '2026-10-23',
        urgency: 'overdue',
        toneWord: 'Overdue',
        href: '/app/applicant/p1/evidence',
      }),
      line({
        key: 'b',
        phrase: 'Expires tomorrow',
        urgency: 'soon',
        toneWord: 'Within a Week',
        person: 'Synthetic Traveller',
      }),
      line({ key: 'c', urgency: 'later', toneWord: 'Later', label: 'Visa' }),
    ],
    more: { href: '/app/applicant/p1/expiry', label: 'See All Dates' },
  });

  it('is a labelled section with its heading, as an ordered list in the order given', () => {
    expect(html).toContain('aria-labelledby="clock-h"');
    expect(html).toContain('<h2 class="card-title" id="clock-h">Coming Up</h2>');
    expect(html).toContain('<ol class="deadline-list">');
    expect(html.indexOf('Bank Statement')).toBeLessThan(html.indexOf('Passport'));
    expect(html.indexOf('Passport')).toBeLessThan(html.indexOf('Visa'));
  });

  it('says each tone in words as well as a class, so colour is never the only signal', () => {
    for (const [urgency, word] of [
      ['overdue', 'Overdue'],
      ['soon', 'Within a Week'],
      ['later', 'Later'],
    ] as const) {
      expect(html).toContain(`deadline-tone-${urgency}`);
      expect(html).toContain(`<span class="deadline-tag deadline-tag-tone">${word}</span>`);
    }
  });

  it('gives the plain phrase, the exact date as a time element, and who it is for when asked', () => {
    expect(html).toContain('Was due 3 days ago');
    expect(html).toContain('<time dateTime="2026-10-23">23 Oct 2026</time>');
    expect(html).toContain('Expires tomorrow');
    expect(html).toContain('Synthetic Traveller');
  });

  it('links each line to its page and offers the full list', () => {
    expect(html).toContain('href="/app/applicant/p1/evidence"');
    expect(html).toContain('href="/app/applicant/p1/expiry"');
    expect(html).toContain('See All Dates');
  });

  it('shows no unsure tag when no date is unsure, and no inline style', () => {
    expect(html).not.toContain('Check This Date');
    expect(html).not.toContain('deadline-line-check');
    expect(html).not.toContain('style=');
  });

  it('never uses decision or promise words', () => {
    expect(textOf(html)).not.toMatch(BANNED);
  });
});

describe('DeadlineClock with a date the system is unsure of', () => {
  const html = render({
    lines: [
      line({
        key: 'x',
        phrase: 'Expires in 12 days, if the date is right',
        check: 'Read from a document you have not named yet. Confirm the date.',
      }),
    ],
  });

  it('labels it Check This Date, gives the reason, and does not present it as certain', () => {
    expect(html).toContain('deadline-line-check');
    expect(html).toContain('<span class="deadline-tag deadline-tag-check">Check This Date</span>');
    expect(html).toContain('Read from a document you have not named yet. Confirm the date.');
    expect(html).toContain('if the date is right');
  });

  it('still says how soon it is, in words', () => {
    expect(html).toContain('Within a Month');
  });
});

describe('DeadlineClock without dates', () => {
  it('teaches, with the add-document button, and shows no list', () => {
    const html = render({ lines: [] });
    expect(html).toContain(CLOCK_EMPTY_TITLE);
    expect(html).toContain(CLOCK_EMPTY_BODY);
    expect(CLOCK_EMPTY_BODY).toBe(
      'Add a passport and its expiry date appears here, so you hear about it before it matters.',
    );
    expect(html).toContain('href="/app/applicant/p1/documents"');
    expect(html).toContain('Add a Document');
    expect(html).not.toContain('deadline-list');
    expect(html).not.toContain('See All Dates');
  });

  it('says dates are unavailable, not empty, when they could not be read', () => {
    const html = render({ lines: null });
    expect(html).toContain(CLOCK_UNAVAILABLE_LINE);
    expect(html).not.toContain(CLOCK_EMPTY_TITLE);
    expect(html).not.toContain('Add a Document');
  });

  it('keeps the note under the dates', () => {
    const html = render({
      lines: [line({ key: 'a' })],
      note: 'Dates for 1 person could not be read.',
    });
    expect(html).toContain('Dates for 1 person could not be read.');
  });
});

describe('DeadlineClock heading level', () => {
  it('can sit inside a rail as a level three heading', () => {
    expect(render({ headingLevel: 'h3' })).toContain('<h3 class="card-title" id="clock-h">');
  });
});

function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}
