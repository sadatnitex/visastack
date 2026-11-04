import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { textOf } from '../../lib/next-mocks.test-support';
import RootNotFound, { metadata as rootMetadata } from '../not-found';
import WorkspaceNotFound, { metadata } from './not-found';

describe('404 screens (VS-010)', () => {
  it('name the page in the browser tab, for both the public and the signed-in 404', () => {
    expect(rootMetadata.title).toBe('Page Not Found');
    expect(metadata.title).toBe('Page Not Found');
  });

  it('keep the signed-in 404 inside the workspace with real in-app links', () => {
    const html = renderToStaticMarkup(<WorkspaceNotFound />);
    const text = textOf(html);
    expect(text).toContain("We Couldn't Find That Page");
    expect(text).toContain('Go to Your Overview');
    expect(html).toContain('href="/app"');
    expect(html).toContain('href="/app/help#contact"');
    expect(text).not.toContain('Back to Home');
  });

  it('never tells a missing record from one the person may not open', () => {
    const text = textOf(renderToStaticMarkup(<WorkspaceNotFound />));
    expect(text).toContain('removed or revoked');
    expect(text).not.toMatch(/permission|denied|forbidden|not allowed|access/i);
  });

  it('keeps the public 404 a way home, with Title Case words', () => {
    const text = textOf(renderToStaticMarkup(<RootNotFound />));
    expect(text).toContain('Not Found');
    expect(text).toContain('Go to Workspace');
    expect(text).toContain('Back to Home');
  });
});
