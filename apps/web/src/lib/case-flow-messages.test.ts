import { keyedError } from '@visastack/services';
import { serviceMessages } from '@visastack/services/i18n';
import { describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ value: 'en' as 'en' | 'bn' }));
vi.mock('./locale', () => ({ getLocale: async () => locale.value }));

import { serviceErrorMessage } from './service-error-message';

describe('case flow refusals on the screens', () => {
  const enText = serviceMessages.en as Record<string, string>;
  const bnText = serviceMessages.bn as Record<string, string>;
  const bnKeys = Object.keys(bnText);

  it('shows the exact English under en for every keyed message', async () => {
    locale.value = 'en';
    for (const [key, english] of Object.entries(enText)) {
      if (/\{/.test(english)) continue;
      expect(
        await serviceErrorMessage(keyedError('invalid', key as keyof typeof serviceMessages.en)),
      ).toBe(english);
    }
  });

  it('shows the Bengali under bn for every key that has a draft, in matching number', async () => {
    locale.value = 'bn';
    expect(bnKeys.length).toBeGreaterThan(0);
    let rendered = 0;
    for (const key of bnKeys) {
      expect(
        await serviceErrorMessage(keyedError('invalid', key as keyof typeof serviceMessages.en)),
      ).toBe(bnText[key]);
      rendered += 1;
    }
    expect(rendered).toBe(bnKeys.length);
  });

  it('shows English under bn when the key has no Bengali yet', async () => {
    locale.value = 'bn';
    // The hidden-record answer is English-only by decision, so it stays English under bn.
    expect(await serviceErrorMessage(keyedError('not_found', 'sharing.inviteUnavailable'))).toBe(
      'Invitation unavailable.',
    );
  });

  it('puts a raw number into the sentence for a refusal with a number', async () => {
    locale.value = 'en';
    expect(
      await serviceErrorMessage(keyedError('invalid', 'umpe_trip_service.trip_full', { max: 5 })),
    ).toBe('A trip holds up to 5 travellers.');
  });
});
