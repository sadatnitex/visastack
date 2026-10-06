import { describe, expect, it } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';

const { default: HomePage } = await import('./page');

const render = async (searchParams: { auth_error?: string } = {}) =>
  renderServer(HomePage({ searchParams: Promise.resolve(searchParams) }));

describe('the public home page', () => {
  it('says what the product is for in everyday words', async () => {
    const text = textOf(await render());
    expect(text).toContain('One profile. Every visa.');
    expect(text).toContain('Invite-only pilot');
    expect(text).toContain('Keep your passport, documents and visa history in one private place');
    for (const title of [
      'One profile for every application',
      'A private place for your papers',
      'AI can help, but never decides',
      'See what is still missing',
      'Share with an agency, on your terms',
      'Your data stays yours',
    ]) {
      expect(text).toContain(title);
    }
  });

  it('is honest that this is a private pilot with some features not switched on', async () => {
    const text = textOf(await render());
    expect(text).toContain('some features are still being switched on');
    expect(text).toContain('some features are not switched on yet');
    expect(text).toContain('made-up details');
  });

  it('never promises what the product does not do', async () => {
    const text = textOf(await render()).toLowerCase();
    // Readiness is how complete a file is, never a prediction.
    expect(text).toContain('never a guess at your chances of approval');
    // Bangla is only partly available (the full translation is a later piece of work), so
    // the page must not promise it yet.
    for (const overclaim of ['guarantee', 'bank-grade', 'unhackable', '100% secure', 'bangla']) {
      expect(text, overclaim).not.toContain(overclaim);
    }
  });

  it('leaves out the tools and the engineering behind it', async () => {
    const text = textOf(await render());
    for (const jargon of [
      /Technical Preview/,
      /Vercel/,
      /\bNeon\b/,
      /Universal Core/,
      /\bports?\b/i,
    ]) {
      expect(text, String(jargon)).not.toMatch(jargon);
    }
  });

  it('sends a visitor to sign in and to see what works today', async () => {
    const html = await render();
    expect(html).toContain('<a class="btn btn-primary" href="/app">Sign in to get started</a>');
    expect(html.match(/href="\/status"/g)?.length).toBe(2);
    expect(html).toContain('id="capabilities"');
  });

  it('shows a way forward when a sign-in did not complete, quoting the reference', async () => {
    const html = await render({ auth_error: 'ref-1234' });
    expect(html).toContain('role="alert"');
    const text = textOf(html);
    expect(text).toContain('Sign-in didn’t complete. Please try again.');
    expect(text).toContain('contact support and quote reference ref-1234');
  });

  it('shows no sign-in notice on an ordinary visit', async () => {
    expect(await render()).not.toContain('role="alert"');
  });
});
