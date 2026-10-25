import type { MembershipRole, OrganizationStatus } from '@visastack/core';
import { documentTypeName } from '@visastack/core/catalogue/documents';
import type { schema } from '@visastack/db';
import type { CaseTriageState, TriageGroup, TriageIndicator } from '@visastack/services';

/**
 * Plain words for the codes the database stores. Display only: nothing here is ever saved,
 * sorted, filtered or compared, so a stored value never changes. A stand-alone label has every
 * word capitalised (Case Manager); inside a sentence, lower-case it (`.toLowerCase()`).
 *
 * Each table is typed against the stored values, so a new value without a label fails the type
 * check, and `labels.test.ts` checks the same at run time. An unknown code from older or newer
 * data still shows as readable words, never as the raw code.
 */

type Values<T extends { readonly enumValues: readonly string[] }> = T['enumValues'][number];

/** "BANK_STATEMENT" or "bank_statement" becomes "Bank Statement". */
export function titleCase(code: string): string {
  return code
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function pick(table: Readonly<Record<string, string>>, code: string): string {
  return table[code] ?? titleCase(code);
}

export const MEMBERSHIP_ROLE_LABELS: Readonly<Record<MembershipRole, string>> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  CASE_MANAGER: 'Case Manager',
  REVIEWER: 'Reviewer',
};

export const ORGANIZATION_STATUS_LABELS: Readonly<Record<OrganizationStatus, string>> = {
  PENDING_VERIFICATION: 'Waiting For Review',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  REJECTED: 'Not Approved',
  CLOSED: 'Closed',
};

export const COMPLAINT_STATUS_LABELS: Readonly<
  Record<Values<typeof schema.caseComplaintStatus>, string>
> = {
  OPEN: 'Open',
  IN_PROGRESS: 'Being Handled',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const REVIEW_DECISION_LABELS: Readonly<
  Record<Values<typeof schema.missionDecisionOutcome>, string>
> = {
  ACCEPTED: 'Accepted',
  REJECTED: 'Not Accepted',
};

export const BILLING_STATUS_LABELS: Readonly<Record<Values<typeof schema.billingStatus>, string>> =
  {
    TRIAL: 'Trial',
    ACTIVE: 'Active',
    GRACE: 'Grace Period',
    SUSPENDED: 'Suspended',
    CLOSED: 'Closed',
  };

export const INVOICE_STATUS_LABELS: Readonly<Record<Values<typeof schema.invoiceStatus>, string>> =
  {
    OPEN: 'Unpaid',
    PARTIALLY_PAID: 'Partly Paid',
    PAID: 'Paid',
    VOID: 'Cancelled',
  };

export const AI_CONFIG_STATUS_LABELS: Readonly<
  Record<Values<typeof schema.aiProviderConfigStatus>, string>
> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  SUPERSEDED: 'Replaced',
  DISABLED: 'Turned Off',
};

export const AUDIT_RESULT_LABELS: Readonly<Record<Values<typeof schema.auditResult>, string>> = {
  ALLOWED: 'Allowed',
  DENIED: 'Denied',
};

/** Document types the product recognises by name; any other type shows as readable words. */
export const DOCUMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  PASSPORT: 'Passport',
  BANK_STATEMENT: 'Bank Statement',
  EMPLOYMENT_CERTIFICATE: 'Employment Certificate',
};

export const AI_PROVIDER_LABELS: Readonly<Record<string, string>> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
};

