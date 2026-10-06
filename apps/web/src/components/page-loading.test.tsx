import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageLoading } from './page-loading';

describe('PageLoading', () => {
  it('is a polite status region that says it is loading', () => {
    const html = renderToStaticMarkup(<PageLoading />);
    // <output> carries the built-in role "status", which a screen reader announces politely.
    expect(html).toContain('<output');
    expect(html).toContain('Loading…');
  });

  it('hides the grey placeholder shapes from assistive technology', () => {
    const html = renderToStaticMarkup(<PageLoading />);
    const shapes = html.match(/class="skeleton [^"]*"[^>]*>/g) ?? [];
    expect(shapes.length).toBeGreaterThanOrEqual(3);
    for (const shape of shapes) expect(shape).toContain('aria-hidden="true"');
  });

  it('gives a whole page one top heading while it loads, and a panel none', () => {
    expect(renderToStaticMarkup(<PageLoading />)).toContain('<h1 class="sr-only">Loading</h1>');
    expect(renderToStaticMarkup(<PageLoading frame="panel" />)).not.toContain('<h1');
  });

  it('accepts a more specific label', () => {
    expect(renderToStaticMarkup(<PageLoading label="Loading documents" />)).toContain(
      'Loading documents…',
    );
  });

  it('supplies its own section padding as a page, and none inside a workspace panel', () => {
    expect(renderToStaticMarkup(<PageLoading />)).toContain('class="section container"');
    expect(renderToStaticMarkup(<PageLoading frame="panel" />)).not.toContain('section container');
  });
});
