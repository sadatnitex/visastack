import { keyedError, serviceError } from '@visastack/services';
import { serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn' }));
vi.mock('./locale', () => ({ getLocale: async () => state.locale }));

const { serviceErrorSentence } = await import('./service-error-message');

const bn = serviceMessages.bn as Readonly<Record<string, string>>;

beforeEach(() => {
  state.locale = 'en';
});

describe('serviceErrorSentence punctuates by the language the words are shown in', () => {
  it('en: the English gets a capital and a full stop', async () => {
    expect(await serviceErrorSentence(keyedError('not_found', 'missions.case_not_found'))).toBe(
      'Case not found.',
    );
  });

  it('bn: Bangla takes the Bangla stop and is never recased', async () => {
    state.locale = 'bn';
    const own = bn['missions.case_not_found'];
    expect(own).toBeDefined();
    expect(await serviceErrorSentence(keyedError('not_found', 'missions.case_not_found'))).toBe(
      `${own}।`,
    );
  });

  it('bn: a Bangla sentence that starts with a Latin word keeps its words as written', async () => {
    state.locale = 'bn';
    const key = 'umpe_collection_response_service.this_agency_has_not_been_reviewed';
    const own = bn[key] ?? '';
    expect(own).toMatch(/^[A-Za-z]/);
    expect(await serviceErrorSentence(keyedError('invalid', key))).toBe(
      /[।?!]$/.test(own) ? own : `${own}।`,
    );
  });

  it('bn: the English fallback, an unkeyed and an unknown-key refusal are punctuated as English', async () => {
    state.locale = 'bn';
    const fallback = keyedError('invalid', 'umpe_guest_collection.that_code_is_not_right', {
      left: 2,
    });
    expect(bn['umpe_guest_collection.that_code_is_not_right']).toBeUndefined();
    expect(await serviceErrorSentence(fallback)).toBe(fallback.message);
    expect(await serviceErrorSentence(serviceError('invalid', 'document not found'))).toBe(
      'Document not found.',
    );
    expect(
      await serviceErrorSentence({ message: 'older words', messageKey: 'no_such.key_here' }),
    ).toBe('Older words.');
  });
});
