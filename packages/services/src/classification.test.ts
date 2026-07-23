import { describe, expect, it } from 'vitest';
import { CONFIDENCE_THRESHOLD, classifyDocumentText } from './classification';

// A valid ICAO TD3 specimen (same fixture as mrz test — check digits verified).
const L1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
const L2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';

describe('classifyDocumentText', () => {
  it('classifies a passport from a valid TD3 MRZ with full confidence', () => {
    const result = classifyDocumentText(`PASSPORT\n${L1}\n${L2}\n`);
    expect(result.classifiedType).toBe('PASSPORT');
    expect(result.confidence).toBe(100);
    expect(result.reviewRequired).toBe(false);
    expect(result.mrz?.passportNumber).toBe('L898902C3');
  });

  it('does not classify as passport when MRZ check digits fail (tampered/misread)', () => {
    const tampered = `L898902C46${L2.slice(10)}`;
    const result = classifyDocumentText(`PASSPORT\n${L1}\n${tampered}\n`);
    expect(result.classifiedType).not.toBe('PASSPORT');
  });

  it('classifies a bank statement from enough keyword hits', () => {
    const text =
      'Statement of Account\nOpening Balance: 100\nClosing Balance: 200\nAccount Number: 12345';
    const result = classifyDocumentText(text);
    expect(result.classifiedType).toBe('BANK_STATEMENT');
    expect(result.reviewRequired).toBe(false);
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  it('classifies an employment certificate from enough keyword hits', () => {
    const text =
      'To Whom It May Concern: This is to certify that the employee is employed here. Date of joining: 2020-01-01.';
    const result = classifyDocumentText(text);
    expect(result.classifiedType).toBe('EMPLOYMENT_CERTIFICATE');
    expect(result.reviewRequired).toBe(false);
  });

  it('requires review when only one keyword matches (below the confidence threshold)', () => {
    const text = 'account number: 12345'; // only 1 of 6 bank-statement keywords
    const result = classifyDocumentText(text);
    expect(result.classifiedType).toBeNull();
    expect(result.reviewRequired).toBe(true);
  });

  it('requires review and never guesses when nothing matches', () => {
    const result = classifyDocumentText('The quick brown fox jumps over the lazy dog.');
    expect(result.classifiedType).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reviewRequired).toBe(true);
  });

  it('picks the rule with the most hits when multiple could plausibly match', () => {
    // Bank-statement text with one stray employment-ish word — bank statement
    // rule should still win since it has more total hits.
    const text =
      'Statement of Account\nOpening Balance: 100\nClosing Balance: 200\nAccount Number: 12345\nTransaction History attached. is employed';
    const result = classifyDocumentText(text);
    expect(result.classifiedType).toBe('BANK_STATEMENT');
  });
});
