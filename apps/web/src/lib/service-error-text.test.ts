import { catalogTranslator, defineCatalog } from '@visastack/i18n';
import { keyedErrorWith, serviceError } from '@visastack/services';
import { serviceMessages } from '@visastack/services/i18n';
import { describe, expect, it } from 'vitest';
import { serviceErrorText, serviceErrorTranslator } from './service-error-text';

// A test catalogue stands in for the services one, which is empty until domain errors convert.
const catalog = defineCatalog({
  en: {
    'test.limit': 'You can try {count, plural, one {# more time} other {# more times}} today.',
    'test.plain': 'That was not allowed.',
  },
  bn: {
    'test.limit': 'আজ আর {count, plural, one {# বার} other {# বার}} চেষ্টা করতে পারবেন।',
  },
});
const asString = catalog as unknown as Parameters<typeof catalogTranslator<string>>[0];

describe('serviceErrorText', () => {
  it('a keyed refusal renders bn under bn and the exact old English under en', () => {
    const error = keyedErrorWith(catalog, 'rate_limited', 'test.limit', { count: 3 });
    // The English message is what the service has always returned.
    expect(error.message).toBe('You can try 3 more times today.');
    expect(serviceErrorText(error, catalogTranslator(asString, 'en'))).toBe(
      'You can try 3 more times today.',
    );
    expect(serviceErrorText(error, catalogTranslator(asString, 'bn'))).toBe(
      'আজ আর ৩ বার চেষ্টা করতে পারবেন।',
    );
  });

  it('shows the English message when Bangla has no value for the key', () => {
    const error = keyedErrorWith(catalog, 'forbidden', 'test.plain');
    expect(serviceErrorText(error, catalogTranslator(asString, 'bn'))).toBe(
      'That was not allowed.',
    );
  });

  it('shows error.message for a refusal with no key', () => {
    const error = serviceError('not_found', 'case not found');
    expect(serviceErrorText(error, catalogTranslator(asString, 'bn'))).toBe('case not found');
  });

  it('shows error.message for a key the translator does not know', () => {
    const error = { ...serviceError('invalid', 'Old English sentence'), messageKey: 'never.heard' };
    expect(serviceErrorText(error, serviceErrorTranslator('bn'))).toBe('Old English sentence');
  });

  it('keeps raw numbers raw: no key, no params for a plain refusal', () => {
    const plain = keyedErrorWith(catalog, 'invalid', 'test.plain');
    expect('params' in plain).toBe(false);
    const counted = keyedErrorWith(catalog, 'invalid', 'test.limit', { count: 1000 });
    expect(counted.params).toEqual({ count: 1000 });
    expect(counted.message).toBe('You can try 1000 more times today.');
  });

  it('the services catalogue builds a working translator', () => {
    expect(serviceMessages.en).toBeTypeOf('object');
    expect(serviceErrorTranslator('en')).toBeTypeOf('function');
  });
});
