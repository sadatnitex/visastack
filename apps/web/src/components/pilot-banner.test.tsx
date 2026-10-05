import { describe, expect, it } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';
import { PilotBanner } from './pilot-banner';

describe('the banner every page carries', () => {
  it('says in plain words that the pilot is a test version for made-up or blacked-out information', async () => {
    const html = await renderServer(<PilotBanner mode="controlled_pilot" />);
    const text = textOf(html);
    expect(text).toContain('VisaStack private pilot');
    expect(text).toContain('Invite-only test version.');
    expect(text).toContain('made-up details');
    expect(text).toContain('permanently blacked out');
    expect(text).toContain('What works today');
    expect(html).toContain('href="/status"');
  });

  it('keeps the meaning the directive requires: nothing real goes in a pilot', async () => {
    const text = textOf(await renderServer(<PilotBanner mode="controlled_pilot" />));
    expect(text).toMatch(/made-up details, or documents with all personal information/);
    for (const jargon of ['synthetic', 'irreversibly', 'redacted']) {
      expect(text, jargon).not.toContain(jargon);
    }
  });

  it('says a development build is not for real personal data', async () => {
    const text = textOf(await renderServer(<PilotBanner mode="development" />));
    expect(text).toContain('VisaStack test build');
    expect(text).toContain('Not for real personal data.');
  });

  it('shows nothing in commercial mode', async () => {
    expect(await renderServer(<PilotBanner mode="commercial" />)).toBe('');
  });
});
