import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';
import { PILOT_BANNER_COPY, PilotBanner } from './pilot-banner';

describe('the banner every page carries', () => {
  it('names the public beta and shows nothing else but the What Works Today link', async () => {
    const text = textOf(
      await renderServer(<PilotBanner mode="controlled_pilot" registrationOpen />),
    );
    expect(text).toContain('VisaStack Public Beta');
    expect(text).toContain('What Works Today');
    expect(text).not.toContain('own risk');
    expect(text).not.toContain('virus');
    expect(text).not.toContain('made-up details');
    expect(text).not.toContain('Invite-only');
    const smoke = readFileSync(new URL('../../scripts/smoke.mjs', import.meta.url), 'utf8');
    expect(smoke).toContain('VisaStack Public Beta');
  });
  it('says in plain words that the pilot is a test version for made-up or blacked-out information', async () => {
    const html = await renderServer(<PilotBanner mode="controlled_pilot" />);
    const text = textOf(html);
    expect(text).toContain('VisaStack Private Pilot');
    expect(text).toContain('Invite-only test version.');
    expect(text).toContain('made-up details');
    expect(text).toContain('permanently blacked out');
    expect(text).toContain('What Works Today');
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
    expect(text).toContain('VisaStack Test Build');
    expect(text).toContain('Not for real personal data.');
  });

  it('is a named landmark, so a screen reader user can find it and move past it', async () => {
    for (const mode of ['controlled_pilot', 'development'] as const) {
      const html = await renderServer(<PilotBanner mode={mode} />);
      // A <section> with an accessible name is a "region" landmark.
      expect(html).toContain('<section class="pilot-banner" aria-label="About this version">');
    }
  });

  it('keeps the same meaning in its short phone wording', async () => {
    const beta = await renderServer(<PilotBanner mode="controlled_pilot" registrationOpen />);
    expect(beta).not.toContain('pilot-banner-short');
    const pilot = await renderServer(<PilotBanner mode="controlled_pilot" />);
    expect(pilot).toContain(
      '<span class="pilot-banner-short">Test version. Made-up details only.</span>',
    );
    const dev = await renderServer(<PilotBanner mode="development" />);
    expect(dev).toContain('<span class="pilot-banner-short">Not for real personal data.</span>');
    // The full sentence stays in the page for wider screens, and the link to the full list stays everywhere.
    expect(beta).not.toContain('pilot-banner-detail');
    expect(beta).toContain('href="/status"');
  });

  it('never asks for made-up details once real personal data is on, and keeps the smoke label (owner, 19 Nov 2026)', async () => {
    // Owner decision, 19 Nov 2026: "stop telling madeup details etc". The pilot keeps its name, which
    // the deployment smoke check looks for, and loses the made-up-details sentence and short line.
    const html = await renderServer(<PilotBanner mode="controlled_pilot" realData />);
    const text = textOf(html);
    expect(text).toContain('VisaStack Private Pilot');
    expect(text).toContain('What Works Today');
    expect(text).not.toMatch(/made-up|Made-up|test version|Test version|blacked out/);
    expect(html).not.toContain('pilot-banner-short');
    const open = textOf(
      await renderServer(<PilotBanner mode="controlled_pilot" registrationOpen realData />),
    );
    expect(open).toContain('VisaStack Public Beta');
    // A development build never takes real data, whatever is passed.
    const dev = textOf(await renderServer(<PilotBanner mode="development" realData />));
    expect(dev).toContain('Not for real personal data.');
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
