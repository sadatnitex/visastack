import { humanizeCode } from './format-code';

/**
 * Plain names for the audit event types a traveller commonly sees in their Access Log (VS-015).
 *
 * Presentation only. The stored event types are the audit chain's identity and are never renamed,
 * mapped back or rewritten: this table is read at display time and nothing else reads it. A type
 * with no entry here (a new one, an old one) falls back to the generic words made from its code,
 * so the log never shows a blank or a raw code.
 */
const ACCESS_LOG_LABELS: ReadonlyMap<string, string> = new Map([
  // Documents and their versions
  ['DOCUMENT_ACCESS', 'Document Opened'],
  ['DOCUMENT_REGISTERED', 'Document Added'],
  ['DOCUMENT_UPLOADED', 'File Uploaded'],
  ['DOCUMENT_VERSION_ADDED', 'New Version Saved'],
  ['DOCUMENT_SUPERSEDED', 'Replaced by a Newer Version'],
  ['DOCUMENT_REVIEWED', 'Document Reviewed'],
  ['DOCUMENT_TYPE_SET', 'Document Type Set'],
  ['DOCUMENT_STATE_CHANGE', 'Document Status Changed'],
  ['DOCUMENT_DELETED', 'Document Deleted'],
  ['DOCUMENT_SELF_DELETED', 'Document Deleted'],
  ['DOCUMENT_REMOVED_BY_TRAVELLER', 'Document Deleted'],
  ['DOCUMENT_DELETE_UNDONE', 'Deletion Undone'],
  ['DOCUMENT_DESTROYED', 'Document Permanently Removed'],
  ['DOCUMENT_RECOGNISED_AUTOMATICALLY', 'Document Recognised Automatically'],
  ['DOCUMENT_COPIED_TO_PERSON', 'Document Copied to Another Person'],
  ['DOCUMENT_EXTRACTION_RUN', 'Document Details Read'],
  ['DOCUMENT_REMOVAL_REQUESTED', 'Removal Requested'],
  ['DOCUMENT_REMOVAL_DECIDED', 'Removal Request Decided'],
  // AI reading and suggestions
  ['AI_READING_JOB', 'Automatic Reading Ran'],
  ['AI_OCR_RUN', 'AI Read Document Text'],
  ['AI_EXTRACTION_RUN', 'AI Read Document Details'],
  ['AI_CLASSIFICATION_RUN', 'AI Suggested a Document Type'],
  ['AI_INCONSISTENCY_RUN', 'AI Checked for Mismatches'],
  ['AI_EXPLANATION_RUN', 'AI Explained a Gap'],
  ['AI_PROPOSAL_ACCEPTED', 'AI Suggestion Accepted'],
  ['AI_PROPOSAL_REJECTED', 'AI Suggestion Declined'],
  ['AI_PROPOSAL_CORRECTED', 'AI Suggestion Corrected'],
  ['AI_CLASSIFICATION_PROPOSAL_APPROVED', 'Document Type Suggestion Approved'],
  ['AI_CLASSIFICATION_PROPOSAL_REJECTED', 'Document Type Suggestion Declined'],
  // AI apps connected to the record
  ['AI_CONTEXT_REQUESTED', 'AI App Asked for Details'],
  ['AI_CONTEXT_SERVED', 'AI App Read Details'],
  ['AI_CONTEXT_DENIED', 'AI App Blocked'],
  ['AI_FILE_SERVED', 'AI App Read a File'],
  // Sharing
  ['GRANT_CREATED', 'Access Granted'],
  ['GRANT_ACCEPTED', 'Access Accepted'],
  ['GRANT_REVOKED', 'Access Removed'],
  ['GRANT_SCOPE_EXPANDED', 'Access Widened'],
  ['GRANT_CASE_EXCLUDED', 'Case Left Out of Access'],
  ['GRANT_CASE_ALLOWED', 'Case Included in Access'],
  ['GRANT_AI_ASSIST_CHANGED', 'AI Help Setting Changed'],
  ['SHARING_INVITATION_CREATED', 'Sharing Invitation Sent'],
  ['SHARING_INVITATION_ACCEPTED', 'Sharing Invitation Accepted'],
  ['SHARING_INVITATION_REVOKED', 'Sharing Invitation Withdrawn'],
  // People, cases and requests
  ['APPLICANT_CREATED', 'Person Added'],
  ['APPLICANT_ARCHIVED', 'Person Archived'],
  ['TRAVELLER_ARCHIVED', 'Person Archived'],
  ['APPLICANT_RESTORED', 'Person Restored'],
  ['TRAVELLER_RESTORED', 'Person Restored'],
  ['PROFILE_PHOTO_SET', 'Profile Photo Set'],
  ['PROFILE_PHOTO_REMOVED', 'Profile Photo Removed'],
  ['MISSION_CREATED', 'Case Created'],
  ['EVIDENCE_REQUEST_CREATED', 'Document Request Sent'],
  ['EVIDENCE_RECEIVED', 'Requested Document Received'],
]);

/**
 * The words the Access Log shows for a stored event type. Never changes or returns the stored
 * value itself; an unknown type becomes the generic words made from its code.
 */
export function accessLogEventLabel(eventType: string): string {
  return ACCESS_LOG_LABELS.get(eventType) ?? humanizeCode(eventType);
}

/** The event types that have their own words (for tests that keep the table honest). */
export function labelledAccessLogEventTypes(): readonly string[] {
  return [...ACCESS_LOG_LABELS.keys()];
}
