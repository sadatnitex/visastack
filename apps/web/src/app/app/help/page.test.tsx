import { describe, expect, it } from 'vitest';
import { renderServer, textOf } from '../../../lib/next-mocks.test-support';

const { default: HelpPage } = await import('./page');

describe('Help and Support', () => {
  it('offers a way to reach a person, through the routes the product really has', async () => {
    const html = await renderServer(HelpPage());
    const text = textOf(html);
    expect(html).toContain('id="contact"');
    expect(text).toContain('Get Help from a Person');
    // A complaint or private feedback on the case, both read by VisaStack quality staff.
    expect(text).toContain('Problems and Feedback');
    expect(html).toContain('href="/app/applicants"');
    // Data requests and service problems have their own pages.
    expect(html).toContain('href="/app/privacy"');
    expect(html).toContain('href="/status"');
  });

  it('invents no address, number or answer time that nobody has set up', async () => {
    const html = await renderServer(HelpPage());
    const text = textOf(html);
    expect(html).not.toMatch(/mailto:|tel:|wa\.me/);
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
    expect(text).not.toMatch(/\b(within|in under) \d+|\b24\/7\b|\bhours?\b|\bbusiness days?\b/i);
  });

  it('names each contact route in Title Case, under one heading', async () => {
    const html = await renderServer(HelpPage());
    const headings = [...html.matchAll(/<h3 id="help-contact-[a-z]+">([^<]+)<\/h3>/g)].map(
      (match) => match[1],
    );
    expect(headings).toEqual([
      'A Problem with a Case or an Agency',
      'A Question for Your Agency',
      'Your Data and Privacy',
      'Something Is Not Working',
    ]);
  });
});
