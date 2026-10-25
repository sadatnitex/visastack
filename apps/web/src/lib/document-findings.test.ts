import type { ProfileEntry, ProposalWithEvidence } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import { confirmedValues, findingViewModel } from './document-findings';
import { humanizeFieldKey } from './field-key-label';
import { savableField } from './master-profile';

const reading = (fieldKey: string | null, value: string, snippet = value): ProposalWithEvidence =>
  ({
    proposal: {
      id: `p-${fieldKey}`,
      type: fieldKey ? 'NEW' : 'UNMAPPED',
      fieldKey,
      value,
      confidence: 95,
      rationale: null,
    },
    evidence: [{ snippet, verified: true }],
  }) as unknown as ProposalWithEvidence;

const entry = (
  fieldKey: string,
  value: string,
  extra: Partial<ProfileEntry> = {},
): ProfileEntry => ({
  factId: `f-${fieldKey}`,
  fieldKey,
  repeatingRecordKey: null,
  value,
  status: 'APPLICANT_CONFIRMED',
  method: 'MANUAL',
  updatedAt: null,
  effectiveFrom: null,
  isProtected: false,
  sourceDocumentId: null,
  ...extra,
});

describe('comparing a reading with the profile, on the server', () => {
  it('only a real difference with a confirmed detail asks which is right', () => {
    const confirmed = confirmedValues(
      [
        entry('given_name', 'Ayesha'),
        entry('family_name', 'Khan'),
        entry('occupation', 'Teacher', { status: 'EXTRACTED_PENDING' }),
        entry('address_city', 'Sylhet', { repeatingRecordKey: 'r1' }),
      ],
      true,
    );
    expect(findingViewModel(reading('given_name', 'Ayesha'), confirmed).difference).toBeUndefined();
    expect(findingViewModel(reading('family_name', 'Rahman'), confirmed).difference).toEqual({
      current: 'Khan',
    });
    // Not confirmed, or one record among several: nothing to settle here.
    expect(
      findingViewModel(reading('occupation', 'Engineer'), confirmed).difference,
    ).toBeUndefined();
    expect(
      findingViewModel(reading('address_city', 'Dhaka'), confirmed).difference,
    ).toBeUndefined();
  });

  it('never sends a protected or sensitive value to the page, and compares it only when it can be read', () => {
    const sensitiveKey = 'passport_number';
    expect(savableField(sensitiveKey)?.sensitivity).not.toBe('STANDARD');
    const readable = confirmedValues(
      [entry(sensitiveKey, 'A1234567', { isProtected: true })],
      true,
    );
    expect(
      findingViewModel(reading(sensitiveKey, 'A1234567'), readable).difference,
    ).toBeUndefined();
    expect(findingViewModel(reading(sensitiveKey, 'B7654321'), readable).difference).toEqual({
      current: null,
    });
    // Without the key the stored value cannot be compared: it is settled by the person.
    const unreadable = confirmedValues(
      [entry(sensitiveKey, '[protected]', { isProtected: true })],
      false,
    );
    expect(findingViewModel(reading(sensitiveKey, 'A1234567'), unreadable).difference).toEqual({
      current: null,
    });
    expect(findingViewModel(reading(sensitiveKey, 'A1234567'), unreadable).sensitive).toBe(true);
  });

  it('marks details that never change, repeating ones, and names every detail plainly', () => {
    const none = confirmedValues([], true);
    expect(findingViewModel(reading('date_of_birth', '1990-01-05'), none).fixed).toBe(true);
    expect(findingViewModel(reading('given_name', 'Ayesha'), none).fixed).toBeUndefined();
    expect(findingViewModel(reading('address_city', 'Dhaka'), none).repeating).toBe(true);
    expect(findingViewModel(reading('given_name', 'Ayesha'), none).fieldLabel).toBeTruthy();
    expect(findingViewModel(reading('some_new_detail', 'x'), none).fieldLabel).toBe(
      'Some New Detail',
    );
    expect(humanizeFieldKey('passport__issue_date')).toBe('Passport Issue Date');
  });

  it('a reading is clear only when its value appears in a quote found in the document', () => {
    const none = confirmedValues([], true);
    expect(findingViewModel(reading('given_name', 'Ayesha', 'Name: Ayesha'), none).clear).toBe(
      true,
    );
    expect(findingViewModel(reading('given_name', 'Ayesha', 'Name:'), none).clear).toBe(false);
  });
});
