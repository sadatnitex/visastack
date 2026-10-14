import { describe, expect, it } from 'vitest';
import { parseDocumentTypeInput, parseFieldKeyInput } from './catalogue-input';
import { documentTypeLabel } from './labels';

describe('document type names typed by an admin', () => {
  it('saves the one canonical key whatever way it was typed', () => {
    for (const typed of ['SALARY_SLIP', 'salary slip', 'Pay Slip', ' payslip ']) {
      expect(parseDocumentTypeInput(typed)).toMatchObject({ ok: true, key: 'SALARY_SLIP' });
    }
    expect(parseDocumentTypeInput('bank_statement')).toMatchObject({
      ok: true,
      key: 'BANK_STATEMENT',
    });
  });

  it('finds the Bangladesh tax acknowledgement slip by any usual name', () => {
    for (const typed of [
      'Tax Acknowledgement Receipt',
      'tax ack slip',
      'TAX_ACKNOWLEDGEMENT_SLIP',
    ]) {
      expect(parseDocumentTypeInput(typed)).toMatchObject({
        ok: true,
        key: 'TAX_ACKNOWLEDGEMENT_SLIP',
      });
    }
  });

  it('refuses a name it does not know and says how to continue', () => {
    const r = parseDocumentTypeInput('some made up paper');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Other/);
    expect(parseDocumentTypeInput('   ').ok).toBe(false);
  });

  it('accepts an Other type', () => {
    expect(parseDocumentTypeInput('Other Financial Document')).toMatchObject({
      ok: true,
      key: 'OTHER_FINANCIAL_DOCUMENT',
    });
  });
});

describe('field keys typed by an admin', () => {
  it('accepts live and catalogue fields in any usual spelling', () => {
    expect(parseFieldKeyInput('Passport Number')).toMatchObject({
      ok: true,
      key: 'passport_number',
    });
    expect(parseFieldKeyInput('tax-ack-slip-number')).toMatchObject({
      ok: true,
      key: 'tax_ack_slip_number',
    });
    expect(parseFieldKeyInput('nid_number')).toMatchObject({ ok: true, key: 'nid_number' });
  });

  it('refuses a key that is not a profile field', () => {
    expect(parseFieldKeyInput('not_a_field').ok).toBe(false);
    expect(parseFieldKeyInput('').ok).toBe(false);
  });
});

describe('document names shown to people', () => {
  it('uses the catalogue name for any known type or alias', () => {
    expect(documentTypeLabel('NID')).toBe('National ID Card');
    expect(documentTypeLabel('payslip')).toBe('Salary Slip');
    expect(documentTypeLabel('BANK_STATEMENT')).toBe('Bank Statement');
  });

  it('still shows an unknown code as readable words', () => {
    expect(documentTypeLabel('consent_letter')).toBe('Consent Letter');
  });
});
