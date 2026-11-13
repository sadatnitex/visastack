import { describe, expect, it } from 'vitest';
import { keyedError } from './errors';
import { caseFlowABn, caseFlowAEn } from './i18n/case-flow-a';
import { serviceMessages } from './i18n/messages';

const tokens = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)/g)].map((m) => m[1] ?? '').sort();

describe('case flow messages (part A)', () => {
  const keys = Object.keys(caseFlowAEn) as (keyof typeof caseFlowAEn)[];

  it('every key is registered in the services catalogue', () => {
    for (const key of keys) expect(serviceMessages.en[key]).toBe(caseFlowAEn[key]);
  });

  it('a keyed error carries the English sentence as its message', () => {
    for (const key of keys) {
      if (tokens(caseFlowAEn[key]).length > 0) continue;
      expect(keyedError('invalid', key).message).toBe(caseFlowAEn[key]);
    }
    expect(keyedError('invalid', 'umpe_trip_service.trip_full', { max: 12 }).message).toBe(
      'A trip holds up to 12 travellers.',
    );
    expect(
      keyedError('invalid', 'umpe_trip_companions.trip_companions_max', { max: 20 }).message,
    ).toBe('A trip can include up to 20 people travelling with you.');
  });

  it('a Bengali value only exists for a key, and keeps the same placeholders', () => {
    for (const key of Object.keys(caseFlowABn) as (keyof typeof caseFlowABn)[]) {
      expect(keys).toContain(key);
      expect(tokens(caseFlowABn[key])).toEqual(tokens(caseFlowAEn[key]));
    }
  });
});
