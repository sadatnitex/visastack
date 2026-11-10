import { describe, expect, it } from 'vitest';
import { FIELD_METHOD_WORDS, FIELD_STATUS_WORDS, fieldMethodWords } from './field-state-words';

describe('the words for a saved value (lane 1, plain words)', () => {
  it('has a word for every stored state a person can see', () => {
    for (const code of [
      'DECLARED',
      'EXTRACTED_PENDING',
      'APPLICANT_CONFIRMED',
      'DOCUMENT_SUPPORTED',
      'AGENCY_REVIEWED',
      'CONFLICTED',
      'STALE',
      'SUPERSEDED',
    ]) {
      expect(FIELD_STATUS_WORDS[code], code).toBeTruthy();
    }
  });

  it('never lets a suggestion read as confirmed or reviewed, and keeps each state apart', () => {
    const { EXTRACTED_PENDING, DOCUMENT_SUPPORTED, APPLICANT_CONFIRMED, AGENCY_REVIEWED } =
      FIELD_STATUS_WORDS;
    const words = Object.values(FIELD_STATUS_WORDS);
    expect(new Set(words).size).toBe(words.length);
    expect(EXTRACTED_PENDING).toBe('Suggested');
    expect(EXTRACTED_PENDING).not.toMatch(/confirm|review|approv/i);
    expect(DOCUMENT_SUPPORTED).not.toMatch(/confirm|review|approv/i);
    expect(APPLICANT_CONFIRMED).toBe('Confirmed');
    expect(AGENCY_REVIEWED).toMatch(/^Reviewed by an Agency$/);
  });

  it('is free of engineering words', () => {
    for (const word of [
      ...Object.values(FIELD_STATUS_WORDS),
      ...Object.values(FIELD_METHOD_WORDS),
    ]) {
      expect(word).not.toMatch(/stale|conflicted|superseded|declared|manual|\bapi\b|system/i);
    }
  });

  it('shows a method in words and never shows a code it does not know', () => {
    expect(fieldMethodWords('MANUAL')).toBe('Typed In');
    expect(fieldMethodWords('API')).toBe('From a Connected App');
    expect(fieldMethodWords('SOMETHING_NEW')).toBeNull();
    expect(fieldMethodWords(null)).toBeNull();
  });
});
