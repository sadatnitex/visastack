import { describe, expect, it } from 'vitest';
import { LANDING_MESSAGES } from '../i18n/landing-messages';
import { landingStatus } from './landing-status';

const en = (key: keyof typeof LANDING_MESSAGES) => LANDING_MESSAGES[key].en;

describe('the home page words about the product state (LAND1)', () => {
  it('says controlled pilot while registration is closed in the pilot, and asks for sample data', () => {
    const s = landingStatus('controlled_pilot', false);
    expect(en(s.assurance)).toBe('VisaStack is in a controlled pilot');
    expect(en(s.answer)).toBe(
      'Use sample data during the controlled pilot. Check the {link} for what’s available.',
    );
  });

  it('says public beta once registration is open, and does not repeat the Terms on real documents', () => {
    const s = landingStatus('controlled_pilot', true);
    expect(en(s.assurance)).toBe('VisaStack is in public beta');
    expect(en(s.answer)).not.toMatch(/sample|real|own risk/i);
  });

  it('says test build in development and offers no pilot words there', () => {
    const s = landingStatus('development', false);
    expect(en(s.assurance)).toBe('This is a test build');
    expect(`${en(s.assurance)} ${en(s.answer)}`).not.toContain('pilot');
  });

  it('claims nothing about pilots or betas in commercial mode', () => {
    const s = landingStatus('commercial', false);
    expect(`${en(s.assurance)} ${en(s.answer)}`).not.toMatch(/pilot|beta|test build/i);
  });

  it('gives each mode its own distinct words, in Bengali too, so no mode can borrow another', () => {
    const picks = [
      landingStatus('controlled_pilot', false),
      landingStatus('controlled_pilot', true),
      landingStatus('development', false),
      landingStatus('commercial', false),
    ];
    for (const field of ['assurance', 'answer'] as const) {
      expect(new Set(picks.map((p) => p[field])).size).toBe(4);
      expect(new Set(picks.map((p) => LANDING_MESSAGES[p[field]].bn)).size).toBe(4);
    }
  });

  it('keeps the status page link inside every answer, in both languages', () => {
    for (const mode of ['controlled_pilot', 'development', 'commercial'] as const)
      for (const open of [true, false]) {
        const message = LANDING_MESSAGES[landingStatus(mode, open).answer];
        expect(message.en).toContain('{link}');
        expect(message.bn).toContain('{link}');
      }
  });
});
