import { describe, expect, it } from 'vitest';
import { plainSentence } from './plain-sentence';

describe('plainSentence', () => {
  it('English: capital first letter and a full stop', () => {
    expect(plainSentence('document not found')).toBe('Document not found.');
    expect(plainSentence('Already ended.')).toBe('Already ended.');
    expect(plainSentence('  ')).toBe('Something went wrong. Try again.');
  });

  it('Bangla ends with the Bangla stop, never an English one', () => {
    expect(plainSentence('এই ডকুমেন্টে পরিবর্তন করা যাবে না', 'bn')).toBe('এই ডকুমেন্টে পরিবর্তন করা যাবে না।');
    expect(plainSentence('এটি শেষ হয়েছে।', 'bn')).toBe('এটি শেষ হয়েছে।');
    expect(plainSentence('আবার চেষ্টা করবেন?', 'bn')).toBe('আবার চেষ্টা করবেন?');
  });

  it('decides by the language shown, not by the first character', () => {
    // A Bangla sentence that starts with a Latin word keeps its case and takes the Bangla stop.
    expect(plainSentence('e-পাসপোর্টের ছবি পাওয়া যায়নি', 'bn')).toBe('e-পাসপোর্টের ছবি পাওয়া যায়নি।');
    expect(plainSentence('PDF ডকুমেন্টটি খোলা যায়নি', 'bn')).toBe('PDF ডকুমেন্টটি খোলা যায়নি।');
    // English stays English even when it happens to quote Bangla first.
    expect(plainSentence('ঢাকা is not a country')).toBe('ঢাকা is not a country.');
  });
});
