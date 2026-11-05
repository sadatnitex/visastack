import type { TripCheck } from '@visastack/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TripChecksPanel, tripChecksSummary } from './trip-checks-panel';

const checks: readonly TripCheck[] = [
  {
    key: 'passport_validity',
    level: 'problem',
    title: 'Your passport expires before your trip ends',
    detail: 'It expires on 1 March 2027. Renew it before you apply.',
  },
  {
    key: 'insurance_cover',
    level: 'ok',
    title: 'Your travel insurance covers your whole trip',
    detail: 'The policy runs from 1 March 2027 to 1 April 2027.',
  },
];

describe('trip checks panel', () => {
  it('shows each check with a word for how it stands, not only a colour', () => {
    const html = renderToStaticMarkup(<TripChecksPanel checks={checks} />);
    expect(html).toContain('Trip Date Checks');
    expect(html).toContain('Your passport expires before your trip ends');
    expect(html).toContain('Needs Fixing');
    expect(html).toContain('Looks Fine');
    expect(html).toContain('They are not a country');
  });

  it('says so plainly when the checks could not be worked out', () => {
    const html = renderToStaticMarkup(<TripChecksPanel checks={null} />);
    expect(html).toContain('We could not check your dates just now');
    expect(html).not.toContain('<ul');
  });

  it('shows each check as one compact row: a mark, the title, the status word and one line of detail', () => {
    const html = renderToStaticMarkup(<TripChecksPanel checks={checks} />);
    const rows = html.match(/<li class="trip-check lift-trip lift-trip-(danger|success)"/g);
    expect(rows).toHaveLength(2);
    // The mark is a picture; the words carry the status (never colour alone).
    expect(html).toContain('lift-mark');
    expect(html).toContain('It expires on 1 March 2027. Renew it before you apply.');
    expect(html).not.toContain('style=');
  });

  it('folds the long explanation under About These Checks and keeps its words', () => {
    const html = renderToStaticMarkup(<TripChecksPanel checks={checks} />);
    expect(html).toContain('<summary>About These Checks</summary>');
    expect(html).toContain(
      'Common checks of your trip dates against your passport and travel insurance.',
    );
  });

  it('says there is nothing to check yet when no check applies, instead of showing an empty list', () => {
    const html = renderToStaticMarkup(<TripChecksPanel checks={[]} />);
    expect(html).toContain('No date checks apply yet.');
    expect(html).not.toContain('<ul');
  });

  it('sums the set up for a phone row: how many checks and the status of the worst one', () => {
    expect(tripChecksSummary(checks)).toEqual({
      meta: '2 checks on your trip dates',
      status: { tone: 'danger', label: 'Needs Fixing' },
    });
    expect(tripChecksSummary([checks[1] as TripCheck])).toEqual({
      meta: '1 check on your trip dates',
      status: { tone: 'success', label: 'Looks Fine' },
    });
    const unknown: TripCheck = {
      key: 'insurance_cover',
      level: 'unknown',
      title: 'Insurance',
      detail: 'x',
    };
    const check: TripCheck = {
      key: 'passport_validity',
      level: 'check',
      title: 'Passport',
      detail: 'y',
    };
    expect(tripChecksSummary([unknown, check]).status?.label).toBe('Take a Look');
    expect(tripChecksSummary([unknown]).status?.label).toBe('Add a Detail');
    expect(tripChecksSummary([])).toEqual({ meta: 'No date checks apply yet', status: null });
    expect(tripChecksSummary(null)).toEqual({
      meta: 'Could not be checked just now',
      status: null,
    });
  });
});
