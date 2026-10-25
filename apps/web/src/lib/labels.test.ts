import { MEMBERSHIP_ROLES, ORGANIZATION_STATUSES, PERMISSION_ACTIONS } from '@visastack/core';
import { schema } from '@visastack/db';
import { TRIAGE_GROUPS } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import {
  AI_CONFIG_STATUS_LABELS,
  AUDIT_RESULT_LABELS,
  BILLING_STATUS_LABELS,
  CASE_TRIAGE_STATE_LABELS,
  COMPLAINT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  MEMBERSHIP_ROLE_LABELS,
  ORGANIZATION_STATUS_LABELS,
  PERMISSION_ACTION_LABELS,
  REVIEW_DECISION_LABELS,
  TRIAGE_GROUP_LABELS,
  TRIAGE_INDICATOR_LABELS,
  aiProviderLabel,
  documentTypeLabel,
  eventTypeLabel,
  membershipRoleLabel,
  permissionActionLabel,
  titleCase,
} from './labels';

import { toTitleCase } from './title-case';
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
        // Stand-alone labels are names in Title Case: every word capitalised apart from small
        // joining words ("Waiting for Review"), and only letters and spaces.
        expect(label, value).toMatch(/^[A-Z][A-Za-z ]*$/);
        expect(label, value).toBe(toTitleCase(label));
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
    expect(documentTypeLabel('SCRAPBOOK_PAGE')).toBe('Scrapbook Page');
    // A name the catalogue knows (an alias) now shows its proper name.
    expect(documentTypeLabel('DRIVERS_LICENSE')).toBe('Driving Licence');
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

describe('consent names', () => {
  it('has a plain name and a meaning for every consent type, with no stored code showing', async () => {
    const { CONSENT_TYPES } = await import('@visastack/core');
    const { CONSENT_PLAIN, consentName } = await import('./labels');
    for (const type of CONSENT_TYPES) {
      const entry = CONSENT_PLAIN[type];
      expect(entry, type).toBeDefined();
      expect(entry?.name).not.toMatch(/_|consent|processing|OCR/i);
      expect(entry?.meaning.length).toBeGreaterThan(20);
      expect(consentName(type)).toBe(entry?.name);
    }
    expect(consentName('SOMETHING_NEW')).toBe('Something New');
  });
});

describe('sharing permission names', () => {
  it('names every permission, in Title Case, and nothing else', () => {
    expect(Object.keys(PERMISSION_ACTION_LABELS).sort()).toEqual([...PERMISSION_ACTIONS].sort());
    for (const label of Object.values(PERMISSION_ACTION_LABELS)) {
      expect(label).toBe(toTitleCase(label));
    }
  });

  it('calls DOWNLOAD_REDACTED a safe copy everywhere, keeping the stored key', () => {
    expect(permissionActionLabel('DOWNLOAD_REDACTED')).toBe('Download Safe Copies');
    expect(Object.values(PERMISSION_ACTION_LABELS).join(' ')).not.toMatch(/redact/i);
    expect(permissionActionLabel('SOMETHING_NEW')).toBe('Something New');
  });
});

describe('agency triage words (Programme X E02)', () => {
  it('names each of the five item groups once, in the programme vocabulary', () => {
    expect(Object.keys(TRIAGE_GROUP_LABELS).sort()).toEqual([...TRIAGE_GROUPS].sort());
    expect(TRIAGE_GROUPS.map((group) => TRIAGE_GROUP_LABELS[group])).toEqual([
      'Missing',
      'Processing',
      'Received or Awaiting Confirmation',
      'Needs Correction or Clarification',
      'Reviewed',
    ]);
    expect(CASE_TRIAGE_STATE_LABELS.READY_FOR_REVIEW).toBe('Ready for Review');
  });

  it('never uses a word that claims more than the product knows', () => {
    const words = [
      ...Object.values(TRIAGE_GROUP_LABELS),
      ...Object.values(CASE_TRIAGE_STATE_LABELS),
      ...Object.values(TRIAGE_INDICATOR_LABELS),
    ].join(' | ');
    expect(words).not.toMatch(/verified|approved|guarantee|submitted/i);
    // A received item is not reviewed: only the Reviewed group may say so.
    expect(TRIAGE_GROUP_LABELS.RECEIVED).not.toMatch(/review/i);
  });
});
