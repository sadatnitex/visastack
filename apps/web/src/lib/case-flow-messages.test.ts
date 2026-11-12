import { keyedError } from '@visastack/services';
import { serviceMessages } from '@visastack/services/i18n';
import { describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ value: 'en' as 'en' | 'bn' }));
vi.mock('./locale', () => ({ getLocale: async () => locale.value }));

import { refusalText } from './service-error-message';

describe('case flow refusals on the screens', () => {
  const enText = serviceMessages.en as Record<string, string>;
  const bnText = serviceMessages.bn as Record<string, string>;
  const bnKeys = Object.keys(bnText);

  it('shows the exact English under en for every keyed message', async () => {
    locale.value = 'en';
    for (const [key, english] of Object.entries(enText)) {
      if (/\{/.test(english)) continue;
      expect(await refusalText(keyedError('invalid', key as keyof typeof serviceMessages.en))).toBe(
        english,
      );
    }
  });

  it('shows the Bengali under bn for every key that has a draft, in matching number', async () => {
    locale.value = 'bn';
    let rendered = 0;
    for (const key of bnKeys) {
      expect(await refusalText(keyedError('invalid', key as keyof typeof serviceMessages.en))).toBe(
        bnText[key],
      );
      rendered += 1;
    }
    expect(rendered).toBe(bnKeys.length);
  });

  it('shows English under bn when the key has no Bengali yet', async () => {
    locale.value = 'bn';
    expect(await refusalText(keyedError('not_found', 'missions.case_not_found'))).toBe(
      'case not found',
    );
  });
});