export const membershipRoleLabel = (code: string) => pick(MEMBERSHIP_ROLE_LABELS, code);
export const organizationStatusLabel = (code: string) => pick(ORGANIZATION_STATUS_LABELS, code);
export const complaintStatusLabel = (code: string) => pick(COMPLAINT_STATUS_LABELS, code);
export const reviewDecisionLabel = (code: string) => pick(REVIEW_DECISION_LABELS, code);
export const billingStatusLabel = (code: string) => pick(BILLING_STATUS_LABELS, code);
export const invoiceStatusLabel = (code: string) => pick(INVOICE_STATUS_LABELS, code);
export const aiConfigStatusLabel = (code: string) => pick(AI_CONFIG_STATUS_LABELS, code);
export const auditResultLabel = (code: string) => pick(AUDIT_RESULT_LABELS, code);
export const aiProviderLabel = (code: string) => pick(AI_PROVIDER_LABELS, code);
/**
 * The agency triage groups (Programme X E02, PROGRAMME.md section 8): one primary group per item.
 * Received is never Reviewed, and Ready for Review is a statement about the whole case.
 */
export const TRIAGE_GROUP_LABELS: Readonly<Record<TriageGroup, string>> = {
  MISSING: 'Missing',
  PROCESSING: 'Processing',
  RECEIVED: 'Received or Awaiting Confirmation',
  NEEDS_CORRECTION: 'Needs Correction or Clarification',
  REVIEWED: 'Reviewed',
};

/** The case-level line above a triage summary. Completeness only, never a chance of approval. */
export const CASE_TRIAGE_STATE_LABELS: Readonly<Record<CaseTriageState, string>> = {
  READY_FOR_REVIEW: 'Ready for Review',
  NOT_READY: 'Not Ready for Review',
  CHECKED_BY_HAND: 'Checked by Hand',
  NO_CHECKLIST: 'No Checklist Attached',
};

/** Short notes beside an item's group. They explain the group and never replace it. */
export const TRIAGE_INDICATOR_LABELS: Readonly<Record<TriageIndicator, string>> = {
  OPTIONAL: 'Optional',
  OUT_OF_DATE: 'Out of Date',
  ANSWER_NEEDED: 'Answer Needed First',
  DOES_NOT_MATCH: 'Does Not Match Other Details',
  NOT_ACCEPTED: 'Not Accepted',
  SENT_BACK: 'Sent Back for a Fix',
  REVIEW_STARTED: 'Review Started',
  COULD_NOT_BE_USED: 'Could Not Be Used',
};

/** "bank_statement" and "BANK_STATEMENT" both give "Bank Statement". */
export const documentTypeLabel = (code: string) =>
  documentTypeName(code) ?? pick(DOCUMENT_TYPE_LABELS, code.toUpperCase());
/** An audit event such as ACCOUNT_CREATED, as "Account Created". */
export const eventTypeLabel = (code: string) => titleCase(code);

/**
 * The six consents in plain English, for English screens. Bangla screens keep the existing translated
 * names until the Bangla work resumes. The meaning line says only what the product does.
 */
export const CONSENT_PLAIN: Readonly<
  Record<string, { readonly name: string; readonly meaning: string }>
> = {
  CORE_PROCESSING: {
    name: 'Let VisaStack process my details',
    meaning: 'Needed before documents are stored and your profile can be filled.',
  },
  AI_EXTRACTION: {
    name: 'Let AI read details from my documents',
    meaning:
      'The text of a document is sent to an AI service to suggest values. You approve each one.',
  },
  AI_OCR: {
    name: 'Let AI read text from my scans',
    meaning:
      'The picture of a scan is sent to an AI service to read it. This shares more than text alone.',
  },
  SHARING: {
    name: 'Let me share with others',
    meaning: 'Needed before anything is shared with an agency or another person.',
  },
  MARKETING: {
    name: 'Send me news and offers',
    meaning: 'Optional. You can use VisaStack without it.',
  },
  ISSUER_CONTACT: {
    name: 'Let an agency check a document with its issuer',
    meaning:
      'An agency may contact a bank, university or other issuer to confirm a fact or document for you.',
  },
};

/** The plain name of a consent, or the readable words of its code when it is not listed. */
export const consentName = (type: string) => CONSENT_PLAIN[type]?.name ?? titleCase(type);
