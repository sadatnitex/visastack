import { MEMBERSHIP_ROLES, ORGANIZATION_STATUSES } from '@visastack/core';
import { schema } from '@visastack/db';
import { describe, expect, it } from 'vitest';
import {
  AI_CONFIG_STATUS_LABELS,
  AUDIT_RESULT_LABELS,
  BILLING_STATUS_LABELS,
  COMPLAINT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  MEMBERSHIP_ROLE_LABELS,
  ORGANIZATION_STATUS_LABELS,
  REVIEW_DECISION_LABELS,
  aiProviderLabel,
  documentTypeLabel,
  eventTypeLabel,
  membershipRoleLabel,
  titleCase,
} from './labels';

const TABLES: ReadonlyArray<
  readonly [string, readonly string[], Readonly<Record<string, string>>]
> = [
  ['membership role', MEMBERSHIP_ROLES, MEMBERSHIP_ROLE_LABELS],
  ['organization status', ORGANIZATION_STATUSES, ORGANIZATION_STATUS_LABELS],
  ['complaint status', schema.caseComplaintStatus.enumValues, COMPLAINT_STATUS_LABELS],
  ['review decision', schema.missionDecisionOutcome.enumValues, REVIEW_DECISION_LABELS],
  ['billing status', schema.billingStatus.enumValues, BILLING_STATUS_LABELS],
  ['invoice status', schema.invoiceStatus.enumValues, INVOICE_STATUS_LABELS],
  ['AI setting status', schema.aiProviderConfigStatus.enumValues, AI_CONFIG_STATUS_LABELS],
  ['audit result', schema.auditResult.enumValues, AUDIT_RESULT_LABELS],
];

describe('plain labels for stored codes', () => {
  for (const [name, values, labels] of TABLES) {
    it(`${name}: every stored value has a plain label, and nothing else`, () => {
      expect(Object.keys(labels).sort()).toEqual([...values].sort());
      for (const value of values) {
        const label = labels[value] ?? '';
        expect(label, value).not.toBe(value);
        expect(label, value).not.toMatch(/[_]|^[A-Z0-9 ]+$/);
        // Stand-alone labels have every word capitalised.
        expect(label, value).toMatch(/^([A-Z][a-z]*)( [A-Z][a-z]*)*$/);
      }
    });
  }

  it('document types read as plain words, whatever the case of the stored code', () => {
    expect(documentTypeLabel('PASSPORT')).toBe('Passport');
    expect(documentTypeLabel('bank_statement')).toBe('Bank Statement');
    expect(documentTypeLabel('EMPLOYMENT_CERTIFICATE')).toBe('Employment Certificate');
    expect(Object.keys(DOCUMENT_TYPE_LABELS)).toHaveLength(3);
  });

  it('a code with no hand-written label still shows as readable words, never the raw code', () => {
    expect(documentTypeLabel('DRIVERS_LICENSE')).toBe('Drivers License');
    expect(membershipRoleLabel('FUTURE_ROLE')).toBe('Future Role');
    expect(eventTypeLabel('ACCOUNT_CREATED')).toBe('Account Created');
    expect(titleCase('')).toBe('');
  });

  it('names the AI providers the way their owners write them', () => {
    expect(aiProviderLabel('openai')).toBe('OpenAI');
    expect(aiProviderLabel('gemini')).toBe('Gemini');
    expect(aiProviderLabel('something-new')).toBe('Something New');
  });
});
