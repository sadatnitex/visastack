import { describe, expect, it } from 'vitest';
import { BN, EN, type MessageKey } from './messages';
import { createTranslator, resolveLocale } from './translator';

describe('i18n — bilingual translator', () => {
  it('translates in English and Bangla', () => {
    const en = createTranslator('en');
    const bn = createTranslator('bn');
    expect(en('consent.core.title')).toBe('Core processing consent');
    expect(bn('consent.core.title')).toBe('মূল প্রক্রিয়াকরণ সম্মতি');
  });

  it('interpolates parameters', () => {
    const en = createTranslator('en');
    expect(en('mission.readiness.missing', { count: 3 })).toBe('3 requirement(s) still needed');
    expect(en('grant.pending', { recipient: 'Acme' })).toBe('Waiting for Acme to accept.');
  });

  it('falls back to English for a missing Bangla key', () => {
    const bn = createTranslator('bn');
    // legalHold.active is intentionally not translated yet.
    expect(bn('legalHold.active')).toBe(EN['legalHold.active']);
  });

  it('resolves unknown locales to the default', () => {
    expect(resolveLocale('fr')).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
    expect(resolveLocale('bn')).toBe('bn');
  });

  it('every Bangla key is a valid message key', () => {
    for (const key of Object.keys(BN) as MessageKey[]) {
      expect(EN[key]).toBeDefined();
    }
  });

  it('every English key has a Bangla translation except the one documented fallback case', () => {
    const untranslated = (Object.keys(EN) as MessageKey[]).filter((key) => BN[key] === undefined);
    expect(untranslated).toEqual(['legalHold.active']);
  });
});
