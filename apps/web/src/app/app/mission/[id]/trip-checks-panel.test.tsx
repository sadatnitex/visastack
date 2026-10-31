import type { TripCheck } from '@visastack/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TripChecksPanel } from './trip-checks-panel';

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
});
