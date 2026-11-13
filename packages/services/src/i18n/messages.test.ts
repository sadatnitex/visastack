import { catalogResolve } from '@visastack/i18n';
import { describe, expect, it } from 'vitest';
import { keyedError } from '../errors';
import { type ServiceMessageKey, serviceMessages } from './messages';

const en = serviceMessages.en as Record<string, string>;
const bn = serviceMessages.bn as Partial<Record<string, string>>;
const bnKeys = Object.keys(bn) as ServiceMessageKey[];
const BENGALI = /[ঀ-৿]/;

// One sample value per placeholder: a number for plurals, limits and counts, a word otherwise.
const paramsFor = (message: string) => {
  const params: Record<string, string | number> = {};
  for (const m of message.matchAll(/\{(\w+)(\s*,\s*plural)?/g)) {
    const name = m[1] as string;
    params[name] = m[2] || /(?:max|count|days|n)$/i.test(name) ? 3 : 'Rahim';
  }
  return params;
};

describe('every service message with Bangla', () => {
  it('has English behind it and a Bangla wording of its own', () => {
    expect(bnKeys.length).toBeGreaterThan(300);
    for (const key of bnKeys) {
      expect(en).toHaveProperty(key);
      expect(bn[key], key).toMatch(BENGALI);
      expect(bn[key], key).not.toBe(en[key]);
    }
  });

  it('resolves to the Bangla under bn and to the exact English under en', () => {
    for (const key of bnKeys) {
      const params = paramsFor(en[key] as string);
      const underBn = catalogResolve(serviceMessages, 'bn', key, params);
      expect(underBn.lang, key).toBe('bn');
      expect(underBn.text, key).toMatch(BENGALI);
      // Every placeholder and plural is filled in the Bangla: no brace is left.
      expect(underBn.text, key).not.toMatch(/[{}]/);
      const underEn = catalogResolve(serviceMessages, 'en', key, params);
      expect(underEn.lang, key).toBe('en');
      expect(underEn.text, key).toBe(keyedError('invalid', key, params).message);
      if (!/\{/.test(en[key] as string)) expect(underEn.text, key).toBe(en[key]);
    }
  });

  it('the refusal itself still carries the English, so logs and stored text do not change', () => {
    for (const key of bnKeys) {
      const error = keyedError('invalid', key, paramsFor(en[key] as string));
      expect(error.message, key).not.toMatch(BENGALI);
      expect(error.messageKey).toBe(key);
    }
  });
});
