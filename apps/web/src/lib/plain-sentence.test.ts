import { describe, expect, it } from 'vitest';
import { plainSentence } from './plain-sentence';

describe('plainSentence', () => {
  it('English: capital first letter and a full stop', () => {
    expect(plainSentence('document not found')).toBe('Document not found.');
    expect(plainSentence('Already ended.')).toBe('Already ended.');
    expect(plainSentence('  ')).toBe('Something went wrong. Try again.');
  });

  it('Bangla ends with the Bangla stop, never an English one', () => {
    expect(plainSentence('এই ডকুমেন্টে পরিবর্তন করা যাবে না')).toBe('এই ডকুমেন্টে পরিবর্তন করা যাবে না।');
    expect(plainSentence('এটি শেষ হয়েছে।')).toBe('এটি শেষ হয়েছে।');
  });
});
