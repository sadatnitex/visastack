import { keyedError, serviceError } from '@visastack/services';
import { serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn' }));
vi.mock('./locale', () => ({ getLocale: async () => state.locale }));

const { serviceErrorMessage } = await import('./service-error-message');

const BENGALI = /[ঀ-৿]/;
const bnKeys = Object.keys(serviceMessages.bn).filter((key) => key.startsWith('sharing.'));

beforeEach(() => {
  state.locale = 'en';
});

describe('serviceErrorMessage for sharing refusals', () => {
  it('has Bangla for exactly the checked sharing wording', () => {
    expect(bnKeys.length).toBeGreaterThan(0);
    for (const key of bnKeys) expect(serviceMessages.en).toHaveProperty(key);
  });

  it('under en shows the exact English message for every key with Bangla', async () => {
    for (const key of bnKeys) {
      const error = keyedError('invalid', key as never);
      expect(await serviceErrorMessage(error)).toBe(error.message);
    }
  });

  it('under bn shows the Bangla for every key with Bangla (every one)', async () => {
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

  it('under bn keeps English where no checked Bangla exists, and for an unkeyed refusal', async () => {
    state.locale = 'bn';
    // The hidden-record answer is English-only by decision, so it stays English under bn.
    expect(await serviceErrorMessage(keyedError('not_found', 'sharing.inviteUnavailable'))).toBe(
      'Invitation unavailable.',
    );
    expect(await serviceErrorMessage(serviceError('not_found', 'case not found'))).toBe(
      'case not found',
    );
  });
});

describe('the extend button matches the catalogue wording', () => {
  it('the English it compares against is the catalogue value, so a wording change fails here', async () => {
    const { GRANT_EXTEND_ENDED, GRANT_EXTEND_RESUME_FIRST } = await import('@visastack/services');
    expect(keyedError('invalid', 'sharing.extendEnded').message).toBe(GRANT_EXTEND_ENDED);
    expect(keyedError('invalid', 'sharing.extendResumeFirst').message).toBe(
      GRANT_EXTEND_RESUME_FIRST,
    );
  });
});
