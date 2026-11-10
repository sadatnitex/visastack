import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { CONFIRMED_LINE } from '../../lib/confirmed-landing';
import { countryStartData } from '../../lib/country-start';
import { FirstRunCountry } from './first-run';

vi.mock('server-only', () => ({}));

const render = (confirmed?: boolean) =>
  renderToStaticMarkup(
    <FirstRunCountry
      data={countryStartData()}
      iso2={null}
      action={async () => {}}
      {...(confirmed === undefined ? {} : { confirmed })}
    />,
  );

it('shows the confirmed line once, as a polite status, only when asked', () => {
  expect(render(true)).toContain(`<output class="first-run-notice">${CONFIRMED_LINE}</output>`);
  expect(render(false)).not.toContain(CONFIRMED_LINE);
  expect(render()).not.toContain(CONFIRMED_LINE);
});
