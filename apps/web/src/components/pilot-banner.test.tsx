import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';
import { PILOT_BANNER_COPY, PilotBanner } from './pilot-banner';

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

  it('shows the very words the deployment smoke check looks for on every deployment', async () => {
    // scripts/smoke.mjs fetches the landing page of each preview and of production and
    // fails the deploy check if the banner's label is missing. A reworded banner that
    // forgets the script turns every deployment red, so the two are tied together here.
    const smoke = readFileSync(new URL('../../scripts/smoke.mjs', import.meta.url), 'utf8');
    for (const mode of ['controlled_pilot', 'development'] as const) {
      const html = await renderServer(<PilotBanner mode={mode} />);
      expect(html).toContain(PILOT_BANNER_COPY[mode].label);
      expect(smoke, `smoke.mjs should look for "${PILOT_BANNER_COPY[mode].label}"`).toContain(
        PILOT_BANNER_COPY[mode].label,
      );
    }
  });
});
