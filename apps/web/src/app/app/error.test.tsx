import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { textOf } from '../../lib/next-mocks.test-support';
import WorkspaceError from './error';

const show = (digest?: string) =>
  textOf(
    renderToStaticMarkup(
      <WorkspaceError
        error={Object.assign(new Error('boom'), digest ? { digest } : {})}
        reset={() => undefined}
      />,
    ),
  );

describe('the error screen inside the signed-in area', () => {
  it('promises only what is true and gives a way on', () => {
    const text = show('99');
    expect(text).toContain('This page did not load');
    expect(text).toContain('Everything you already saved is safe');
    expect(text).toContain('you may need to enter it again');
    // It must not claim that nothing was lost: a half-typed form may be.
    expect(text).not.toContain('lost or damaged');
    expect(text).toContain('Try Again');
    expect(text).toContain('Go to Your Overview');
    expect(text).not.toContain('Back to Home');
    expect(text).toContain('Get help');
    expect(text).toContain('quote reference 99');
  });

  it('leaves out the reference when there is none, and never prints the error text', () => {
    const text = show();
    expect(text).not.toContain('quote reference');
    expect(text).not.toContain('boom');
  });

  it('links to real in-app pages with plain anchors', () => {
    const html = renderToStaticMarkup(
      <WorkspaceError error={new Error('x')} reset={() => undefined} />,
    );
    expect(html).toContain('<a class="btn btn-secondary" href="/app">');
    expect(html).toContain('<a href="/app/help">');
  });
});
