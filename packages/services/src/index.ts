/**
 * @visastack/services — Applicant Core application services.
 *
 * The write side of the Foundation: identity provisioning, separated consent,
 * applicant/family records, and the manual Master Profile editing path. Every
 * mutation is authorized (policy engine), consent-gated where required, and
 * recorded in the tamper-evident audit chain — atomically, fail-closed.
 *
 * Services accept a transaction-capable `Db` handle (see ADR-0009); they do not
 * construct a client, keeping this package driver-agnostic and testable against
 * in-memory PGlite.
 */

export type { Db, Schema } from './db';
export { type ServiceError, type ServiceErrorCode, serviceError } from './errors';

export { type AuditEventInput, type AuditEventRow, appendAuditEvent } from './audit';

export {
  type Account,
  type ProvisionAccountInput,
  getAccountByEmail,
  provisionAccount,
} from './accounts';

export {
  type ConsentState,
  type SetConsentInput,
  getConsents,
  hasConsent,
  setConsent,
} from './consent';

export {
  type Applicant,
  type ApplicantRelationship,
  type CreateApplicantInput,
  addFamilyMember,
  createApplicant,
  getApplicant,
  listApplicants,
} from './applicants';

export {
  type EditFactInput,
  type EditFactResult,
  type Fact,
  type FactVersion,
  type FieldDefinition,
  type RegisterFieldInput,
  editFact,
  getCurrentFactVersion,
  listFactHistory,
  registerFieldDefinition,
} from './profile';

export type {
  AccessDisposition,
  AccessRef,
  AccessVariant,
  IssueReadRefInput,
  StorageBucket,
  StoragePort,
} from './storage';

export { type AccountExport, exportAccount } from './export';

export {
  type MrzError,
  type Td3Result,
  checkDigit,
  parseTd3,
} from './mrz';

export {
  type ScannerPort,
  type ScanResult,
  nextIntakeState,
  processIntake,
} from './intake';

export {
  type AiBudget,
  type AiExtractionInput,
  type AiExtractionPort,
  type AiExtractionResult,
  type AiUsage,
  type ApproveProposalInput,
  type FieldProposal,
  type RunExtractionInput,
  approveProposal,
  awaitingReview,
  runExtraction,
} from './ai';

export {
  type DeletionRequest,
  cancelAccountDeletion,
  executeAccountDeletion,
  requestAccountDeletion,
} from './deletion';

export {
  type AddDocumentVersionInput,
  type AddDocumentVersionResult,
  type Document,
  type DocumentAccessInput,
  type DocumentVersion,
  type DownloadDocumentInput,
  type RegisterDocumentInput,
  type StorageObject,
  addDocumentVersion,
  downloadDocument,
  listDocuments,
  previewDocument,
  registerDocument,
} from './documents';
