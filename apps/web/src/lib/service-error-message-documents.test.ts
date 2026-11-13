import { keyedError, serviceError } from '@visastack/services';
import { serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', fail: null as unknown }));
vi.mock('./locale', () => ({
  getLocale: async () => {
    if (state.fail) throw state.fail;
    return state.locale;
  },
}));

const { serviceErrorMessage } = await import('./service-error-message');

const BENGALI = /[ঀ-৿]/;
const bnKeys = Object.keys(serviceMessages.bn).filter(
  (key) => key.startsWith('documents.') || key.startsWith('photos.') || key.startsWith('naming.'),
);

beforeEach(() => {
  state.locale = 'en';
  state.fail = null;
});

describe('serviceErrorMessage for document refusals', () => {
  it('has Bangla for some document wording, all of it with English behind it', () => {
    expect(bnKeys.length).toBeGreaterThan(0);
    for (const key of bnKeys) expect(serviceMessages.en).toHaveProperty(key);
  });

  it('under en shows the exact English message', async () => {
    for (const key of bnKeys) {
      const error = keyedError('invalid', key as never);
      expect(await serviceErrorMessage(error)).toBe(error.message);
    }
  });

  it('under bn shows the Bangla for every key that has it (rendered equals keyed)', async () => {
    state.locale = 'bn';
    let rendered = 0;
    for (const key of bnKeys) {
      const text = await serviceErrorMessage(keyedError('invalid', key as never));
      expect(text).toMatch(BENGALI);
      expect(text).toBe((serviceMessages.bn as Record<string, string>)[key]);
      rendered += 1;
    }
    expect(rendered).toBe(bnKeys.length);
  });

  it('under bn keeps English where no checked Bangla exists', async () => {
    state.locale = 'bn';
    // The hidden-record answer is English-only by decision, so it stays English under bn.
    expect(await serviceErrorMessage(keyedError('not_found', 'sharing.inviteUnavailable'))).toBe(
      'Invitation unavailable.',
    );
    expect(await serviceErrorMessage(serviceError('not_found', 'x not found'))).toBe('x not found');
  });

  it('wording with a name in it fills the name in', async () => {
    const error = keyedError('invalid', 'documents.chosenIsNotAKnownDocument', { chosen: 'Slip' });
    expect(await serviceErrorMessage(error)).toBe(
      '"Slip" is not a known document type. Pick one from the list, or use "Other Document".',
    );
  });

  it('shows English when there is no request to read the language from', async () => {
    state.fail = new Error('cookies called outside a request');
    expect(await serviceErrorMessage(keyedError('not_found', 'documents.documentNotFound'))).toBe(
      'document not found',
    );
  });

  it("lets Next's own redirect signal travel instead of swallowing it", async () => {
    const signal = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/x;307;',
    });
    state.fail = signal;
    await expect(
      serviceErrorMessage(keyedError('not_found', 'documents.documentNotFound')),
    ).rejects.toBe(signal);
  });
});
