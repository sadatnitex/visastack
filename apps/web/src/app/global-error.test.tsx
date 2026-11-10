// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import GlobalError from './global-error';

/**
 * The last-resort error page replaces the whole root layout, so it cannot rely on the viewport the
 * layout declares. Without one a phone draws it as a shrunken desktop page.
 */
describe('the last-resort error page', () => {
  it('states the device width itself', () => {
    const html = renderToStaticMarkup(
      <GlobalError error={new Error('x')} reset={() => undefined} />,
    );
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1"/>');
  });
});
