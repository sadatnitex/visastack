import { describe, expect, it } from 'vitest';
import { landingStatus } from './landing-status';

describe('the home page words about the product state (LAND1)', () => {
  it('says controlled pilot while registration is closed in the pilot, and asks for sample data', () => {
    expect(landingStatus('controlled_pilot', false)).toEqual({
      assurance: 'VisaStack is in a controlled pilot',
      realDocuments: 'Use sample data during the controlled pilot. Check the',
    });
  });

  it('says public beta once registration is open, and does not repeat the Terms on real documents', () => {
    const beta = landingStatus('controlled_pilot', true);
    expect(beta.assurance).toBe('VisaStack is in public beta');
    expect(beta.realDocuments).not.toMatch(/sample|real|own risk/i);
  });

  it('says test build in development and offers no pilot words there', () => {
    const dev = landingStatus('development', false);
    expect(dev.assurance).toBe('This is a test build');
    expect(JSON.stringify(dev)).not.toContain('pilot');
  });

  it('claims nothing about pilots or betas in commercial mode', () => {
    const live = landingStatus('commercial', false);
    expect(JSON.stringify(live)).not.toMatch(/pilot|beta|test build/i);
  });

  it('ends every answer where the page puts its link to the status page', () => {
    for (const mode of ['controlled_pilot', 'development', 'commercial'] as const)
      for (const open of [true, false])
        expect(landingStatus(mode, open).realDocuments.endsWith('Check the')).toBe(true);
  });
});
